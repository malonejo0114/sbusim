import { DailyTopicPlanContentType, MediaType, ScheduledPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueuePublishJob } from "@/server/queue";
import { buildIssueGroundingContext, generateDailyTopicPost, generateIssueBriefingAndPosts } from "@/server/topicGenerator";
import { sendTelegramAlert } from "@/server/telegram";
import { toKstDateKey } from "@/lib/market/time";
import { findMostSimilarText } from "@/server/textSimilarity";
import { getRedisConnection } from "@/server/redis";
import { optionalEnv } from "@/server/env";
import { getAiPromptConfig, type AiPromptConfig } from "@/server/aiPromptSettings";

const KST_TZ = "Asia/Seoul";
const AUTO_SIMILARITY_THRESHOLD_DEFAULT = 72;
const AUTO_SIMILARITY_MAX_RETRY = 4;
const AUTO_SIMILARITY_LOOKBACK = 40;
const AUTO_RESULT_DETAILS_LIMIT_DEFAULT = 80;
const AUTO_BRIEFING_CACHE_TTL_SECONDS = 6 * 60 * 60;

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function hashText(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function pad2(v: number) {
  return String(v).padStart(2, "0");
}

function getKstHourMinute(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KST_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return {
    hour: Number(map.get("hour") ?? "0"),
    minute: Number(map.get("minute") ?? "0"),
  };
}

function getKstWeekdayIso(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TZ,
    weekday: "short",
  }).format(now);

  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[day] ?? 1;
}

function parseWeekdaysCsv(csv: string | null | undefined) {
  const raw = (csv ?? "1,2,3,4,5")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 7);
  return new Set(raw.length > 0 ? raw : [1, 2, 3, 4, 5]);
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

function shuffleWithSeed<T>(arr: T[], seed: string): T[] {
  const rng = createSeededRng(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildTypeSequence(args: {
  total: number;
  infoRatioPercent: number;
  ctaRatioPercent: number;
  fallback: DailyTopicPlanContentType;
  seed: string;
}) {
  const total = Math.max(1, args.total);
  const infoRatio = clampInt(args.infoRatioPercent, 0, 100);
  const ctaRatio = clampInt(args.ctaRatioPercent, 0, 100);

  let infoCount = Math.round((total * infoRatio) / 100);
  let ctaCount = Math.round((total * ctaRatio) / 100);
  if (infoCount + ctaCount > total) {
    const over = infoCount + ctaCount - total;
    ctaCount = Math.max(0, ctaCount - over);
  }
  const topicCount = Math.max(0, total - infoCount - ctaCount);

  const base: DailyTopicPlanContentType[] = [];
  for (let i = 0; i < infoCount; i += 1) base.push(DailyTopicPlanContentType.INFO);
  for (let i = 0; i < ctaCount; i += 1) base.push(DailyTopicPlanContentType.CTA);
  for (let i = 0; i < topicCount; i += 1) base.push(DailyTopicPlanContentType.TOPIC);

  if (base.length === 0) {
    for (let i = 0; i < total; i += 1) base.push(args.fallback);
  }
  return shuffleWithSeed(base, args.seed).slice(0, total);
}

function toWindowRange(dateKey: string, startHour: number, endHour: number) {
  const fromHour = clampInt(startHour, 0, 23);
  const toHour = clampInt(endHour, 0, 23);
  const start = new Date(`${dateKey}T${pad2(Math.min(fromHour, toHour))}:00:00+09:00`);
  const end = new Date(`${dateKey}T${pad2(Math.max(fromHour, toHour))}:59:59+09:00`);
  return { start, end };
}

function typeToLabel(contentType: DailyTopicPlanContentType) {
  if (contentType === DailyTopicPlanContentType.INFO) return "정보성";
  if (contentType === DailyTopicPlanContentType.CTA) return "CTA";
  return "주제형";
}

async function notifyPlanError(args: {
  planId: string;
  accountLabel: string;
  topic: string;
  error: string;
  step: string;
}) {
  await sendTelegramAlert(
    [
      "SBUSIM 자동발행 오류",
      `계정: ${args.accountLabel}`,
      `플랜ID: ${args.planId}`,
      `주제: ${args.topic}`,
      `단계: ${args.step}`,
      `오류: ${args.error}`,
    ].join("\n")
  ).catch(() => {});
}

async function getPlannerGroundingContext(args: {
  userId: string;
  planId: string;
  topic: string;
  promptConfig?: Partial<AiPromptConfig>;
}) {
  const redis = getRedisConnection();
  const slot = Math.floor(Date.now() / (AUTO_BRIEFING_CACHE_TTL_SECONDS * 1000));
  const promptSalt = hashText(args.promptConfig?.issuePackCommonRules ?? "");
  const key = `daily-plan:briefing:v2:${args.userId}:${args.planId}:${slot}:${promptSalt}`;

  try {
    const cached = await redis.get(key);
    if (cached?.trim()) return cached;
  } catch {
    // cache read is best-effort
  }

  let context = "";
  try {
    const preferPerplexity = Boolean(optionalEnv("PERPLEXITY_API_KEY"));
    const generated = await generateIssueBriefingAndPosts({
      issuePrompt: `${args.topic} 최신 이슈 브리핑`,
      templatePrompt: "자동 발행용 6시간 브리핑. 핵심 이슈/변수/체크포인트 중심으로 간결 요약",
      extraPrompt: "최근 6시간 기준 중심. 과거 이슈를 현재처럼 단정하지 말 것.",
      count: 1,
      promptConfig: args.promptConfig,
      aiProvider: preferPerplexity ? "perplexity" : "auto",
      usageUserId: args.userId,
    });
    context = generated.briefing;
  } catch {
    context = "";
  }

  if (!context) {
    context = await buildIssueGroundingContext(`${args.topic} 최신 트렌드 요약`).catch(() => "");
  }

  if (context) {
    try {
      await redis.set(key, context, "EX", AUTO_BRIEFING_CACHE_TTL_SECONDS);
    } catch {
      // cache write is best-effort
    }
  }
  return context;
}

export async function runDailyTopicPlanner(options?: {
  userId?: string;
  threadsAccountId?: string;
  includePostDetails?: boolean;
  maxDetailItems?: number;
}) {
  const now = new Date();
  const nowKstKey = toKstDateKey(now);
  const nowWeekday = getKstWeekdayIso(now);
  const nowHm = getKstHourMinute(now);
  const nowMinutes = nowHm.hour * 60 + nowHm.minute;
  const dayStart = new Date(`${nowKstKey}T00:00:00+09:00`);
  const dayEnd = new Date(`${nowKstKey}T23:59:59+09:00`);

  const includePostDetails = Boolean(options?.includePostDetails);
  const maxDetailItems = clampInt(
    options?.maxDetailItems ?? AUTO_RESULT_DETAILS_LIMIT_DEFAULT,
    1,
    500
  );
  const plans = await prisma.dailyTopicPlan.findMany({
    where: {
      enabled: true,
      ...(options?.userId ? { userId: options.userId } : {}),
      ...(options?.threadsAccountId ? { threadsAccountId: options.threadsAccountId } : {}),
    },
    include: {
      threadsAccount: {
        select: {
          id: true,
          label: true,
          threadsUsername: true,
          threadsUserId: true,
        },
      },
    },
    orderBy: [{ updatedAt: "asc" }],
  });
  const promptConfigByUser = new Map<string, AiPromptConfig>();

  const result = {
    nowKstKey,
    scannedPlans: plans.length,
    processedPlans: 0,
    createdPosts: 0,
    regeneratedBySimilarity: 0,
    highSimilarityWarnings: 0,
    skippedPlans: 0,
    errors: [] as string[],
    createdPostDetails: [] as Array<{
      postId: string;
      planId: string;
      accountId: string;
      accountName: string;
      topic: string;
      contentType: DailyTopicPlanContentType;
      scheduledAt: string;
      similarityScore: number;
      similarityThreshold: number;
      regeneratedAttempts: number;
      text: string;
    }>,
    omittedDetailCount: 0,
  };

  for (const plan of plans) {
    const accountName =
      plan.threadsAccount.label ??
      plan.threadsAccount.threadsUsername ??
      plan.threadsAccount.threadsUserId ??
      plan.threadsAccount.id;

    try {
      const weekdays = parseWeekdaysCsv(plan.weekdaysCsv);
      if (!weekdays.has(nowWeekday)) {
        result.skippedPlans += 1;
        continue;
      }

      const windowStartHour = clampInt(plan.windowStartHour, 0, 23);
      const windowEndHour = clampInt(plan.windowEndHour, 0, 23);
      const windowStartMinutes = Math.min(windowStartHour, windowEndHour) * 60;
      const windowEndMinutes = Math.max(windowStartHour, windowEndHour) * 60 + 59;
      if (nowMinutes < windowStartMinutes || nowMinutes > windowEndMinutes) {
        result.skippedPlans += 1;
        continue;
      }

      const dailyCount = clampInt(plan.dailyCount, 1, 250);
      const intervalMin = clampInt(plan.intervalMinMinutes, 1, 24 * 60);
      const intervalMax = clampInt(plan.intervalMaxMinutes, intervalMin, 24 * 60);
      const typeSeq = buildTypeSequence({
        total: dailyCount,
        infoRatioPercent: plan.infoRatioPercent,
        ctaRatioPercent: plan.ctaRatioPercent,
        fallback: plan.contentType,
        seed: `${plan.id}:${nowKstKey}`,
      });

      const todaysPosts = await prisma.scheduledPost.findMany({
        where: {
          dailyTopicPlanId: plan.id,
          scheduledAt: {
            gte: dayStart,
            lte: dayEnd,
          },
        },
        orderBy: [{ scheduledAt: "asc" }],
        select: { id: true, scheduledAt: true },
      });
      const recentTextRows = await prisma.scheduledPost.findMany({
        where: {
          userId: plan.userId,
          text: { not: "" },
        },
        orderBy: [{ scheduledAt: "desc" }],
        take: AUTO_SIMILARITY_LOOKBACK * 2,
        select: { text: true },
      });

      const existingCount = todaysPosts.length;
      if (existingCount >= dailyCount) {
        result.skippedPlans += 1;
        if (plan.lastGeneratedDate !== nowKstKey) {
          await prisma.dailyTopicPlan.update({
            where: { id: plan.id },
            data: { lastGeneratedDate: nowKstKey, lastGeneratedAt: now, lastError: null },
          });
        }
        continue;
      }

      const { start: windowStartAt, end: windowEndAt } = toWindowRange(nowKstKey, windowStartHour, windowEndHour);
      const rng = createSeededRng(`${plan.id}:${nowKstKey}:slots`);

      let cursor = new Date(Math.max(now.getTime() + 2 * 60 * 1000, windowStartAt.getTime()));
      if (todaysPosts.length > 0) {
        const last = todaysPosts[todaysPosts.length - 1]?.scheduledAt;
        if (last) {
          const nextGap = randomIntBetween(rng, intervalMin, intervalMax);
          cursor = new Date(Math.max(cursor.getTime(), last.getTime() + nextGap * 60 * 1000));
        }
      }

      const remaining = dailyCount - existingCount;
      const toCreate: Array<{ when: Date; contentType: DailyTopicPlanContentType }> = [];
      let seqIndex = existingCount;
      for (let i = 0; i < remaining; i += 1) {
        if (cursor.getTime() > windowEndAt.getTime()) break;
        const contentType = typeSeq[seqIndex] ?? plan.contentType;
        toCreate.push({ when: new Date(cursor), contentType });
        seqIndex += 1;
        const gap = randomIntBetween(rng, intervalMin, intervalMax);
        cursor = new Date(cursor.getTime() + gap * 60 * 1000);
      }

      if (toCreate.length === 0) {
        result.skippedPlans += 1;
        continue;
      }

      let promptConfig = promptConfigByUser.get(plan.userId);
      if (!promptConfig) {
        promptConfig = await getAiPromptConfig(plan.userId);
        promptConfigByUser.set(plan.userId, promptConfig);
      }

      const planGroundingContext = await getPlannerGroundingContext({
        userId: plan.userId,
        planId: plan.id,
        topic: plan.topic,
        promptConfig,
      });
      const recentTexts = recentTextRows
        .map((row) => row.text.trim())
        .filter(Boolean);
      const similarityThresholdPct = clampInt(
        plan.similarityThresholdPct ?? AUTO_SIMILARITY_THRESHOLD_DEFAULT,
        30,
        95
      );
      const similarityThreshold = similarityThresholdPct / 100;

      for (const slot of toCreate) {
        let selected:
          | {
              text: string;
              score: number;
              retriesUsed: number;
            }
          | undefined;

        for (let attempt = 0; attempt < AUTO_SIMILARITY_MAX_RETRY; attempt += 1) {
          const generated = await generateDailyTopicPost({
            topic: plan.topic,
            contentType: slot.contentType as "TOPIC" | "INFO" | "CTA",
            promptConfig,
            promptHint: [
              plan.promptHint?.trim(),
              "최근 이슈/트렌드를 반영해 현재 시점 기준으로 작성",
              `이번 포스트 타입: ${typeToLabel(slot.contentType)}`,
              "같은 사용자의 다른 계정 글과도 주제/첫문장/구성이 겹치지 않게 작성",
              attempt > 0
                ? "직전 게시물과 표현/첫문장/구성을 겹치지 않게 완전히 다른 각도로 재작성"
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            ctaText: plan.ctaText ?? undefined,
            groundingContext: planGroundingContext,
            usageUserId: plan.userId,
          });

          const similarity = findMostSimilarText(generated.text, recentTexts);
          const candidate = {
            text: generated.text,
            score: similarity.score,
            retriesUsed: attempt,
          };
          if (!selected || candidate.score < selected.score) {
            selected = candidate;
          }

          if (candidate.score < similarityThreshold) {
            break;
          }
        }

        if (!selected) {
          throw new Error("자동 생성 결과가 비어 있습니다.");
        }

        if (selected.retriesUsed > 0) {
          result.regeneratedBySimilarity += selected.retriesUsed;
        }
        if (selected.score >= similarityThreshold) {
          result.highSimilarityWarnings += 1;
        }
        recentTexts.push(selected.text);

        const created = await prisma.scheduledPost.create({
          data: {
            userId: plan.userId,
            threadsAccountId: plan.threadsAccountId,
            dailyTopicPlanId: plan.id,
            text: selected.text,
            mediaType: MediaType.TEXT,
            mediaUrl: null,
            commentText: null,
            commentDelaySeconds: 0,
            scheduledAt: slot.when,
            status: ScheduledPostStatus.PENDING,
          },
          select: { id: true, scheduledAt: true },
        });

        await enqueuePublishJob({
          scheduledPostId: created.id,
          delayMs: created.scheduledAt.getTime() - Date.now(),
        });

        if (includePostDetails) {
          if (result.createdPostDetails.length < maxDetailItems) {
            result.createdPostDetails.push({
              postId: created.id,
              planId: plan.id,
              accountId: plan.threadsAccountId,
              accountName,
              topic: plan.topic,
              contentType: slot.contentType,
              scheduledAt: created.scheduledAt.toISOString(),
              similarityScore: selected.score,
              similarityThreshold,
              regeneratedAttempts: selected.retriesUsed,
              text: selected.text,
            });
          } else {
            result.omittedDetailCount += 1;
          }
        }
        result.createdPosts += 1;
      }

      await prisma.dailyTopicPlan.update({
        where: { id: plan.id },
        data: {
          lastGeneratedDate: nowKstKey,
          lastGeneratedAt: now,
          lastError: null,
        },
      });

      result.processedPlans += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${plan.id}: ${message}`);
      await prisma.dailyTopicPlan
        .update({
          where: { id: plan.id },
          data: { lastError: message },
        })
        .catch(() => {});
      if (plan.telegramOnError) {
        await notifyPlanError({
          planId: plan.id,
          accountLabel: accountName,
          topic: plan.topic,
          error: message,
          step: "daily-topic-planner",
        });
      }
    }
  }

  return result;
}
