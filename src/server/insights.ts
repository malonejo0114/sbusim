import { ScheduledPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureValidAccessToken } from "@/server/threadsToken";
import { upsertFollowerSnapshot, toKstDateKey } from "@/server/followerStats";
import { getPostEngagement, getUserFollowersCount } from "@/server/threadsApi";

const INSIGHT_STALE_MS = 2 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 14;

function errorToString(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function isMissingInsightsPermission(message: string) {
  return (
    message.includes("Threads 인사이트 권한이 없습니다") ||
    message.includes("Threads 팔로워 인사이트 권한이 없습니다") ||
    message.includes("Threads API 접근이 차단") ||
    message.toLowerCase().includes("api access blocked")
  );
}

async function syncFollowerSnapshotsBatch(args?: {
  userId?: string;
  threadsAccountId?: string;
  force?: boolean;
}) {
  const todayKst = toKstDateKey(new Date());
  const accounts = await prisma.threadsAccount.findMany({
    where: {
      ...(args?.userId ? { userId: args.userId } : {}),
      ...(args?.threadsAccountId ? { id: args.threadsAccountId } : {}),
      threadsUserId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      threadsUserId: true,
      accessTokenEncrypted: true,
      proxyUrlEncrypted: true,
      tokenExpiresAt: true,
    },
  });

  const snapshotExistsToday = new Set<string>();
  if (!args?.force && accounts.length > 0) {
    const existing = await prisma.threadsFollowerSnapshot.findMany({
      where: {
        threadsAccountId: { in: accounts.map((account) => account.id) },
        dateKst: todayKst,
      },
      select: {
        threadsAccountId: true,
      },
    });
    for (const row of existing) snapshotExistsToday.add(row.threadsAccountId);
  }

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const account of accounts) {
    if (!args?.force && snapshotExistsToday.has(account.id)) {
      skipped += 1;
      continue;
    }
    if (!account.threadsUserId) {
      skipped += 1;
      continue;
    }

    try {
      const { accessToken, proxyUrl } = await ensureValidAccessToken(account);
      const followers = await getUserFollowersCount({
        accessToken,
        proxyUrl,
        threadsUserId: account.threadsUserId,
      });
      await upsertFollowerSnapshot({
        userId: account.userId,
        threadsAccountId: account.id,
        followerCount: followers.followersCount,
      });
      updated += 1;
    } catch (err) {
      const message = errorToString(err);
      if (isMissingInsightsPermission(message)) skipped += 1;
      else failed += 1;
    }
  }

  return {
    scanned: accounts.length,
    updated,
    failed,
    skipped,
    dateKst: todayKst,
  };
}

async function syncOnePost(post: {
  id: string;
  remotePostId: string | null;
  threadsAccount: {
    id: string;
    accessTokenEncrypted: string;
    proxyUrlEncrypted: string | null;
    tokenExpiresAt: Date;
  } | null;
}) {
  if (!post.remotePostId || !post.threadsAccount) return { ok: false as const, reason: "missing_remote_or_account" };

  const { accessToken, proxyUrl } = await ensureValidAccessToken(post.threadsAccount);
  const metrics = await getPostEngagement({
    accessToken,
    proxyUrl,
    postId: post.remotePostId,
  });

  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: {
      viewsCount: metrics.viewsCount,
      likesCount: metrics.likesCount,
      repliesCount: metrics.repliesCount,
      repostsCount: metrics.repostsCount,
      quotesCount: metrics.quotesCount,
      insightsUpdatedAt: new Date(),
      insightsLastError: null,
    },
  });

  return { ok: true as const };
}

export async function syncScheduledPostInsightsById(scheduledPostId: string) {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: scheduledPostId },
    include: {
      threadsAccount: {
        select: {
          id: true,
          accessTokenEncrypted: true,
          proxyUrlEncrypted: true,
          tokenExpiresAt: true,
        },
      },
    },
  });
  if (!post) return { ok: false as const, reason: "not_found" };

  try {
    return await syncOnePost(post);
  } catch (err) {
    const message = errorToString(err);
    await prisma.scheduledPost
      .update({
        where: { id: post.id },
        data: {
          insightsLastError: message,
          insightsUpdatedAt: new Date(),
        },
      })
      .catch(() => null);
    return { ok: false as const, reason: message };
  }
}

export async function syncPostInsightsBatch(args?: {
  userId?: string;
  threadsAccountId?: string;
  force?: boolean;
  limit?: number;
}) {
  const followerSync = await syncFollowerSnapshotsBatch({
    userId: args?.userId,
    threadsAccountId: args?.threadsAccountId,
    force: args?.force,
  });

  const now = Date.now();
  const staleBefore = new Date(now - INSIGHT_STALE_MS);
  const lookback = new Date(now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const take = Math.max(1, Math.min(args?.limit ?? 100, 500));

  const posts = await prisma.scheduledPost.findMany({
    where: {
      ...(args?.userId ? { userId: args.userId } : {}),
      ...(args?.threadsAccountId ? { threadsAccountId: args.threadsAccountId } : {}),
      remotePostId: { not: null },
      scheduledAt: { gte: lookback },
      status: {
        in: [
          ScheduledPostStatus.SUCCESS,
          ScheduledPostStatus.PARTIAL_FAILED,
          ScheduledPostStatus.RUNNING,
        ],
      },
      ...(args?.force
        ? {}
        : {
            OR: [{ insightsUpdatedAt: null }, { insightsUpdatedAt: { lt: staleBefore } }],
          }),
    },
    orderBy: [{ insightsUpdatedAt: "asc" }, { scheduledAt: "desc" }],
    take,
    include: {
      threadsAccount: {
        select: {
          id: true,
          accessTokenEncrypted: true,
          proxyUrlEncrypted: true,
          tokenExpiresAt: true,
        },
      },
    },
  });

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const post of posts) {
    try {
      const result = await syncOnePost(post);
      if (result.ok) {
        updated += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      const message = errorToString(err);
      if (isMissingInsightsPermission(message)) {
        skipped += 1;
      } else {
        failed += 1;
      }
      await prisma.scheduledPost
        .update({
          where: { id: post.id },
          data: {
            insightsLastError: message,
            insightsUpdatedAt: new Date(),
          },
        })
        .catch(() => null);
    }
  }

  return {
    scanned: posts.length,
    updated,
    failed,
    skipped,
    followerSync,
  };
}
