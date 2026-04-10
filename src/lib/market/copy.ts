import { optionalEnv } from "@/server/env";
import { fetchJsonWithRetry } from "@/lib/market/net";
import type { SourceLink } from "@/lib/market/types";

type SnapshotCopyInput = {
  asofDate: string;
  items: Array<{ label: string; last: number; dailyPct: number }>;
  sources: SourceLink[];
  includeSources: boolean;
};

type CalendarCopyInput = {
  asofDate: string;
  topEvents: Array<{ timeKst: string; country: string; event: string; importance: number }>;
  sources: SourceLink[];
  includeSources: boolean;
};

type CotCopyInput = {
  reportDate: string;
  topMoves: Array<{ marketCode: string; net: number; wow: number }>;
  sources: SourceLink[];
  includeSources: boolean;
};

type RssCopyInput = {
  topicTitle: string;
  summary: string;
  link: string;
  sourceName: string;
  sources: SourceLink[];
  includeSources: boolean;
  promptTemplate?: string | null;
};

function signPct(v: number) {
  if (!Number.isFinite(v)) return "0.00";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

function buildSourceLines(sources: SourceLink[], include: boolean) {
  if (!include || sources.length === 0) return "";
  const lines = sources
    .slice(0, 4)
    .map((s, idx) => `${idx + 1}) ${s.name}: ${s.url}`)
    .join("\n");
  return `\n\n출처\n${lines}`;
}

async function polishWithGemini(baseText: string) {
  const apiKey = optionalEnv("GEMINI_API_KEY");
  if (!apiKey) return baseText;

  const model = optionalEnv("GEMINI_MODEL") ?? "gemini-2.0-flash";
  const url = new URL(
    optionalEnv("GEMINI_API_URL") ?? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  );
  if (!url.searchParams.has("key")) url.searchParams.set("key", apiKey);

  const systemPrompt = [
    "당신은 금융 콘텐츠 에디터다.",
    "과장 금지, 단정적 예측 금지, 투자 권유 금지.",
    "숫자와 사실을 유지하고 문장만 간결하게 다듬어라.",
    "반드시 plain text 하나만 출력한다.",
  ].join("\n");

  try {
    const json = await fetchJsonWithRetry<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(
      url.toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: baseText }] }],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      },
      { timeoutMs: 20_000, retries: 2 }
    );

    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (text) return text;
  } catch {
    // LLM 실패 시 룰 기반 문장 사용
  }

  return baseText;
}

async function generateWithGemini(promptText: string) {
  const apiKey = optionalEnv("GEMINI_API_KEY");
  if (!apiKey) return "";

  const model = optionalEnv("GEMINI_MODEL") ?? "gemini-2.0-flash";
  const url = new URL(
    optionalEnv("GEMINI_API_URL") ?? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  );
  if (!url.searchParams.has("key")) url.searchParams.set("key", apiKey);

  const systemPrompt = [
    "당신은 금융 콘텐츠 에디터다.",
    "과장 금지, 단정적 예측 금지, 투자 권유 금지.",
    "사실을 보존하고 한국어로 매끄럽게 작성하라.",
    "반드시 plain text 본문 하나만 출력하고 500자를 넘기지 마라.",
  ].join("\n");

  try {
    const json = await fetchJsonWithRetry<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(
      url.toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.35,
          },
        }),
      },
      { timeoutMs: 20_000, retries: 2 }
    );

    return (json.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  } catch {
    return "";
  }
}

function applyRssPromptTemplate(template: string, input: RssCopyInput) {
  return template
    .replaceAll("{{topicTitle}}", input.topicTitle)
    .replaceAll("{{summary}}", input.summary)
    .replaceAll("{{link}}", input.link)
    .replaceAll("{{sourceName}}", input.sourceName);
}

export async function buildDailySnapshotCopy(input: SnapshotCopyInput) {
  const line = input.items
    .map((item) => `${item.label} ${signPct(item.dailyPct)}% (${item.last.toLocaleString()})`)
    .join(" | ");

  const hint = input.items
    .map((item) => `${item.label} ${item.dailyPct >= 0 ? "강세" : "약세"}`)
    .join(", ");

  const base = [
    `[${input.asofDate} 시장 스냅샷]`,
    line,
    `요약: ${hint}. 단기 변동성 확대 구간에서는 리스크 관리 우선으로 보세요.`,
  ].join("\n");

  const polished = await polishWithGemini(base);
  return `${polished}${buildSourceLines(input.sources, input.includeSources)}`.slice(0, 500);
}

export async function buildDailyCalendarCopy(input: CalendarCopyInput) {
  const top = input.topEvents.slice(0, 5);
  const eventsText = top.map((e, i) => `${i + 1}. ${e.timeKst} ${e.country} ${e.event}`).join("\n");
  const highVol = top.map((e) => e.timeKst).filter(Boolean).join(", ");

  const base = [
    `[${input.asofDate} 경제 캘린더 TOP${top.length}]`,
    eventsText,
    `변동성 높은 시간(KST): ${highVol || "주요 고중요 이벤트 시간 확인 필요"}`,
  ].join("\n");

  const polished = await polishWithGemini(base);
  return `${polished}${buildSourceLines(input.sources, input.includeSources)}`.slice(0, 500);
}

export async function buildWeeklyCotCopy(input: CotCopyInput) {
  const top = input.topMoves.slice(0, 3);
  const body = top
    .map((item, idx) => `${idx + 1}. ${item.marketCode} 순포지션 ${item.net.toLocaleString()} (WoW ${signPct(item.wow)})`)
    .join("\n");

  const base = [
    `[COT 주간 체크 ${input.reportDate}]`,
    body,
    "해석: 포지션 변화는 추세 참고 지표이며, 단기 가격 방향을 단정하지 않습니다.",
  ].join("\n");

  const polished = await polishWithGemini(base);
  return `${polished}${buildSourceLines(input.sources, input.includeSources)}`.slice(0, 500);
}

export async function buildRssInsightCopy(input: RssCopyInput) {
  const base = [
    `[이슈 브리핑] ${input.topicTitle}`,
    input.summary,
    `원문: ${input.link}`,
    `요약 출처: ${input.sourceName}`,
  ].join("\n");

  const customPrompt = (input.promptTemplate ?? "").trim();
  if (customPrompt) {
    const prompt = applyRssPromptTemplate(customPrompt, input);
    const generated = await generateWithGemini(prompt);
    if (generated) {
      return `${generated}${buildSourceLines(input.sources, input.includeSources)}`.slice(0, 500);
    }
  }

  const polished = await polishWithGemini(base);
  return `${polished}${buildSourceLines(input.sources, input.includeSources)}`.slice(0, 500);
}
