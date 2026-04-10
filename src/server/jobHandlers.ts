import { MediaType, ScheduledPostStatus, ScheduledReplyStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createContainer, publishContainer } from "@/server/threadsApi";
import { ensureValidAccessToken } from "@/server/threadsToken";
import { enqueueCommentJob, enqueueInsightJob } from "@/server/queue";
import { syncPostInsightsBatch, syncScheduledPostInsightsById } from "@/server/insights";
import { optionalEnv } from "@/server/env";
import { getRedisConnection } from "@/server/redis";
import { isTelegramAlertEnabled, sendTelegramAlert } from "@/server/telegram";
import { runDailyTopicPlanner } from "@/server/dailyTopicPlanner";
import { autoRepairScheduledPostWithAi } from "@/server/topicGenerator";
import { processDuePostQueue, runRssInsightJob } from "@/lib/market/jobs";
import { assertPublicMediaUrlReachable } from "@/server/publicMedia";
import { blockedCommentRetryDelayMs, isCommentActionBlockedError } from "@/server/replyDelays";

function errorToString(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function isPermanentThreadsBlockError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("api access blocked") || message.includes("Threads API 접근이 차단");
}

function parseIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = optionalEnv(name);
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseBoolEnv(name: string, fallback: boolean) {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  const lower = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(lower)) return true;
  if (["0", "false", "no", "n", "off"].includes(lower)) return false;
  return fallback;
}

function parseCsvEnv(name: string) {
  const raw = optionalEnv(name);
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isAiRepairEnabled() {
  const enabled = parseBoolEnv("AUTO_REPAIR_ENABLED", true);
  if (!enabled) return false;
  return Boolean(optionalEnv("GEMINI_API_KEY") || optionalEnv("PERPLEXITY_API_KEY"));
}

function isAiRepairCandidateError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("auto_repair_retry")) return false;
  if (isPermanentThreadsBlockError(message)) return false;
  if (
    lower.includes("permission") ||
    message.includes("권한") ||
    lower.includes("access token") ||
    lower.includes("invalid oauth") ||
    lower.includes("rate limit") ||
    message.includes("미디어 공개 URL") ||
    lower.includes("content-type") ||
    lower.includes("public url")
  ) {
    return false;
  }

  return (
    lower.includes("http 400") ||
    lower.includes("http 413") ||
    lower.includes("http 422") ||
    lower.includes("container create failed") ||
    lower.includes("publish failed")
  );
}

async function canUseAutoRepair(phase: "publish" | "comment", postId: string) {
  if (!isAiRepairEnabled()) return { ok: false, attempt: 0, max: 0 };
  const max = parseIntEnv("AUTO_REPAIR_MAX_ATTEMPTS", 1, 0, 3);
  if (max <= 0) return { ok: false, attempt: 0, max };

  const redis = getRedisConnection();
  const key = `auto-repair:${phase}:${postId}`;
  const attempt = await redis.incr(key).catch(() => 0);
  if (attempt === 1) {
    await redis.expire(key, 60 * 60 * 24 * 14).catch(() => {});
  }
  if (!Number.isFinite(attempt) || attempt <= 0) return { ok: false, attempt: 0, max };
  return { ok: attempt <= max, attempt, max };
}

async function tryAutoRepairForPublish(args: {
  post: {
    id: string;
    userId: string;
    text: string;
    mediaType: MediaType;
    mediaUrl: string | null;
    commentText: string | null;
  };
  errorMessage: string;
}) {
  if (!isAiRepairCandidateError(args.errorMessage)) {
    return { applied: false, reason: "error_not_eligible", attempt: 0, max: 0 } as const;
  }

  const gate = await canUseAutoRepair("publish", args.post.id);
  if (!gate.ok) {
    return { applied: false, reason: "max_attempts_reached", attempt: gate.attempt, max: gate.max } as const;
  }

  try {
    const repaired = await autoRepairScheduledPostWithAi({
      stage: "publish",
      errorMessage: args.errorMessage,
      usageUserId: args.post.userId,
      text: args.post.text,
      mediaType: args.post.mediaType,
      mediaUrl: args.post.mediaUrl,
      commentText: args.post.commentText,
    });

    if (!repaired.canFix) {
      return { applied: false, reason: repaired.reason, attempt: gate.attempt, max: gate.max } as const;
    }

    const next = repaired.patched;
    const changed =
      next.text !== args.post.text ||
      next.mediaType !== args.post.mediaType ||
      (next.mediaUrl ?? null) !== (args.post.mediaUrl ?? null) ||
      (next.commentText ?? null) !== (args.post.commentText ?? null);

    if (!changed) {
      return { applied: false, reason: "no_change", attempt: gate.attempt, max: gate.max } as const;
    }

    await prisma.scheduledPost.update({
      where: { id: args.post.id },
      data: {
        text: next.text,
        mediaType: next.mediaType,
        mediaUrl: next.mediaType === MediaType.TEXT ? null : next.mediaUrl,
        commentText: next.commentText,
        lastError: `AI 자동복구 적용(${repaired.ai.provider}/${repaired.ai.model}): ${repaired.reason}`,
      },
    });

    return {
      applied: true,
      reason: `${repaired.reason} (${repaired.ai.provider}/${repaired.ai.model})`,
      attempt: gate.attempt,
      max: gate.max,
    } as const;
  } catch (err) {
    return {
      applied: false,
      reason: `auto_repair_error: ${errorToString(err)}`,
      attempt: gate.attempt,
      max: gate.max,
    } as const;
  }
}

async function notifyScheduledPostError(args: {
  step: string;
  postId: string;
  accountName: string;
  message: string;
}) {
  await sendTelegramAlert(
    [
      "SBUSIM 발행 오류",
      `단계: ${args.step}`,
      `예약ID: ${args.postId}`,
      `계정: ${args.accountName}`,
      `오류: ${args.message}`,
    ].join("\n")
  ).catch(() => {});
}

async function publishScheduledReplies(args: {
  scheduledPostId: string;
  remotePostId: string;
  accessToken: string;
  proxyUrl?: string;
  accountName: string;
}) {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: args.scheduledPostId },
    select: {
      id: true,
      replies: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          text: true,
          remoteReplyId: true,
        },
      },
    },
  });
  const replies = post?.replies ?? [];

  if (replies.length === 0) {
    await prisma.scheduledPost.update({
      where: { id: args.scheduledPostId },
      data: { status: ScheduledPostStatus.SUCCESS, lastError: null },
    });
    return { ok: true as const, publishedCount: 0 };
  }

  let parentPostId = args.remotePostId;

  for (const reply of replies) {
    if (reply.remoteReplyId) {
      parentPostId = reply.remoteReplyId;
      continue;
    }

    try {
      const container = await createContainer({
        accessToken: args.accessToken,
        mediaType: MediaType.TEXT,
        text: reply.text,
        replyToId: parentPostId,
        proxyUrl: args.proxyUrl,
      });

      const published = await publishContainer({
        accessToken: args.accessToken,
        creationId: container.creationId,
        proxyUrl: args.proxyUrl,
      });

      parentPostId = published.id;
      await prisma.scheduledPostReply.update({
        where: { id: reply.id },
        data: {
          status: ScheduledReplyStatus.SUCCESS,
          remoteReplyId: published.id,
          lastError: null,
        },
      });
    } catch (err) {
      const msg = errorToString(err);
      await prisma.scheduledPostReply.update({
        where: { id: reply.id },
        data: {
          status: ScheduledReplyStatus.FAILED,
          lastError: msg,
        },
      });
      await prisma.scheduledPost.update({
        where: { id: args.scheduledPostId },
        data: {
          status: ScheduledPostStatus.PARTIAL_FAILED,
          lastError: `댓글 ${reply.orderIndex + 1} 발행 실패: ${msg}`,
        },
      });
      await notifyScheduledPostError({
        step: `comment-${reply.orderIndex + 1}`,
        postId: args.scheduledPostId,
        accountName: args.accountName,
        message: msg,
      });
      if (isPermanentThreadsBlockError(msg)) {
        return { ok: false as const, publishedCount: reply.orderIndex, permanent: true as const };
      }
      throw err;
    }
  }

  await prisma.scheduledPost.update({
    where: { id: args.scheduledPostId },
    data: { status: ScheduledPostStatus.SUCCESS, lastError: null },
  });

  return { ok: true as const, publishedCount: replies.length };
}

async function notifyLowViewStreakIfNeeded() {
  if (!isTelegramAlertEnabled()) return;

  const viewThreshold = parseIntEnv("LOW_VIEW_ALERT_THRESHOLD", 100, 1, 10_000_000);
  const lookbackHours = parseIntEnv("LOW_VIEW_ALERT_LOOKBACK_HOURS", 48, 12, 168);
  const minPosts = parseIntEnv("LOW_VIEW_ALERT_MIN_POSTS", 4, 1, 200);
  const cooldownMinutes = parseIntEnv("LOW_VIEW_ALERT_COOLDOWN_MINUTES", 12 * 60, 30, 7 * 24 * 60);

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const rows = await prisma.scheduledPost.findMany({
    where: {
      remotePostId: { not: null },
      scheduledAt: { gte: since },
      status: {
        in: [ScheduledPostStatus.SUCCESS, ScheduledPostStatus.PARTIAL_FAILED, ScheduledPostStatus.RUNNING],
      },
    },
    select: {
      threadsAccountId: true,
      viewsCount: true,
      threadsAccount: {
        select: {
          label: true,
          threadsUsername: true,
          threadsUserId: true,
        },
      },
    },
    orderBy: [{ scheduledAt: "desc" }],
  });

  if (rows.length === 0) return;

  const byAccount = new Map<string, { name: string; count: number; maxViews: number; avgViews: number }>();
  for (const row of rows) {
    const current = byAccount.get(row.threadsAccountId) ?? {
      name:
        row.threadsAccount?.label ??
        row.threadsAccount?.threadsUsername ??
        row.threadsAccount?.threadsUserId ??
        row.threadsAccountId,
      count: 0,
      maxViews: 0,
      avgViews: 0,
    };
    current.count += 1;
    current.maxViews = Math.max(current.maxViews, row.viewsCount);
    current.avgViews += row.viewsCount;
    byAccount.set(row.threadsAccountId, current);
  }

  const struggling = Array.from(byAccount.values())
    .map((item) => ({
      ...item,
      avgViews: item.count > 0 ? item.avgViews / item.count : 0,
    }))
    .filter((item) => item.count >= minPosts && item.maxViews < viewThreshold)
    .sort((a, b) => a.maxViews - b.maxViews);

  const keyBase = optionalEnv("SBUSIM_QUEUE_NAME") ?? "sbusim";
  const redis = getRedisConnection();
  const cacheKey = `alert:low-views:${keyBase}:${lookbackHours}h:${viewThreshold}`;

  if (struggling.length === 0) {
    await redis.del(cacheKey).catch(() => {});
    return;
  }

  const alreadySent = await redis.get(cacheKey).catch(() => null);
  if (alreadySent) return;

  const lines = struggling.slice(0, 8).map((item) => {
    return `- ${item.name}: ${item.count}건, 최고 ${item.maxViews}, 평균 ${item.avgViews.toFixed(1)}`;
  });
  const message = [
    "SBUSIM 성과 알림",
    `최근 ${lookbackHours}시간 기준 조회수 ${viewThreshold}+ 글이 없는 계정이 있습니다.`,
    `조건: 최근 ${lookbackHours}시간 · 최소 ${minPosts}건 이상 발행 계정`,
    ...lines,
  ].join("\n");

  await sendTelegramAlert(message).catch(() => {});
  await redis.set(cacheKey, String(Date.now()), "EX", cooldownMinutes * 60).catch(() => {});
}

export async function handlePublishJob(scheduledPostId: string) {
  const claimed = await prisma.scheduledPost.updateMany({
    where: {
      id: scheduledPostId,
      // Include RUNNING so stalled jobs (worker crash) can be safely re-processed.
      status: {
        in: [
          ScheduledPostStatus.PENDING,
          ScheduledPostStatus.RUNNING,
          ScheduledPostStatus.FAILED,
          ScheduledPostStatus.PARTIAL_FAILED,
        ],
      },
    },
    data: { status: ScheduledPostStatus.RUNNING, lastError: null },
  });
  if (claimed.count === 0) return;

  const post = await prisma.scheduledPost.findUnique({
    where: { id: scheduledPostId },
    include: {
      threadsAccount: true,
      replies: {
        select: { id: true },
      },
    },
  });
  if (!post) return;
  if (!post.threadsAccount) {
    await prisma.scheduledPost.update({
      where: { id: scheduledPostId },
      data: { status: ScheduledPostStatus.FAILED, lastError: "Missing Threads account" },
    });
    throw new Error("Missing Threads account");
  }

  let remotePostId = post.remotePostId ?? null;
  let publishedAt = post.publishedAt ?? null;
  const accountName =
    post.threadsAccount.label ?? post.threadsAccount.threadsUsername ?? post.threadsAccount.threadsUserId ?? post.threadsAccount.id;

  try {
    // Idempotency: if we've already published the main post, never publish again.
    const { accessToken, proxyUrl } = await ensureValidAccessToken(post.threadsAccount);

    if (!remotePostId) {
      const mediaType = post.mediaType as unknown as MediaType;
      if ((mediaType === MediaType.IMAGE || mediaType === MediaType.VIDEO) && post.mediaUrl) {
        await assertPublicMediaUrlReachable({
          url: post.mediaUrl,
          kind: mediaType === MediaType.IMAGE ? "image" : "video",
        });
      }

      const container = await createContainer({
        accessToken,
        mediaType,
        text: post.text,
        imageUrl: mediaType === MediaType.IMAGE ? post.mediaUrl ?? undefined : undefined,
        videoUrl: mediaType === MediaType.VIDEO ? post.mediaUrl ?? undefined : undefined,
        proxyUrl,
      });

      const published = await publishContainer({
        accessToken,
        creationId: container.creationId,
        proxyUrl,
      });
      remotePostId = published.id;
      publishedAt = new Date();

      await prisma.scheduledPost.update({
        where: { id: scheduledPostId },
        data: { remotePostId, publishedAt },
      });
    } else if (!publishedAt) {
      publishedAt = post.scheduledAt;
      await prisma.scheduledPost.update({
        where: { id: scheduledPostId },
        data: { publishedAt },
      });
    }

    const hasReplies = post.replies.length > 0;
    await prisma.scheduledPost.update({
      where: { id: scheduledPostId },
      data: {
        status: hasReplies ? ScheduledPostStatus.RUNNING : ScheduledPostStatus.SUCCESS,
        lastError: null,
      },
    });
    await enqueueInsightJob({ scheduledPostId, delayMs: 30_000 }).catch((err) => {
      console.error("[insights] enqueue failed after publish:", { scheduledPostId, error: errorToString(err) });
    });
    if (hasReplies) {
      await enqueueCommentJob({ scheduledPostId, delayMs: post.commentDelaySeconds * 1000 }).catch((err) => {
        throw new Error(`댓글 큐 등록 실패: ${errorToString(err)}`);
      });
    }
  } catch (err) {
    const msg = errorToString(err);
    const repaired = await tryAutoRepairForPublish({
      post: {
        id: post.id,
        userId: post.userId,
        text: post.text,
        mediaType: post.mediaType as MediaType,
        mediaUrl: post.mediaUrl ?? null,
        commentText: post.commentText ?? null,
      },
      errorMessage: msg,
    });
    if (repaired.applied) {
      await prisma.scheduledPost.update({
        where: { id: scheduledPostId },
        data: {
          status: ScheduledPostStatus.RUNNING,
          lastError: `AI 자동복구 후 재시도 ${repaired.attempt}/${repaired.max}: ${repaired.reason}`,
        },
      });
      throw new Error(`AUTO_REPAIR_RETRY: ${repaired.reason}`);
    }

    const status = remotePostId ? ScheduledPostStatus.PARTIAL_FAILED : ScheduledPostStatus.FAILED;
    await prisma.scheduledPost.update({
      where: { id: scheduledPostId },
      data: { status, lastError: msg },
    });
    await notifyScheduledPostError({
      step: "publish",
      postId: scheduledPostId,
      accountName,
      message: msg,
    });
    if (isPermanentThreadsBlockError(msg)) return;
    throw err;
  }
}

export async function handleCommentJob(scheduledPostId: string) {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: scheduledPostId },
    include: {
      threadsAccount: true,
      replies: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          text: true,
          remoteReplyId: true,
        },
      },
    },
  });
  if (!post?.remotePostId) return;
  if (!post.threadsAccount) {
    await prisma.scheduledPost.update({
      where: { id: scheduledPostId },
      data: { status: ScheduledPostStatus.PARTIAL_FAILED, lastError: "Missing Threads account" },
    });
    throw new Error("Missing Threads account");
  }

  const pendingReplies = post.replies.filter((reply) => !reply.remoteReplyId);
  if (pendingReplies.length === 0) {
    await prisma.scheduledPost.update({
      where: { id: scheduledPostId },
      data: { status: ScheduledPostStatus.SUCCESS, lastError: null },
    });
    return;
  }

  await prisma.scheduledPost.update({
    where: { id: scheduledPostId },
    data: { status: ScheduledPostStatus.RUNNING, lastError: null },
  });

  const accountName =
    post.threadsAccount.label ??
    post.threadsAccount.threadsUsername ??
    post.threadsAccount.threadsUserId ??
    post.threadsAccount.id;

  const { accessToken, proxyUrl } = await ensureValidAccessToken(post.threadsAccount);
  try {
    const result = await publishScheduledReplies({
      scheduledPostId,
      remotePostId: post.remotePostId,
      accessToken,
      proxyUrl,
      accountName,
    });
    if (!result.ok && result.permanent) return;
  } catch (err) {
    const message = errorToString(err);
    if (!isCommentActionBlockedError(message)) {
      throw err;
    }

    const delayMs = blockedCommentRetryDelayMs(post.commentDelaySeconds);
    await prisma.scheduledPostReply.updateMany({
      where: {
        scheduledPostId,
        remoteReplyId: null,
      },
      data: {
        status: ScheduledReplyStatus.PENDING,
        lastError: message,
      },
    });
    await prisma.scheduledPost.update({
      where: { id: scheduledPostId },
      data: {
        status: ScheduledPostStatus.RUNNING,
        lastError: `댓글 작성 제한 감지: ${Math.max(1, Math.round(delayMs / 60000))}분 후 자동 재시도`,
      },
    });
    await enqueueCommentJob({ scheduledPostId, delayMs });
  }
}

export async function handleInsightJob(scheduledPostId: string) {
  const result = await syncScheduledPostInsightsById(scheduledPostId);
  if (!result.ok && result.reason !== "not_found" && result.reason !== "missing_remote_or_account") {
    if (isPermanentThreadsBlockError(result.reason)) return;
    throw new Error(result.reason);
  }
}

export async function handleInsightsSyncJob() {
  const result = await syncPostInsightsBatch({ force: false, limit: 150 });
  console.log("[insights] sync batch:", result);
  await notifyLowViewStreakIfNeeded();
}

export async function handleDailyTopicPlannerJob() {
  const result = await runDailyTopicPlanner();
  console.log("[daily-topic-planner] result:", result);
}

export async function handlePostQueueDispatchJob() {
  const batchSize = parseIntEnv("POST_QUEUE_DISPATCH_BATCH", 20, 1, 200);
  const result = await processDuePostQueue(batchSize);
  if (result.dueCount > 0 || result.failedCount > 0) {
    console.log("[post-queue-dispatch] result:", result);
  }
  return result;
}

export async function handleRssReviewHourlyJob() {
  const maxDraftsPerRun = parseIntEnv("RSS_REVIEW_MAX_DRAFTS", 3, 1, 20);
  const targetAccountIds = parseCsvEnv("RSS_REVIEW_TARGET_ACCOUNT_IDS");

  const enabledAccounts = await prisma.threadsAccount.findMany({
    where: {
      rssReviewEnabled: true,
      ...(targetAccountIds.length > 0 ? { id: { in: targetAccountIds } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      label: true,
      threadsUserId: true,
      threadsUsername: true,
      rssIncludeSources: true,
      rssAutoPostEnabled: true,
      rssAutoPostMinIntervalMinutes: true,
      rssAutoPostMaxIntervalMinutes: true,
      rssFetchCount: true,
      rssKeywordIncludeCsv: true,
      rssKeywordExcludeCsv: true,
      rssPromptTemplate: true,
    },
  });

  if (enabledAccounts.length === 0) {
    console.log("[rss-review-hourly] skipped: no enabled account");
    return { skipped: true as const, reason: "no_enabled_account" as const };
  }

  const createdRows: Array<{ queueId: string; title: string; accountId: string }> = [];

  for (const account of enabledAccounts) {
    if (createdRows.length >= maxDraftsPerRun) break;
    const remaining = Math.max(1, maxDraftsPerRun - createdRows.length);
    const accountCreateCount = Math.max(1, Math.min(account.rssFetchCount, remaining));
    const result = await runRssInsightJob({
      includeSources: account.rssIncludeSources,
      autoPost: account.rssAutoPostEnabled,
      autoPostMinIntervalMinutes: account.rssAutoPostMinIntervalMinutes,
      autoPostMaxIntervalMinutes: account.rssAutoPostMaxIntervalMinutes,
      maxCreateCount: accountCreateCount,
      targetThreadsAccountId: account.id,
      targetAccountLabel: account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id,
      keywordIncludeCsv: account.rssKeywordIncludeCsv,
      keywordExcludeCsv: account.rssKeywordExcludeCsv,
      promptTemplate: account.rssPromptTemplate,
      requireTargetAccount: true,
    });
    const rows = result.createdRows ?? [];
    if (rows.length === 0) continue;
    for (const row of rows) {
      createdRows.push({ queueId: row.queueId, title: row.title, accountId: account.id });
      if (createdRows.length >= maxDraftsPerRun) break;
    }
  }

  console.log("[rss-review-hourly] created drafts:", createdRows.length);
  return { createdCount: createdRows.length, createdRows };
}
