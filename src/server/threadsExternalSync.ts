import { MediaType, ScheduledPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureValidAccessToken } from "@/server/threadsToken";
import { listUserThreadsPosts, type UserThreadPost } from "@/server/threadsApi";
import { optionalEnv } from "@/server/env";
import { syncPostInsightsBatch } from "@/server/insights";

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_LIMIT_PER_ACCOUNT = 100;
const DEFAULT_MAX_PAGES = 5;

function errorToString(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function parseIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = optionalEnv(name);
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function mediaTypeFromThreadPost(post: Pick<UserThreadPost, "mediaType">) {
  const raw = (post.mediaType ?? "").toUpperCase();
  if (raw.includes("VIDEO")) return MediaType.VIDEO;
  if (raw.includes("IMAGE") || raw.includes("CAROUSEL")) return MediaType.IMAGE;
  return MediaType.TEXT;
}

function textFromThreadPost(post: UserThreadPost) {
  return (post.text ?? post.permalink ?? "").trim() || "(본문 없음)";
}

function accountDisplayName(account: {
  id: string;
  label: string | null;
  threadsUsername: string | null;
  threadsUserId: string | null;
}) {
  return account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;
}

export async function upsertDirectThreadPost(args: {
  userId: string;
  threadsAccountId: string;
  post: UserThreadPost;
}) {
  const publishedAt = args.post.timestamp ? new Date(args.post.timestamp) : new Date();
  if (Number.isNaN(publishedAt.getTime())) {
    return { ok: false as const, reason: "invalid_timestamp" as const };
  }

  const existing = await prisma.scheduledPost.findFirst({
    where: {
      threadsAccountId: args.threadsAccountId,
      remotePostId: args.post.id,
    },
    select: {
      id: true,
      origin: true,
    },
  });

  if (existing) {
    await prisma.scheduledPost.update({
      where: { id: existing.id },
      data: {
        text: textFromThreadPost(args.post),
        mediaType: mediaTypeFromThreadPost(args.post),
        scheduledAt: publishedAt,
        publishedAt,
        status: ScheduledPostStatus.SUCCESS,
        lastError: null,
      },
    });
    return { ok: true as const, action: "updated" as const, postId: existing.id, origin: existing.origin };
  }

  const created = await prisma.scheduledPost.create({
    data: {
      userId: args.userId,
      threadsAccountId: args.threadsAccountId,
      origin: "DIRECT",
      text: textFromThreadPost(args.post),
      mediaType: mediaTypeFromThreadPost(args.post),
      mediaUrl: null,
      commentText: null,
      commentDelaySeconds: 0,
      scheduledAt: publishedAt,
      publishedAt,
      status: ScheduledPostStatus.SUCCESS,
      remotePostId: args.post.id,
    },
    select: { id: true },
  });

  return { ok: true as const, action: "created" as const, postId: created.id, origin: "DIRECT" as const };
}

export async function syncThreadsExternalPostsBatch(options?: {
  userIds?: string[];
  threadsAccountId?: string;
  lookbackDays?: number;
  limitPerAccount?: number;
  maxPages?: number;
  syncInsights?: boolean;
}) {
  const lookbackDays = Math.max(1, Math.min(options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 90));
  const limitPerAccount = Math.max(1, Math.min(options?.limitPerAccount ?? DEFAULT_LIMIT_PER_ACCOUNT, 100));
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? DEFAULT_MAX_PAGES, 25));
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const until = new Date(Date.now() + 5 * 60 * 1000);

  const accounts = await prisma.threadsAccount.findMany({
    where: {
      ...(options?.userIds && options.userIds.length > 0 ? { userId: { in: options.userIds } } : {}),
      ...(options?.threadsAccountId ? { id: options.threadsAccountId } : {}),
      threadsUserId: { not: null },
    },
    orderBy: [{ userId: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      userId: true,
      label: true,
      threadsUserId: true,
      threadsUsername: true,
      accessTokenEncrypted: true,
      proxyUrlEncrypted: true,
      tokenExpiresAt: true,
    },
  });

  let fetched = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ accountId: string; accountName: string; message: string }> = [];

  for (const account of accounts) {
    if (!account.threadsUserId) {
      skipped += 1;
      continue;
    }

    try {
      const { accessToken, proxyUrl } = await ensureValidAccessToken(account);
      const posts = await listUserThreadsPosts({
        accessToken,
        proxyUrl,
        threadsUserId: account.threadsUserId,
        since,
        until,
        limit: limitPerAccount,
        maxPages,
      });
      fetched += posts.length;

      for (const post of posts) {
        const result = await upsertDirectThreadPost({
          userId: account.userId,
          threadsAccountId: account.id,
          post,
        });
        if (!result.ok) {
          skipped += 1;
        } else if (result.action === "created") {
          created += 1;
        } else {
          updated += 1;
        }
      }
    } catch (err) {
      failed += 1;
      errors.push({
        accountId: account.id,
        accountName: accountDisplayName(account),
        message: errorToString(err),
      });
    }
  }

  const insights =
    options?.syncInsights === false
      ? null
      : await syncPostInsightsBatch({
          userIds: options?.userIds,
          force: true,
          limit: parseIntEnv("THREADS_EXTERNAL_SYNC_INSIGHTS_LIMIT", 300, 1, 1000),
        });

  return {
    scannedAccounts: accounts.length,
    fetched,
    created,
    updated,
    failed,
    skipped,
    lookbackDays,
    insights,
    errors,
  };
}

export function getThreadsExternalSyncOptionsFromEnv() {
  return {
    lookbackDays: parseIntEnv("THREADS_EXTERNAL_SYNC_LOOKBACK_DAYS", DEFAULT_LOOKBACK_DAYS, 1, 90),
    limitPerAccount: parseIntEnv("THREADS_EXTERNAL_SYNC_LIMIT_PER_ACCOUNT", DEFAULT_LIMIT_PER_ACCOUNT, 1, 100),
    maxPages: parseIntEnv("THREADS_EXTERNAL_SYNC_MAX_PAGES", DEFAULT_MAX_PAGES, 1, 25),
  };
}
