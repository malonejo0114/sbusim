import { DailyTopicPlanContentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateDailyTopicPost } from "@/server/topicGenerator";
import { findMostSimilarText } from "@/server/textSimilarity";
import { getAiPromptConfig } from "@/server/aiPromptSettings";

const ISSUE_PACK_SIMILARITY_THRESHOLD = 0.72;
const ISSUE_PACK_SIMILARITY_MAX_RETRY = 5;
const ISSUE_PACK_REWRITE_MAX_RETRY = 2;
const ISSUE_PACK_CONCURRENCY = 4;
const CTA_SIGNAL_REGEX =
  /(프로필|링크|참여|신청|합류|모집|선착순|마감|입장|오픈채팅|들어오|들어와|클릭|자리|인원|합류해|와보|오셈|보셈|지켜보)/i;
const INFO_SIGNAL_REGEX = /(코스피|코스닥|나스닥|s&p|다우|원유|금리|환율|달러|지표|시황|브리핑|실적|cpi|ppi|fomc|연준|미장|국장)/i;
const HASH_TAG_REGEX = /#[^\s#]+/g;

type AiProviderInput = "auto" | "gemini" | "perplexity";

export type MultiAccountIssueDraft = {
  draftId: string;
  threadsAccountId: string;
  accountName: string;
  contentType: "INFO" | "CTA";
  text: string;
  scheduledAt: string;
};

export type MultiAccountIssuePackResult = {
  ai: {
    provider: string;
    model: string;
  };
  writingAi: {
    provider: string;
    model: string;
  };
  contextSummary: string;
  drafts: MultiAccountIssueDraft[];
};

export type MultiAccountIssuePackProgress = {
  totalTasks: number;
  completedTasks: number;
  accountName?: string;
  contentType?: "INFO" | "CTA";
  message?: string;
};

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createSeededRng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIntBetween(rng: () => number, min: number, max: number) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

function buildNoConsecutiveCtaSequence(args: {
  total: number;
  ctaRatioMinPercent: number;
  ctaRatioMaxPercent: number;
  seed: string;
}) {
  const total = clampInt(args.total, 1, 10);
  const rng = createSeededRng(args.seed);
  const ratioMin = clampInt(args.ctaRatioMinPercent, 0, 100);
  const ratioMax = clampInt(args.ctaRatioMaxPercent, ratioMin, 100);
  const ratio = randomIntBetween(rng, ratioMin, ratioMax);

  let ctaCount = Math.round((total * ratio) / 100);
  ctaCount = Math.min(ctaCount, Math.ceil(total / 2));
  const infoCount = Math.max(0, total - ctaCount);

  const seq: Array<"INFO" | "CTA"> = Array.from({ length: infoCount }, () => "INFO");
  if (seq.length === 0) {
    seq.push("INFO");
  }

  const slots = Array.from({ length: seq.length + 1 }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const chosen = slots.slice(0, ctaCount).sort((a, b) => a - b);

  let offset = 0;
  for (const slot of chosen) {
    seq.splice(slot + offset, 0, "CTA");
    offset += 1;
  }

  for (let i = 1; i < seq.length; i += 1) {
    if (seq[i] === "CTA" && seq[i - 1] === "CTA") {
      const swapIdx = seq.findIndex((v, idx) => idx > i && v === "INFO");
      if (swapIdx > i) {
        [seq[i], seq[swapIdx]] = [seq[swapIdx], seq[i]];
      } else {
        seq[i] = "INFO";
      }
    }
  }

  return seq.slice(0, total);
}

function buildAccountSchedule(args: {
  count: number;
  minGapMinutes: number;
  maxGapMinutes: number;
  startAt: Date;
  seed: string;
}) {
  const rng = createSeededRng(args.seed);
  const minGap = clampInt(args.minGapMinutes, 1, 24 * 60);
  const maxGap = clampInt(args.maxGapMinutes, minGap, 24 * 60);
  const count = clampInt(args.count, 1, 10);

  const out: Date[] = [];
  let cursor = new Date(args.startAt);
  for (let i = 0; i < count; i += 1) {
    out.push(new Date(cursor));
    const gap = randomIntBetween(rng, minGap, maxGap);
    cursor = new Date(cursor.getTime() + gap * 60 * 1000);
  }
  return out;
}

function accountDisplayName(account: { id: string; label: string | null; threadsUsername: string | null; threadsUserId: string | null }) {
  return account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;
}

function normalizeSourceContext(value?: string) {
  const normalized = (value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return "";
  return normalized.slice(0, 12000);
}

function compressSourceContextForPrompt(sourceContext: string) {
  const normalized = normalizeSourceContext(sourceContext);
  if (!normalized) return "";
  if (normalized.length <= 3200) return normalized;

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const picked: string[] = [];
  for (const line of lines) {
    if (picked.join("\n").length >= 3200) break;
    picked.push(line);
  }

  const compact = picked.join("\n");
  if (compact.length <= 3200) return compact;

  const head = compact.slice(0, 3200);
  const breakIdx = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". "), head.lastIndexOf(" "));
  if (breakIdx >= Math.floor(3200 * 0.7)) {
    return head.slice(0, breakIdx).trim();
  }
  return head.trim();
}

function normalizeDraftTextByType(text: string, contentType: "INFO" | "CTA") {
  void contentType;
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\*\*/g, "")
    .replace(HASH_TAG_REGEX, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  const lines = normalized
    .split("\n")
    .map((line) => line.replace(HASH_TAG_REGEX, "").trim())
    .filter(Boolean);

  return lines.join("\n\n").trim();
}

function lineLooksCta(line: string) {
  const normalized = line.replace(HASH_TAG_REGEX, "").trim();
  if (!normalized) return false;
  return CTA_SIGNAL_REGEX.test(normalized);
}

function lineLooksInfo(line: string) {
  const normalized = line.replace(HASH_TAG_REGEX, "").trim();
  if (!normalized) return false;
  if (/[+-]?\d+(\.\d+)?\s*%/.test(normalized)) return true;
  if (/\d{1,3}(,\d{3})+/.test(normalized)) return true;
  if (/(원|달러|usd|krw|포인트|pt)/i.test(normalized)) return true;
  return INFO_SIGNAL_REGEX.test(normalized);
}

function validateDraftType(text: string, contentType: "INFO" | "CTA") {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const ctaSignals = lines.filter((line) => lineLooksCta(line)).length;
  const infoSignals = lines.filter((line) => lineLooksInfo(line)).length;

  if (contentType === "INFO") {
    if (ctaSignals > 0) return { ok: false, reason: `정보성 글에 CTA 신호(${ctaSignals})` };
    if (infoSignals === 0) return { ok: false, reason: "정보성 신호 부족" };
    return { ok: true as const };
  }

  if (infoSignals > 0) return { ok: false, reason: `CTA 글에 정보성 신호(${infoSignals})` };
  if (ctaSignals === 0) return { ok: false, reason: "CTA 행동 유도 신호 부족" };
  if (lines.length < 3 || lines.length > 6) return { ok: false, reason: `CTA 줄 수 규칙 위반(${lines.length}줄)` };
  return { ok: true as const };
}

function coerceDraftByType(text: string, contentType: "INFO" | "CTA") {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (contentType === "CTA") {
    const ctaOnly = lines.filter((line) => lineLooksCta(line) && !lineLooksInfo(line));
    const fallback = lines.filter((line) => !lineLooksInfo(line));
    const picked = (ctaOnly.length > 0 ? ctaOnly : fallback).slice(0, 6);
    return picked.join("\n\n").trim();
  }

  const infoOnly = lines.filter((line) => lineLooksInfo(line) && !lineLooksCta(line));
  const fallback = lines.filter((line) => !lineLooksCta(line));
  return (infoOnly.length > 0 ? infoOnly : fallback).join("\n\n").trim();
}

export async function generateMultiAccountIssuePack(args: {
  userId: string;
  accountIds: string[];
  sourceContext: string;
  templatePrompt?: string;
  countPerAccount: number;
  minGapMinutes: number;
  maxGapMinutes: number;
  ctaRatioMinPercent: number;
  ctaRatioMaxPercent: number;
  aiProvider?: AiProviderInput;
  aiModel?: string;
  writingAiProvider?: AiProviderInput;
  writingAiModel?: string;
  startAt?: string;
  onProgress?: (progress: MultiAccountIssuePackProgress) => void;
}): Promise<MultiAccountIssuePackResult> {
  const accountIds = Array.from(new Set(args.accountIds.map((v) => v.trim()).filter(Boolean)));
  if (accountIds.length === 0) {
    throw new Error("선택한 계정이 없습니다.");
  }

  const sourceContext = normalizeSourceContext(args.sourceContext);
  if (!sourceContext) {
    throw new Error("오늘 자료를 입력해 주세요.");
  }
  const sourceContextForPrompt = compressSourceContextForPrompt(sourceContext);

  const accounts = await prisma.threadsAccount.findMany({
    where: {
      userId: args.userId,
      id: { in: accountIds },
    },
    select: {
      id: true,
      label: true,
      threadsUsername: true,
      threadsUserId: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (accounts.length !== accountIds.length) {
    throw new Error("선택 계정 일부를 찾을 수 없습니다.");
  }

  const templatePrompt = args.templatePrompt?.trim() || "";
  const promptConfig = await getAiPromptConfig(args.userId);

  const startAt = (() => {
    if (!args.startAt) return new Date(Date.now() + 10 * 60 * 1000);
    const d = new Date(args.startAt);
    if (Number.isNaN(d.getTime())) return new Date(Date.now() + 10 * 60 * 1000);
    return d;
  })();

  const countPerAccount = clampInt(args.countPerAccount, 1, 10);
  const totalTasks = accounts.length * countPerAccount;
  const similarityMaxRetry = totalTasks >= 40 ? 2 : ISSUE_PACK_SIMILARITY_MAX_RETRY;
  args.onProgress?.({
    totalTasks,
    completedTasks: 0,
    message: `총 ${totalTasks}건 초안 생성을 시작합니다.`,
  });

  const recentRows = await prisma.scheduledPost.findMany({
    where: {
      userId: args.userId,
      text: { not: "" },
    },
    orderBy: [{ scheduledAt: "desc" }],
    take: 120,
    select: { text: true },
  });
  const recentTexts = recentRows
    .map((row) => row.text.trim())
    .filter(Boolean);

  const effectiveProvider = args.writingAiProvider ?? args.aiProvider ?? "auto";
  const effectiveModel = args.writingAiModel?.trim() || args.aiModel?.trim() || undefined;

  let writingAi:
    | {
        provider: string;
        model: string;
      }
    | null = null;

  type GenerationTask = {
    order: number;
    slotIndex: number;
    accountId: string;
    accountName: string;
    contentType: "INFO" | "CTA";
    scheduledAtIso: string;
  };

  const tasks: GenerationTask[] = [];
  let globalOrder = 0;

  for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
    const account = accounts[accountIndex];
    const accountName = accountDisplayName(account);

    const slots = buildAccountSchedule({
      count: countPerAccount,
      minGapMinutes: args.minGapMinutes,
      maxGapMinutes: args.maxGapMinutes,
      startAt: new Date(startAt.getTime() + accountIndex * 2 * 60 * 1000),
      seed: `schedule:${account.id}:${startAt.toISOString()}`,
    });

    const typeSeq = buildNoConsecutiveCtaSequence({
      total: countPerAccount,
      ctaRatioMinPercent: args.ctaRatioMinPercent,
      ctaRatioMaxPercent: args.ctaRatioMaxPercent,
      seed: `type:${account.id}:${startAt.toISOString()}`,
    });

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const contentType = typeSeq[slotIndex] === "CTA" ? DailyTopicPlanContentType.CTA : DailyTopicPlanContentType.INFO;
      tasks.push({
        order: globalOrder,
        slotIndex,
        accountId: account.id,
        accountName,
        contentType: contentType === DailyTopicPlanContentType.CTA ? "CTA" : "INFO",
        scheduledAtIso: slots[slotIndex].toISOString(),
      });
      globalOrder += 1;
    }
  }

  const draftByOrder = new Map<number, MultiAccountIssueDraft>();
  let cursor = 0;
  let completedTasks = 0;

  const workerCount = Math.max(1, Math.min(ISSUE_PACK_CONCURRENCY, tasks.length));
  const workers = Array.from({ length: workerCount }).map(async () => {
    while (true) {
      const taskIndex = cursor;
      cursor += 1;
      if (taskIndex >= tasks.length) break;
      const task = tasks[taskIndex];
      let selected:
        | {
            text: string;
            score: number;
            typeReason?: string;
            ai: {
              provider: string;
              model: string;
            };
          }
        | undefined;
      let lastTypeError = "";
      let lastGeneratedText = "";
      let lastAi: { provider: string; model: string } | null = null;

      for (let attempt = 0; attempt < similarityMaxRetry; attempt += 1) {
        const typeRule =
          task.contentType === "CTA"
            ? [
                "CTA 글 규칙:",
                "- 시황/지표/뉴스/가격/퍼센트 등 정보성 설명 금지",
                "- 행동 유도 문장만 작성",
                "- 3~6줄로 간결하게 작성",
                "- 오늘 자료/시장 데이터/숫자를 절대 인용하지 말 것",
              ].join("\n")
            : [
                "정보성 글 규칙:",
                "- 행동 유도(프로필 링크/신청/참여/모집/선착순/마감) 금지",
                "- 오늘 자료에 있는 팩트 중심 요약",
                "- 전문가 톤으로 정보 전달만 수행",
              ].join("\n");
        const contextBlock =
          task.contentType === "CTA"
            ? "오늘 자료를 직접 인용하지 말고, 행동 유도 목적의 문장만 작성하세요."
            : `오늘 자료:\n${sourceContextForPrompt}`;
        const directPrompt = [
          templatePrompt ? `사용자 프롬프트:\n${templatePrompt}` : "",
          `콘텐츠 타입: ${task.contentType}`,
          typeRule,
          "자료에 없는 사실/수치/사건은 추가하지 마세요.",
          contextBlock,
          `이번 글 순번: ${task.slotIndex + 1}/${countPerAccount}`,
          "다른 글과 주제/첫 문장/문단 구성을 겹치지 마세요.",
          "출력은 본문만 작성하고, INFO/CTA 라벨이나 괄호 표기, 해시태그를 넣지 마세요.",
          attempt > 0 ? "이전 생성 결과와 첫 문장/문단 구성/어휘를 다르게 재작성하세요." : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const generated = await generateDailyTopicPost({
          topic: "오늘 자료 기반 생성",
          contentType: task.contentType,
          promptConfig,
          promptHint: directPrompt,
          groundingContext: task.contentType === "INFO" ? sourceContextForPrompt : "",
          directPromptMode: task.contentType === "INFO",
          ctaText: undefined,
          aiProvider: effectiveProvider,
          aiModel: effectiveModel,
          usageUserId: args.userId,
        });

        lastGeneratedText = generated.text;
        lastAi = generated.ai;

        const cleanedText = normalizeDraftTextByType(generated.text, task.contentType);
        const typeCheck = validateDraftType(cleanedText, task.contentType);
        if (!typeCheck.ok) {
          lastTypeError = typeCheck.reason;
          continue;
        }

        const similarity = findMostSimilarText(cleanedText, recentTexts);
        const candidate = {
          text: cleanedText,
          score: similarity.score,
          typeReason: undefined,
          ai: {
            provider: generated.ai.provider,
            model: generated.ai.model,
          },
        };

        if (!selected || candidate.score < selected.score) {
          selected = candidate;
        }
        if (candidate.score < ISSUE_PACK_SIMILARITY_THRESHOLD) {
          break;
        }
      }

      if (!selected && lastGeneratedText) {
        for (let rewriteAttempt = 0; rewriteAttempt < ISSUE_PACK_REWRITE_MAX_RETRY; rewriteAttempt += 1) {
          const rewritePrompt =
            task.contentType === "CTA"
              ? [
                  templatePrompt ? `사용자 프롬프트:\n${templatePrompt}` : "",
                  "아래 원문을 CTA 전용 글로 재작성하세요.",
                  "- 정보성 설명/수치/지표/시황 언급 금지",
                  "- 행동 유도 문장만 3~6줄",
                  "- 해시태그/라벨/괄호 금지",
                  `원문:\n${lastGeneratedText}`,
                ]
                  .filter(Boolean)
                  .join("\n\n")
              : [
                  templatePrompt ? `사용자 프롬프트:\n${templatePrompt}` : "",
                  "아래 원문을 정보성 전용 글로 재작성하세요.",
                  "- 행동 유도 문장(링크/참여/신청/모집/선착순/마감) 금지",
                  "- 오늘 자료 범위 내 팩트 중심 4~8줄",
                  "- 해시태그/라벨/괄호 금지",
                  `오늘 자료:\n${sourceContextForPrompt}`,
                  `원문:\n${lastGeneratedText}`,
                ]
                  .filter(Boolean)
                  .join("\n\n");

          const rewritten = await generateDailyTopicPost({
            topic: "타입 정제 재작성",
            contentType: task.contentType,
            promptConfig,
            promptHint: rewritePrompt,
            groundingContext: sourceContextForPrompt,
            directPromptMode: true,
            ctaText: undefined,
            aiProvider: effectiveProvider,
            aiModel: effectiveModel,
            usageUserId: args.userId,
          });

          lastGeneratedText = rewritten.text;
          lastAi = rewritten.ai;

          const rewrittenCleaned = normalizeDraftTextByType(rewritten.text, task.contentType);
          const rewrittenType = validateDraftType(rewrittenCleaned, task.contentType);
          if (!rewrittenType.ok) {
            lastTypeError = rewrittenType.reason;
            continue;
          }

          const similarity = findMostSimilarText(rewrittenCleaned, recentTexts);
          selected = {
            text: rewrittenCleaned,
            score: similarity.score,
            typeReason: "rewrite",
            ai: {
              provider: rewritten.ai.provider,
              model: rewritten.ai.model,
            },
          };
          break;
        }
      }

      if (!selected && lastGeneratedText && lastAi) {
        const coerced = coerceDraftByType(normalizeDraftTextByType(lastGeneratedText, task.contentType), task.contentType);
        const coercedType = validateDraftType(coerced, task.contentType);
        if (coercedType.ok) {
          const similarity = findMostSimilarText(coerced, recentTexts);
          selected = {
            text: coerced,
            score: similarity.score,
            typeReason: "coerce",
            ai: {
              provider: lastAi.provider,
              model: lastAi.model,
            },
          };
        }
      }

      if (!selected) {
        throw new Error(
          `${task.accountName} ${task.contentType} 초안 생성 실패: ${lastTypeError || "생성 결과가 규칙을 충족하지 못했습니다."}`
        );
      }
      if (!writingAi) {
        writingAi = {
          provider: selected.ai.provider,
          model: selected.ai.model,
        };
      }
      recentTexts.push(selected.text);

      draftByOrder.set(task.order, {
        draftId: `${task.accountId}-${task.slotIndex}-${Date.now()}-${task.order}`,
        threadsAccountId: task.accountId,
        accountName: task.accountName,
        contentType: task.contentType,
        text: selected.text,
        scheduledAt: task.scheduledAtIso,
      });

      completedTasks += 1;
      args.onProgress?.({
        totalTasks,
        completedTasks,
        accountName: task.accountName,
        contentType: task.contentType,
        message: `${task.accountName} · ${task.slotIndex + 1}/${countPerAccount} 생성 완료`,
      });
    }
  });

  await Promise.all(workers);

  const drafts = tasks
    .sort((a, b) => a.order - b.order)
    .map((task) => draftByOrder.get(task.order))
    .filter((row): row is MultiAccountIssueDraft => Boolean(row));

  if (!writingAi) {
    throw new Error("초안 생성 결과가 없습니다.");
  }

  args.onProgress?.({
    totalTasks,
    completedTasks: totalTasks,
    message: "초안 생성이 완료되었습니다.",
  });

  return {
    ai: writingAi,
    writingAi,
    contextSummary: sourceContext.slice(0, 240),
    drafts,
  };
}
