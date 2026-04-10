import { fetchJsonWithRetry } from "@/server/fetchJson";
import { optionalEnv, requireEnv } from "@/server/env";
import { fetchFreeSnapshot, yahooSourceUrl } from "@/lib/market/freeMarket";
import { ensureDefaultRssSources, listEnabledRssSources, listRecentRssItems } from "@/lib/market/repository";
import { fetchRssItems, syncRssSource } from "@/lib/market/rss";
import type { MarketInstrumentRow } from "@/lib/market/types";
import type { AiPromptConfig } from "@/server/aiPromptSettings";
import type { MediaType } from "@prisma/client";
import { recordAiUsage, type AiTokenUsage } from "@/server/aiUsage";

type PerplexityChatResponse = {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type GeminiGenerateResponse = {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

type GeneratedPostItem = {
  text: string;
};

const RSS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
let lastGroundingRssSyncAt = 0;

function parseJsonFromText<T>(raw: string): T | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim();
  const target = fenced ?? trimmed;

  const candidates: string[] = [];
  const push = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  push(target);

  // Try best-effort extraction for wrapped prose.
  const firstBrace = target.indexOf("{");
  const lastBrace = target.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = target.slice(firstBrace, lastBrace + 1);
    push(sliced);
  }

  // Common LLM formatting glitches (e.g. "\"text:\"...").
  for (const base of [...candidates]) {
    push(base.replace(/"([A-Za-z0-9_]+):"\s*/g, "\"$1\": "));
    push(base.replace(/,\s*([}\]])/g, "$1"));
    push(
      base
        .replace(/"([A-Za-z0-9_]+):"\s*/g, "\"$1\": ")
        .replace(/,\s*([}\]])/g, "$1")
    );
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // continue
    }
  }
  return null;
}

function extractLooseTextField(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const base = fenced ?? trimmed;

  const candidates: string[] = [base];
  const firstBrace = base.indexOf("{");
  if (firstBrace >= 0) {
    candidates.push(base.slice(firstBrace));
  }

  for (const candidate of candidates) {
    const keyMatchers = [/"text"\s*:\s*"/i, /text\s*:\s*"/i];
    for (const matcher of keyMatchers) {
      const m = matcher.exec(candidate);
      if (!m) continue;

      let i = m.index + m[0].length;
      let out = "";
      let escaped = false;
      while (i < candidate.length) {
        const ch = candidate[i];
        i += 1;

        if (escaped) {
          if (ch === "n") out += "\n";
          else if (ch === "r") out += "\r";
          else if (ch === "t") out += "\t";
          else if (ch === "\"") out += "\"";
          else if (ch === "\\") out += "\\";
          else out += ch;
          escaped = false;
          continue;
        }

        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          const normalized = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
          return normalized || null;
        }
        out += ch;
      }
    }
  }

  return null;
}

function collapseLineSpaces(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+|(?<=요\.)\s+/g)
    .map((line) => collapseLineSpaces(line))
    .filter(Boolean);
}

function formatReadableText(v: string, maxLen = 500) {
  const normalized = v.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return "";

  const byLines = normalized
    .split("\n")
    .map((line) => collapseLineSpaces(line))
    .filter(Boolean);

  const readableLines = byLines.length >= 2 ? byLines : splitSentences(normalized);
  const lines = readableLines.length > 0 ? readableLines : [collapseLineSpaces(normalized)];

  // 가독성을 위해 줄 사이에 항상 한 줄 공백(엔터 2번)을 강제합니다.
  const joined = lines.join("\n\n").trim();
  if (joined.length <= maxLen) return joined;

  const head = joined.slice(0, maxLen + 1);
  const cutCandidates = [
    head.lastIndexOf("\n\n"),
    head.lastIndexOf("다. "),
    head.lastIndexOf("요. "),
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.lastIndexOf(" "),
  ];
  const cutAt = Math.max(...cutCandidates);
  if (cutAt >= Math.floor(maxLen * 0.7)) {
    return head.slice(0, cutAt).trim();
  }
  return head.slice(0, maxLen).trim();
}

function sanitizePostText(v: string) {
  const stripped = v.replace(/^\s*\(기준:\s*[^)\n]*KST\)\s*\n*/i, "").trim();
  return formatReadableText(stripped, 500);
}

const CTA_ACTION_KEYWORDS = [
  "참여",
  "신청",
  "문의",
  "등록",
  "오픈채팅",
  "입장",
  "프로필",
  "링크",
  "클릭",
  "dm",
  "메시지",
  "지금",
  "오늘",
  "마감",
  "선착순",
  "자리",
  "한정",
  "무료",
  "받아",
  "공유방",
];

const CTA_INFO_KEYWORDS = [
  "코스피",
  "코스닥",
  "나스닥",
  "s&p",
  "다우",
  "선물",
  "원유",
  "금리",
  "달러",
  "시황",
  "브리핑",
  "지표",
  "발표",
  "상승",
  "하락",
  "급등",
  "급락",
  "포인트",
];

function lineHasAnyKeyword(line: string, keywords: string[]) {
  const normalized = line.toLowerCase();
  return keywords.some((kw) => normalized.includes(kw));
}

function isLikelyInfoLine(line: string) {
  const compact = line.toLowerCase();
  if (/[+-]?\d+(\.\d+)?\s*%/.test(compact)) return true;
  if (/\d{1,3}(,\d{3})+/.test(compact)) return true;
  if (/(원|달러|usd|krw|pt|포인트)/.test(compact)) return true;
  return lineHasAnyKeyword(compact, CTA_INFO_KEYWORDS);
}

function isLikelyCtaLine(line: string) {
  const compact = line.toLowerCase();
  if (lineHasAnyKeyword(compact, CTA_ACTION_KEYWORDS)) return true;
  if (/[!]/.test(compact)) return true;
  if (/(하세요|해보세요|지금|마감|참여|신청|문의|클릭)/.test(compact)) return true;
  return false;
}

function forceCtaOnlyText(text: string, ctaHint?: string) {
  const normalized = sanitizePostText(text);
  const lines = normalized
    .split("\n")
    .map((line) => collapseLineSpaces(line))
    .filter(Boolean);

  const ctaPreferred = lines.filter((line) => isLikelyCtaLine(line) && !isLikelyInfoLine(line));
  const ctaFallback = lines.filter((line) => isLikelyCtaLine(line));
  const selected = (ctaPreferred.length ? ctaPreferred : ctaFallback).slice(0, 4);

  if (selected.length > 0) {
    return formatReadableText(selected.join("\n"), 500);
  }

  const hint = formatReadableText(ctaHint ?? "", 500);
  if (hint) return hint;

  return formatReadableText(
    [
      "감으로 매매하는 홀짝 도박 대신 데이터 기반 타점이 필요하면 지금 참여하세요.",
      "공유방 선착순 좌석은 오늘 마감입니다.",
      "프로필 링크에서 바로 신청 가능합니다.",
    ].join("\n"),
    500
  );
}

type AiProvider = "perplexity" | "gemini";
type AiProviderInput = AiProvider | "auto";
type AiSelection = {
  provider: AiProvider;
  model: string;
};

function getAiProvider(): AiProvider {
  const explicit = optionalEnv("CONTENT_AI_PROVIDER")?.toLowerCase();
  if (explicit === "gemini") return "gemini";
  if (explicit === "perplexity") return "perplexity";
  if (optionalEnv("PERPLEXITY_API_KEY")) return "perplexity";
  if (optionalEnv("GEMINI_API_KEY")) return "gemini";
  throw new Error("Missing AI key: set PERPLEXITY_API_KEY or GEMINI_API_KEY");
}

function resolveAiSelection(providerInput?: AiProviderInput, modelInput?: string): AiSelection {
  const provider = providerInput && providerInput !== "auto" ? providerInput : getAiProvider();
  const overrideModel = modelInput?.trim();
  if (provider === "perplexity") {
    return {
      provider,
      model: overrideModel || optionalEnv("PERPLEXITY_MODEL") || "sonar",
    };
  }
  return {
    provider,
    model: overrideModel || optionalEnv("GEMINI_MODEL") || "gemini-2.0-flash",
  };
}

function fmtSignedPct(value: number) {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function kstNowText() {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

function kstYmdText(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function kstDateTimeText(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

function normalizeForKeywordMatch(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function extractQueryKeywords(issuePrompt: string) {
  const base = issuePrompt
    .replace(/[，,\/|]+/g, " ")
    .replace(/[(){}\[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stopwords = new Set([
    "오늘",
    "요즘",
    "관련",
    "이슈",
    "시황",
    "정리",
    "알려줘",
    "알려주세요",
    "부탁",
    "분석",
    "기반",
  ]);

  const parts = base.split(" ").map((v) => v.trim()).filter(Boolean);
  const dedup = new Set<string>();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (stopwords.has(key)) continue;
    if (part.length < 2) continue;
    dedup.add(part);
  }
  return Array.from(dedup).slice(0, 8);
}

function includesAnyKeyword(text: string, keywords: string[]) {
  if (!keywords.length) return false;
  const normalized = normalizeForKeywordMatch(text);
  return keywords.some((kw) => normalized.includes(normalizeForKeywordMatch(kw)));
}

function keywordHitCount(text: string, keywords: string[]) {
  if (keywords.length === 0) return 0;
  const normalized = normalizeForKeywordMatch(text);
  return keywords.reduce((acc, kw) => {
    return normalized.includes(normalizeForKeywordMatch(kw)) ? acc + 1 : acc;
  }, 0);
}

function hasTopicCoverage(text: string, keywords: string[]) {
  if (keywords.length === 0) return true;
  return keywordHitCount(text, keywords) >= 1;
}

async function fetchGoogleNewsByQuery(keywords: string[], issuePrompt: string) {
  const basePrompt = collapseLineSpaces(issuePrompt);
  const queries = [
    basePrompt,
    ...keywords.slice(0, 3),
  ]
    .map((v) => collapseLineSpaces(v))
    .filter(Boolean);

  if (queries.length === 0) return [];

  const dedup = new Map<string, { title: string; link: string; publishedAt?: string | null }>();
  for (const query of queries) {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "ko");
    url.searchParams.set("gl", "KR");
    url.searchParams.set("ceid", "KR:ko");

    const items = await fetchRssItems(url.toString());
    for (const item of items) {
      if (!item.title || !item.link) continue;
      const key = item.link || item.title;
      if (!dedup.has(key)) {
        dedup.set(key, {
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
        });
      }
      if (dedup.size >= 16) break;
    }
    if (dedup.size >= 16) break;
  }

  return Array.from(dedup.values()).slice(0, 8);
}

async function refreshGroundingRssIfNeeded() {
  const now = Date.now();
  if (now - lastGroundingRssSyncAt < RSS_REFRESH_INTERVAL_MS) return;
  lastGroundingRssSyncAt = now;

  try {
    await ensureDefaultRssSources();
    const sources = await listEnabledRssSources();
    if (sources.length === 0) return;

    const targets = sources.slice(0, 6);
    await Promise.allSettled(targets.map((source) => syncRssSource(source, 20)));
  } catch {
    // Grounding refresh is best-effort.
  }
}

export async function buildIssueGroundingContext(issuePrompt: string) {
  const lines: string[] = [];
  const now = new Date();
  const nowMs = now.getTime();
  const twoDaysMs = 48 * 60 * 60 * 1000;
  const keywords = extractQueryKeywords(issuePrompt);

  lines.push(`오늘 날짜(KST): ${kstYmdText(now)}`);
  lines.push(`기준 시각(KST): ${kstNowText()}`);
  lines.push(`요청: ${issuePrompt}`);
  if (keywords.length > 0) {
    lines.push(`핵심 키워드: ${keywords.join(", ")}`);
  }
  lines.push("최신성 규칙: 아래 컨텍스트에 있는 최근 데이터만 사용하고, 과거 이슈를 오늘 이슈처럼 단정하지 마세요.");

  // 실시간에 가까운 시장 데이터(Yahoo)로 오늘 컨텍스트를 강제 주입
  try {
    const instruments: MarketInstrumentRow[] = [
      { id: "es", label: "S&P 500 선물", te_symbol: "ES=F", category: "index", enabled: true, sort: 1 },
      { id: "nq", label: "나스닥 100 선물", te_symbol: "NQ=F", category: "index", enabled: true, sort: 2 },
      { id: "dxy", label: "달러 인덱스", te_symbol: "DX-Y.NYB", category: "currency", enabled: true, sort: 3 },
      { id: "cl", label: "WTI 원유", te_symbol: "CL=F", category: "commodity", enabled: true, sort: 4 },
      { id: "gc", label: "금", te_symbol: "GC=F", category: "commodity", enabled: true, sort: 5 },
    ];
    const snapshot = await fetchFreeSnapshot(instruments, 7);
    if (snapshot.length > 0) {
      lines.push("");
      lines.push("최신 시세 참고(Yahoo):");
      for (const row of snapshot.slice(0, 5)) {
        lines.push(`- ${row.label}: ${row.last.toLocaleString()} (${fmtSignedPct(row.dailyPct)}) [${yahooSourceUrl(row.symbol)}]`);
      }
    }
  } catch {
    // Best-effort grounding only.
  }

  // 최신 뉴스 제목을 컨텍스트로 주입해 과거 사건 환각을 줄임
  try {
    await refreshGroundingRssIfNeeded();
    const rssItems = await listRecentRssItems(20);
    const recent = rssItems
      .filter((item) => item.title && item.published_at)
      .filter((item) => {
        const ts = Date.parse(item.published_at as string);
        return Number.isFinite(ts) && nowMs - ts <= twoDaysMs;
      })
      .slice(0, 6);
    if (recent.length > 0) {
      lines.push("");
      lines.push("최근 48시간 뉴스 헤드라인:");
      for (const item of recent) {
        lines.push(`- ${kstDateTimeText(item.published_at as string)}: ${item.title} (${item.link})`);
      }

      const matched = recent
        .filter((item) => includesAnyKeyword(`${item.title} ${item.link}`, keywords))
        .slice(0, 6);
      if (keywords.length > 0) {
        lines.push("");
        lines.push("요청 키워드와 직접 매칭된 헤드라인:");
        if (matched.length > 0) {
          for (const item of matched) {
            lines.push(`- ${kstDateTimeText(item.published_at as string)}: ${item.title} (${item.link})`);
          }
        } else {
          lines.push("- 내부 RSS에서 직접 매칭 헤드라인 없음");
        }
      }
    } else {
      lines.push("");
      lines.push("최근 48시간 뉴스 헤드라인 없음: 과거 사건 단정 서술 금지, 일반적 리스크 요인 위주로만 작성.");
    }
  } catch {
    // Best-effort grounding only.
  }

  try {
    if (keywords.length > 0) {
      const google = await fetchGoogleNewsByQuery(keywords, issuePrompt);
      if (google.length > 0) {
        lines.push("");
        lines.push("요청 키워드 검색 뉴스(구글 뉴스 RSS):");
        for (const item of google.slice(0, 6)) {
          lines.push(`- ${kstDateTimeText(item.publishedAt ?? new Date())}: ${item.title} (${item.link})`);
        }
      }
    }
  } catch {
    // Best-effort grounding only.
  }

  return lines.join("\n");
}

async function callPerplexityJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<{ data: T; usage: AiTokenUsage }> {
  const apiKey = requireEnv("PERPLEXITY_API_KEY");
  const apiUrl = optionalEnv("PERPLEXITY_API_URL") ?? "https://api.perplexity.ai/chat/completions";

  const request = async (useJsonSchema: boolean) =>
    fetchJsonWithRetry<PerplexityChatResponse>(
      apiUrl,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          ...(useJsonSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "sbusim_response",
                    schema: {
                      type: "object",
                      additionalProperties: true,
                    },
                  },
                },
              }
            : {}),
        }),
      },
      { timeoutMs: 30_000, retries: 2, backoffMs: 800 }
    );

  let json: PerplexityChatResponse | null = null;
  let text = "";
  try {
    const out = await request(true);
    json = out.json;
    text = out.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/HTTP 400|response_format|json_schema|unsupported/i.test(message)) {
      throw err;
    }
    const out = await request(false);
    json = out.json;
    text = out.text;
  }

  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`Perplexity response missing content: ${text}`);
  }

  const parsed = parseJsonFromText<T>(content);
  if (!parsed) {
    throw new Error(`Perplexity response parse failed: ${content}`);
  }
  const usage = {
    promptTokens: Number(json?.usage?.prompt_tokens ?? 0),
    completionTokens: Number(json?.usage?.completion_tokens ?? 0),
    totalTokens: Number(
      json?.usage?.total_tokens ??
        (Number(json?.usage?.prompt_tokens ?? 0) + Number(json?.usage?.completion_tokens ?? 0))
    ),
  };
  return { data: parsed, usage };
}

async function callGeminiJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<{ data: T; usage: AiTokenUsage; usedModel: string }> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const run = async (targetModel: string): Promise<{ data: T; usage: AiTokenUsage; usedModel: string }> => {
    const defaultApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;
    const apiUrl = optionalEnv("GEMINI_API_URL") ?? defaultApiUrl;

    const url = new URL(apiUrl);
    if (!url.searchParams.has("key")) {
      url.searchParams.set("key", apiKey);
    }

    const { json, text } = await fetchJsonWithRetry<GeminiGenerateResponse>(
      url.toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        }),
      },
      { timeoutMs: 30_000, retries: 2, backoffMs: 800 }
    );

    const content = (json?.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!content) {
      throw new Error(`Gemini response missing content: ${text}`);
    }

    const parsed = parseJsonFromText<T>(content);
    if (!parsed) {
      throw new Error(`Gemini response parse failed: ${content}`);
    }
    const usage = {
      promptTokens: Number(json?.usageMetadata?.promptTokenCount ?? 0),
      completionTokens: Number(json?.usageMetadata?.candidatesTokenCount ?? 0),
      totalTokens: Number(
        json?.usageMetadata?.totalTokenCount ??
          (Number(json?.usageMetadata?.promptTokenCount ?? 0) + Number(json?.usageMetadata?.candidatesTokenCount ?? 0))
      ),
    };
    return { data: parsed, usage, usedModel: targetModel };
  };

  try {
    return await run(model);
  } catch (err) {
    const fallbackModel = optionalEnv("GEMINI_MODEL") || "gemini-2.0-flash";
    const message = err instanceof Error ? err.message : String(err);
    if (fallbackModel !== model && message.includes("HTTP 404")) {
      return await run(fallbackModel);
    }
    throw err;
  }
}

async function callModelJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { provider?: AiProviderInput; model?: string; usageUserId?: string; usageType?: string }
): Promise<{ data: T; ai: AiSelection; usage: AiTokenUsage }> {
  const requestedAi = resolveAiSelection(options?.provider, options?.model);
  const provider = requestedAi.provider;
  let data: T;
  let usage: AiTokenUsage;
  let resolvedAi: AiSelection = requestedAi;
  if (provider === "gemini") {
    const out = await callGeminiJSON<T>(systemPrompt, userPrompt, requestedAi.model);
    data = out.data;
    usage = out.usage;
    resolvedAi = {
      provider: "gemini",
      model: out.usedModel,
    };
  } else {
    const out = await callPerplexityJSON<T>(systemPrompt, userPrompt, requestedAi.model);
    data = out.data;
    usage = out.usage;
  }

  await recordAiUsage({
    userId: options?.usageUserId,
    provider: resolvedAi.provider,
    model: resolvedAi.model,
    requestType: options?.usageType,
    usage,
  });

  return { data, ai: resolvedAi, usage };
}

type AutoRepairStage = "publish" | "comment";

type AutoRepairRequest = {
  stage: AutoRepairStage;
  errorMessage: string;
  text: string;
  mediaType: MediaType;
  mediaUrl?: string | null;
  commentText?: string | null;
  provider?: AiProviderInput;
  model?: string;
  usageUserId?: string;
};

type AutoRepairResponse = {
  canFix: boolean;
  reason?: string;
  text?: string;
  mediaType?: MediaType;
  mediaUrl?: string | null;
  commentText?: string;
};

export async function autoRepairScheduledPostWithAi(
  args: AutoRepairRequest
): Promise<{
  canFix: boolean;
  reason: string;
  patched: {
    text: string;
    mediaType: MediaType;
    mediaUrl: string | null;
    commentText: string | null;
  };
  ai: AiSelection;
}> {
  const modelOverride = args.model?.trim() || optionalEnv("AUTO_REPAIR_AI_MODEL");
  const providerOverride = args.provider ?? ((optionalEnv("AUTO_REPAIR_AI_PROVIDER") as AiProviderInput | undefined) ?? "auto");

  const systemPrompt = [
    "당신은 Threads 발행 오류 자동복구 JSON 생성기입니다.",
    "반드시 JSON 하나만 출력하세요. 마크다운 금지.",
    '형식: {"canFix":true|false,"reason":"...","text":"...","mediaType":"TEXT|IMAGE|VIDEO","mediaUrl":null|"https://...","commentText":"..."}',
    "복구 불가능하면 canFix=false와 reason만 출력.",
    "복구 가능하면 최소 수정 원칙으로 필드만 보정.",
    "text/commentText는 500자 이내.",
    "mediaType이 TEXT면 mediaUrl은 null.",
    "mediaType이 IMAGE/VIDEO면 mediaUrl은 https URL이어야 하며 불확실하면 TEXT로 내려서 mediaUrl=null 처리.",
    "단, 원본 mediaType이 IMAGE/VIDEO인 publish 단계에서는 TEXT로 다운그레이드하지 말고 canFix=false로 응답하세요.",
    "과장/허위 추가 금지, 원문 의미 유지.",
  ].join("\n");

  const userPrompt = [
    `단계(stage): ${args.stage}`,
    `오류메시지:\n${args.errorMessage}`,
    "현재 payload:",
    JSON.stringify(
      {
        text: args.text,
        mediaType: args.mediaType,
        mediaUrl: args.mediaUrl ?? null,
        commentText: args.commentText ?? null,
      },
      null,
      2
    ),
    args.stage === "comment"
      ? "목표: commentText(첫 댓글)만 보정해서 재시도 가능하게."
      : "목표: 본문/미디어 필드를 보정해서 발행 가능한 payload로 만들기.",
  ].join("\n");

  const { data, ai } = await callModelJSON<AutoRepairResponse>(systemPrompt, userPrompt, {
    provider: providerOverride,
    model: modelOverride,
    usageUserId: args.usageUserId,
    usageType: `auto_repair_${args.stage}`,
  });

  if (!data?.canFix) {
    return {
      canFix: false,
      reason: data?.reason?.trim() || "AI가 복구 불가로 판단했습니다.",
      patched: {
        text: args.text,
        mediaType: args.mediaType,
        mediaUrl: args.mediaUrl ?? null,
        commentText: args.commentText?.trim() || null,
      },
      ai,
    };
  }

  const nextText = sanitizePostText(data.text ?? args.text);
  const nextComment = formatReadableText(data.commentText ?? args.commentText ?? "", 500) || null;
  const nextMediaType = (data.mediaType ?? args.mediaType) as MediaType;
  let nextMediaUrl = (data.mediaUrl ?? args.mediaUrl ?? null)?.trim() || null;
  const preserveMediaPost = args.stage === "publish" && args.mediaType !== "TEXT";

  if (preserveMediaPost && nextMediaType === "TEXT") {
    return {
      canFix: false,
      reason: data.reason?.trim() || "미디어 게시물은 자동으로 TEXT로 전환하지 않습니다.",
      patched: {
        text: args.text,
        mediaType: args.mediaType,
        mediaUrl: args.mediaUrl ?? null,
        commentText: args.commentText?.trim() || null,
      },
      ai,
    };
  }

  if (nextMediaType === "TEXT") {
    nextMediaUrl = null;
  } else if (!nextMediaUrl) {
    if (preserveMediaPost) {
      return {
        canFix: false,
        reason: data.reason?.trim() || "미디어 URL을 확정할 수 없어 publish 자동복구를 중단합니다.",
        patched: {
          text: args.text,
          mediaType: args.mediaType,
          mediaUrl: args.mediaUrl ?? null,
          commentText: args.commentText?.trim() || null,
        },
        ai,
      };
    }
    return {
      canFix: true,
      reason: (data.reason?.trim() || "미디어 URL 불명확으로 TEXT로 전환") + " (자동 TEXT 전환)",
      patched: {
        text: nextText,
        mediaType: "TEXT",
        mediaUrl: null,
        commentText: nextComment,
      },
      ai,
    };
  } else {
    try {
      const u = new URL(nextMediaUrl);
      if (u.protocol !== "https:") {
        nextMediaUrl = null;
      }
    } catch {
      nextMediaUrl = null;
    }
    if (!nextMediaUrl) {
      if (preserveMediaPost) {
        return {
          canFix: false,
          reason: data.reason?.trim() || "mediaUrl 형식 오류로 publish 자동복구를 중단합니다.",
          patched: {
            text: args.text,
            mediaType: args.mediaType,
            mediaUrl: args.mediaUrl ?? null,
            commentText: args.commentText?.trim() || null,
          },
          ai,
        };
      }
      return {
        canFix: true,
        reason: (data.reason?.trim() || "mediaUrl 형식 오류") + " (자동 TEXT 전환)",
        patched: {
          text: nextText,
          mediaType: "TEXT",
          mediaUrl: null,
          commentText: nextComment,
        },
        ai,
      };
    }
  }

  return {
    canFix: true,
    reason: data.reason?.trim() || "AI 자동복구",
    patched: {
      text: nextText,
      mediaType: nextMediaType,
      mediaUrl: nextMediaUrl,
      commentText: nextComment,
    },
    ai,
  };
}

export async function generateDailyTopicPost(args: {
  topic: string;
  promptHint?: string;
  contentType?: "TOPIC" | "INFO" | "CTA";
  ctaText?: string;
  groundingContext?: string;
  directPromptMode?: boolean;
  promptConfig?: Partial<AiPromptConfig>;
  aiProvider?: AiProviderInput;
  aiModel?: string;
  usageUserId?: string;
}): Promise<{ text: string; commentText?: string; ai: AiSelection }> {
  const contentType = args.contentType ?? "TOPIC";
  const directPromptMode = Boolean(args.directPromptMode);
  const grounding =
    args.groundingContext !== undefined
      ? args.groundingContext
      : directPromptMode
        ? ""
        : await buildIssueGroundingContext(args.topic).catch(() => "");
  const styleGuide =
    directPromptMode
      ? ""
      : contentType === "INFO"
        ? args.promptConfig?.dailyTopicInfoGuide?.trim() ||
          "정보성 글: 핵심 사실/배경/체크포인트를 명확히 정리하고, 홍보성 문구는 최소화."
        : contentType === "CTA"
          ? args.promptConfig?.dailyTopicCtaGuide?.trim() ||
            "CTA 글: 행동 유도 문장만 작성하세요. 시황/수치/퍼센트/자산 가격/시장 요약은 금지합니다. 첫 문장부터 CTA로 시작하고, 2~4문장으로 짧고 강하게 작성하세요."
          : args.promptConfig?.dailyTopicTopicGuide?.trim() ||
            "주제형 글: 오늘 관점의 핵심 포인트 2~3개를 균형 있게 정리.";

  const systemPrompt = directPromptMode
    ? [
        "당신은 한국어 Threads 콘텐츠 작성자입니다.",
        "반드시 JSON 하나만 출력하세요.",
        '형식: {"text":"..."}',
        "text는 500자 이내로 작성하세요.",
      ].join("\n")
    : [
        "당신은 한국어 Threads 콘텐츠 작성자입니다.",
        "반드시 JSON 하나만 출력하세요.",
        '형식: {"text":"..."}',
        "text는 500자 이내, 줄바꿈 허용, 사실 기반으로 작성.",
        "본문은 핵심 문장마다 줄바꿈하고, 문장 사이에 빈 줄 1개(\\n\\n)를 사용하세요.",
        "과도한 과장/투자 조언/확정적 표현은 금지.",
        "반드시 요청 키워드와 직접 관련된 내용만 작성하세요.",
        "요청 키워드와 무관한 사건/인물/지역을 임의로 넣지 마세요.",
        args.promptConfig?.dailyTopicCommonRules?.trim() || "",
        styleGuide,
      ].join("\n");

  const userPrompt = directPromptMode
    ? [
        `콘텐츠 타입: ${contentType}`,
        `주제: ${args.topic}`,
        args.promptHint ? `작성 지시:\n${args.promptHint}` : "",
        args.ctaText ? `CTA 참고 문구:\n${args.ctaText}` : "",
        grounding ? `참고 자료:\n${grounding}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : [
        `콘텐츠 타입: ${contentType}`,
        `주제: ${args.topic}`,
        args.promptHint ? `추가 지시: ${args.promptHint}` : "",
        args.ctaText ? `CTA 문구 가이드(우선 반영): ${args.ctaText}` : "",
        contentType === "CTA"
          ? "정보성 설명 없이 CTA 문장만 작성하세요. 시장 숫자/등락/시황 요약 문장은 절대 넣지 마세요."
          : "오늘 기준 핵심 2~3개를 반영해 본문을 작성해 주세요.",
        (() => {
          const kws = extractQueryKeywords(args.topic);
          return kws.length ? `필수 키워드(가능한 범위에서 반영): ${kws.join(", ")}` : "";
        })(),
        grounding ? `최신 참고 컨텍스트:\n${grounding}` : "",
      ]
        .filter(Boolean)
        .join("\n");

  let parsed: { text?: string } | null = null;
  let ai: AiSelection;
  try {
    const out = await callModelJSON<{ text?: string }>(systemPrompt, userPrompt, {
      provider: args.aiProvider,
      model: args.aiModel,
      usageUserId: args.usageUserId,
      usageType: `daily_topic_post_${contentType.toLowerCase()}`,
    });
    parsed = out.data;
    ai = out.ai;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const looseText = extractLooseTextField(message);
    if (!looseText) throw err;

    ai = resolveAiSelection(args.aiProvider, args.aiModel);
    const main = directPromptMode
      ? sanitizePostText(looseText)
      : contentType === "CTA"
        ? forceCtaOnlyText(looseText, args.ctaText)
        : sanitizePostText(looseText);
    if (!main) throw err;
    return { text: main, ai };
  }

  if (parsed?.text) {
    const main = directPromptMode
      ? sanitizePostText(parsed.text)
      : contentType === "CTA"
        ? forceCtaOnlyText(parsed.text, args.ctaText)
        : sanitizePostText(parsed.text);
    if (!main) throw new Error("AI generated empty post text");
    return { text: main, ai };
  }

  const fallback = directPromptMode
    ? sanitizePostText(JSON.stringify(parsed))
    : contentType === "CTA"
      ? forceCtaOnlyText(JSON.stringify(parsed), args.ctaText)
      : sanitizePostText(JSON.stringify(parsed));
  if (!fallback) throw new Error("AI generated empty response");
  return { text: fallback, ai };
}

export async function generateIssueBriefingAndPosts(args: {
  issuePrompt: string;
  templatePrompt?: string;
  extraPrompt?: string;
  count: number;
  promptConfig?: Partial<AiPromptConfig>;
  aiProvider?: AiProviderInput;
  aiModel?: string;
  usageUserId?: string;
}): Promise<{ briefing: string; posts: GeneratedPostItem[]; ai: AiSelection }> {
  const targetCount = Math.max(1, Math.min(10, Math.floor(args.count)));
  const grounding = await buildIssueGroundingContext(args.issuePrompt);
  const issueKeywords = extractQueryKeywords(args.issuePrompt);
  const rebuildHintBase = [
    args.templatePrompt ? `템플릿 지시: ${args.templatePrompt}` : "",
    args.extraPrompt ? `추가 지시: ${args.extraPrompt}` : "",
    issueKeywords.length > 0 ? `필수 키워드(최소 1개 이상 반영): ${issueKeywords.join(", ")}` : "",
    "주제 이탈 판정된 본문 재작성 요청입니다. 반드시 이슈 질의와 직접 관련된 내용만 작성하세요.",
  ]
    .filter(Boolean)
    .join("\n");

  let lastError = "AI generated no post candidates";
  let lastAi: AiSelection | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const strictKeywordMode = attempt > 0;
    const systemPrompt = [
      "당신은 한국어 Threads 콘텐츠 전략가입니다.",
      "반드시 JSON 하나만 출력하세요.",
      '형식: {"briefing":"...","posts":[{"text":"..."}]}',
      "briefing은 핵심 이슈 요약 4~7문장.",
      `posts는 정확히 ${targetCount}개 생성.`,
      "각 text는 500자 이내, 팩트 기반, 과장 금지.",
      "각 text의 문장 사이는 빈 줄 1개(\\n\\n)로 분리해 가독성을 높이세요.",
      "오늘/현재 표현은 반드시 기준 시각(KST) 기준으로만 작성하세요.",
      "아래 컨텍스트에 없는 구체 수치/날짜/사건을 임의로 단정하지 마세요.",
      "최신 사실이 불확실하면 '현재 확인 필요' 식으로 보수적으로 표현하세요.",
      "과거 사건을 오늘 시황처럼 서술하지 마세요.",
      "오늘 질의일 때 48시간보다 오래된 뉴스를 현재 이슈인 것처럼 쓰지 마세요.",
      "반드시 요청 키워드와 직접 관련된 브리핑/게시글을 작성하세요.",
      "요청 키워드와 무관한 지정학/거시 이벤트를 임의로 끼워넣지 마세요.",
      args.promptConfig?.issuePackCommonRules?.trim() || "",
      strictKeywordMode
        ? "중요: 브리핑과 모든 게시글(text)에 요청 키워드를 최소 1개 이상 직접 포함하세요."
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const userPrompt = [
      `이슈 질의: ${args.issuePrompt}`,
      issueKeywords.length ? `필수 키워드(가급적 각 키워드 반영): ${issueKeywords.join(", ")}` : "",
      args.templatePrompt ? `템플릿 지시: ${args.templatePrompt}` : "",
      args.extraPrompt ? `추가 지시: ${args.extraPrompt}` : "",
      strictKeywordMode
        ? "직전 결과가 주제 이탈로 판정되었습니다. 키워드 중심으로 재작성하세요."
        : "",
      "아래는 최신성 강화를 위한 참고 컨텍스트입니다.",
      grounding,
      "한국어로 작성해 주세요.",
    ]
      .filter(Boolean)
      .join("\n");

    const { data: parsed, ai } = await callModelJSON<{
      briefing?: string;
      posts?: Array<{ text?: string }>;
    }>(systemPrompt, userPrompt, {
      provider: args.aiProvider,
      model: args.aiModel,
      usageUserId: args.usageUserId,
      usageType: "issue_briefing_pack",
    });
    lastAi = ai;

    const briefing = formatReadableText(parsed.briefing ?? "", 1200);
    const rawPosts = Array.isArray(parsed.posts) ? parsed.posts : [];
    const posts = rawPosts
      .map((p) => ({
        text: sanitizePostText(p.text ?? ""),
      }))
      .filter((p) => p.text.length > 0)
      .slice(0, targetCount);

    if (!briefing) {
      lastError = "AI briefing is empty";
      continue;
    }
    if (posts.length === 0) {
      lastError = "AI generated no post candidates";
      continue;
    }

    const briefingCovered = hasTopicCoverage(briefing, issueKeywords);
    const calcOffTopicIndexes = (arr: GeneratedPostItem[]) =>
      arr.map((post, idx) => (hasTopicCoverage(post.text, issueKeywords) ? -1 : idx + 1)).filter((idx) => idx !== -1);
    const offTopicIndexes = calcOffTopicIndexes(posts);

    if (issueKeywords.length > 0 && briefingCovered && offTopicIndexes.length > 0) {
      const repairedPosts = [...posts];
      for (const idx of offTopicIndexes) {
        const postIndex = idx - 1;
        let repaired = false;
        for (let retry = 0; retry < 2; retry += 1) {
          const regenerated = await generateDailyTopicPost({
            topic: args.issuePrompt,
            contentType: "TOPIC",
            promptConfig: args.promptConfig,
            promptHint: [
              rebuildHintBase,
              `재작성 대상 번호: ${idx}`,
              `현재 브리핑 참고:\n${briefing}`,
              `최신 참고 컨텍스트:\n${grounding}`,
            ]
              .filter(Boolean)
              .join("\n"),
            groundingContext: grounding,
            aiProvider: args.aiProvider,
            aiModel: args.aiModel,
            usageUserId: args.usageUserId,
          });
          if (hasTopicCoverage(regenerated.text, issueKeywords)) {
            repairedPosts[postIndex] = {
              text: regenerated.text,
            };
            repaired = true;
            break;
          }
        }
        if (!repaired) {
          // keep original text if rebuild failed; final validation below will reject if still off-topic
        }
      }

      const remainingOffTopic = calcOffTopicIndexes(repairedPosts);
      if (remainingOffTopic.length === 0) {
        return { briefing, posts: repairedPosts, ai };
      }
      lastError = `주제 키워드 반영 부족(브리핑=ok, 본문 이탈=${remainingOffTopic.join(",") || "없음"})`;
      continue;
    }

    if (issueKeywords.length > 0 && (!briefingCovered || offTopicIndexes.length > 0)) {
      lastError = `주제 키워드 반영 부족(브리핑=${briefingCovered ? "ok" : "off"}, 본문 이탈=${offTopicIndexes.join(",") || "없음"})`;
      continue;
    }

    return { briefing, posts, ai };
  }

  throw new Error(lastError + (lastAi ? ` [provider=${lastAi.provider}, model=${lastAi.model}]` : ""));
}
