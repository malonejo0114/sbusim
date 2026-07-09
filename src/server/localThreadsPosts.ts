import { ScheduledPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ownerForUserId, resolveLocalAccounts } from "@/server/localApiAuth";
import { getKstDateRange } from "@/server/threadsDailyReport";

export type LocalThreadsPostReply = {
  orderIndex: number;
  text: string;
  status: string;
  remoteReplyId: string | null;
};

export type LocalThreadsPost = {
  id: string;
  owner: string;
  accountId: string;
  accountName: string;
  threadsUsername: string | null;
  remotePostId: string | null;
  threadUrl: string | null;
  status: string;
  source: string;
  mediaType: string;
  mediaUrl: string | null;
  text: string;
  replies: LocalThreadsPostReply[];
  scheduledAtKst: string | null;
  publishedAtKst: string | null;
  viewsCount: number;
  likesCount: number;
  repliesCount: number;
  repostsCount: number;
  quotesCount: number;
  insightsUpdatedAt: string | null;
  lastError: string | null;
};

export type LocalThreadsPostsResult = {
  dateKst: string;
  posts: LocalThreadsPost[];
  summary: { total: number; byOwner: Record<string, number> };
};

function formatKstDateTime(date: Date | null) {
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

function sourceForPost(post: { origin: string; status: ScheduledPostStatus }) {
  if (post.origin === "DIRECT") return "직접";
  if (post.status === ScheduledPostStatus.SUCCESS) return "발행완료";
  if (post.status === ScheduledPostStatus.FAILED) return "실패";
  if (post.status === ScheduledPostStatus.PARTIAL_FAILED) return "부분실패";
  if (post.status === ScheduledPostStatus.RUNNING) return "진행";
  return "예약";
}

function accountName(account: {
  id: string;
  label: string | null;
  threadsUsername: string | null;
  threadsUserId: string | null;
}) {
  return account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;
}

function threadUrl(args: { threadsUsername: string | null; remotePostId: string | null }) {
  if (!args.threadsUsername || !args.remotePostId) return null;
  return `https://www.threads.com/@${args.threadsUsername}/post/${args.remotePostId}`;
}

async function resolveScopedAccountIds(args: { owners?: string[]; accounts?: string[] }) {
  const accounts = await resolveLocalAccounts(args);
  return accounts.map((account) => account.id);
}

export async function queryLocalThreadsPosts(args: {
  date: string;
  owners?: string[];
  accounts?: string[];
}): Promise<LocalThreadsPostsResult> {
  const range = getKstDateRange(args.date);
  const accountIds = await resolveScopedAccountIds({ owners: args.owners, accounts: args.accounts });

  if (accountIds.length === 0) {
    return { dateKst: range.dateKst, posts: [], summary: { total: 0, byOwner: {} } };
  }

  const rows = await prisma.scheduledPost.findMany({
    where: {
      threadsAccountId: { in: accountIds },
      OR: [
        { publishedAt: { gte: range.start, lt: range.end } },
        { publishedAt: null, scheduledAt: { gte: range.start, lt: range.end } },
      ],
    },
    select: {
      id: true,
      userId: true,
      threadsAccountId: true,
      origin: true,
      text: true,
      mediaType: true,
      mediaUrl: true,
      scheduledAt: true,
      status: true,
      remotePostId: true,
      publishedAt: true,
      viewsCount: true,
      likesCount: true,
      repliesCount: true,
      repostsCount: true,
      quotesCount: true,
      insightsUpdatedAt: true,
      lastError: true,
      replies: {
        orderBy: { orderIndex: "asc" },
        select: {
          orderIndex: true,
          text: true,
          status: true,
          remoteReplyId: true,
        },
      },
      threadsAccount: {
        select: {
          id: true,
          label: true,
          threadsUserId: true,
          threadsUsername: true,
        },
      },
    },
  });

  rows.sort((a, b) => {
    const aTime = (a.publishedAt ?? a.scheduledAt).getTime();
    const bTime = (b.publishedAt ?? b.scheduledAt).getTime();
    return aTime - bTime;
  });

  const posts = rows.map((post) => {
    const owner = ownerForUserId(post.userId);
    const threadsUsername = post.threadsAccount.threadsUsername;

    return {
      id: post.id,
      owner,
      accountId: post.threadsAccountId,
      accountName: accountName(post.threadsAccount),
      threadsUsername,
      remotePostId: post.remotePostId,
      threadUrl: threadUrl({ threadsUsername, remotePostId: post.remotePostId }),
      status: post.status,
      source: sourceForPost({ origin: post.origin, status: post.status }),
      mediaType: post.mediaType,
      mediaUrl: post.mediaUrl,
      text: post.text,
      replies: post.replies.map((reply) => ({
        orderIndex: reply.orderIndex,
        text: reply.text,
        status: reply.status,
        remoteReplyId: reply.remoteReplyId,
      })),
      scheduledAtKst: formatKstDateTime(post.scheduledAt),
      publishedAtKst: formatKstDateTime(post.publishedAt),
      viewsCount: post.viewsCount,
      likesCount: post.likesCount,
      repliesCount: post.repliesCount,
      repostsCount: post.repostsCount,
      quotesCount: post.quotesCount,
      insightsUpdatedAt: post.insightsUpdatedAt?.toISOString() ?? null,
      lastError: post.lastError,
    } satisfies LocalThreadsPost;
  });

  const byOwner: Record<string, number> = {};
  for (const post of posts) byOwner[post.owner] = (byOwner[post.owner] ?? 0) + 1;

  return {
    dateKst: range.dateKst,
    posts,
    summary: {
      total: posts.length,
      byOwner,
    },
  };
}

export async function findLocalInsightSyncTargets(args: {
  date: string;
  owners?: string[];
  accounts?: string[];
}): Promise<{ id: string }[]> {
  const range = getKstDateRange(args.date);
  const accountIds = await resolveScopedAccountIds({ owners: args.owners, accounts: args.accounts });

  if (accountIds.length === 0) return [];

  return prisma.scheduledPost.findMany({
    where: {
      threadsAccountId: { in: accountIds },
      remotePostId: { not: null },
      status: {
        in: [
          ScheduledPostStatus.SUCCESS,
          ScheduledPostStatus.PARTIAL_FAILED,
          ScheduledPostStatus.RUNNING,
        ],
      },
      OR: [
        { publishedAt: { gte: range.start, lt: range.end } },
        { publishedAt: null, scheduledAt: { gte: range.start, lt: range.end } },
      ],
    },
    select: { id: true },
  });
}
