import { NextResponse } from "next/server";
import { ScheduledPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { getAiUsageSummaryForUser } from "@/server/aiUsage";
import { loadFollowerTrendsForAccounts } from "@/server/followerStats";

function monthRange(monthParam?: string) {
  const now = new Date();
  const match = monthParam?.match(/^(\d{4})-(\d{2})$/);
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;
  const safeYear = Number.isFinite(year) ? year : now.getFullYear();
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1;

  const start = new Date(safeYear, safeMonth - 1, 1, 0, 0, 0, 0);
  const end = new Date(safeYear, safeMonth, 1, 0, 0, 0, 0);
  return {
    month: `${safeYear}-${String(safeMonth).padStart(2, "0")}`,
    start,
    end,
  };
}

function toDateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toKstHour(d: Date) {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  const hour = Number(text);
  if (!Number.isFinite(hour)) return 0;
  return Math.max(0, Math.min(23, hour));
}

function classifyLengthBucket(text: string) {
  const len = text.trim().length;
  if (len <= 120) return { key: "SHORT", label: "짧은 글 (<=120자)" };
  if (len <= 240) return { key: "MEDIUM", label: "중간 글 (121~240자)" };
  return { key: "LONG", label: "긴 글 (241자+)" };
}

function classifyStyleBucket(text: string) {
  const lower = text.toLowerCase();
  const ctaKeywords = ["팔로우", "프로필", "클릭", "문의", "dm", "참여", "상담", "링크", "신청", "댓글로"];
  if (ctaKeywords.some((keyword) => lower.includes(keyword))) {
    return { key: "CTA", label: "CTA형" };
  }
  const infoKeywords = ["요약", "체크", "지표", "수치", "근거", "정리", "리스크", "핵심", "포인트", "데이터"];
  if (infoKeywords.some((keyword) => lower.includes(keyword))) {
    return { key: "INFO", label: "정보형" };
  }
  return { key: "TOPIC", label: "주제형" };
}

function postScore(post: {
  viewsCount: number;
  likesCount: number;
  repliesCount: number;
  repostsCount: number;
  quotesCount: number;
}) {
  return (
    post.viewsCount +
    post.likesCount * 3 +
    post.repliesCount * 4 +
    post.repostsCount * 5 +
    post.quotesCount * 4
  );
}

function compactText(text: string, max = 420) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

export async function GET(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);

    const url = new URL(req.url);
    const range = monthRange(url.searchParams.get("month") ?? undefined);

    const [accounts, posts, aiUsage] = await Promise.all([
      prisma.threadsAccount.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          label: true,
          threadsUserId: true,
          threadsUsername: true,
          proxyUrlEncrypted: true,
          tokenExpiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.scheduledPost.findMany({
        where: { userId },
        select: {
          id: true,
          threadsAccountId: true,
          status: true,
          scheduledAt: true,
          remotePostId: true,
          viewsCount: true,
          likesCount: true,
          repliesCount: true,
          repostsCount: true,
          quotesCount: true,
          text: true,
        },
      }),
      getAiUsageSummaryForUser(userId),
    ]);
    const followerTrends = await loadFollowerTrendsForAccounts({
      userId,
      threadsAccountIds: accounts.map((account) => account.id),
    });

    const byAccount = new Map<
      string,
      {
        totalScheduled: number;
        monthlyScheduled: number;
        monthlyPublished: number;
        pending: number;
        running: number;
        success: number;
        failed: number;
        partialFailed: number;
        engagement: {
          views: number;
          likes: number;
          replies: number;
          reposts: number;
          quotes: number;
        };
      }
    >();

    const calendarMap = new Map<
      string,
      {
        total: number;
        byAccount: Map<
          string,
          {
            total: number;
            success: number;
            pending: number;
            failed: number;
          }
        >;
      }
    >();

    for (const post of posts) {
      const current =
        byAccount.get(post.threadsAccountId) ??
        {
          totalScheduled: 0,
          monthlyScheduled: 0,
          monthlyPublished: 0,
          pending: 0,
          running: 0,
          success: 0,
          failed: 0,
          partialFailed: 0,
          engagement: { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 },
        };

      current.totalScheduled += 1;
      if (post.status === ScheduledPostStatus.PENDING) current.pending += 1;
      if (post.status === ScheduledPostStatus.RUNNING) current.running += 1;
      if (post.status === ScheduledPostStatus.SUCCESS) current.success += 1;
      if (post.status === ScheduledPostStatus.FAILED) current.failed += 1;
      if (post.status === ScheduledPostStatus.PARTIAL_FAILED) current.partialFailed += 1;

      if (post.remotePostId) {
        current.engagement.views += post.viewsCount;
        current.engagement.likes += post.likesCount;
        current.engagement.replies += post.repliesCount;
        current.engagement.reposts += post.repostsCount;
        current.engagement.quotes += post.quotesCount;
      }

      const inMonth = post.scheduledAt >= range.start && post.scheduledAt < range.end;
      if (inMonth) {
        current.monthlyScheduled += 1;
        if (post.status === ScheduledPostStatus.SUCCESS) {
          current.monthlyPublished += 1;
        }

        const dateKey = toDateKey(post.scheduledAt);
        const dateCurrent = calendarMap.get(dateKey) ?? { total: 0, byAccount: new Map() };
        dateCurrent.total += 1;
        const accountCurrent = dateCurrent.byAccount.get(post.threadsAccountId) ?? {
          total: 0,
          success: 0,
          pending: 0,
          failed: 0,
        };
        accountCurrent.total += 1;
        if (post.status === ScheduledPostStatus.SUCCESS) accountCurrent.success += 1;
        if (post.status === ScheduledPostStatus.PENDING || post.status === ScheduledPostStatus.RUNNING) {
          accountCurrent.pending += 1;
        }
        if (post.status === ScheduledPostStatus.FAILED || post.status === ScheduledPostStatus.PARTIAL_FAILED) {
          accountCurrent.failed += 1;
        }
        dateCurrent.byAccount.set(post.threadsAccountId, accountCurrent);
        calendarMap.set(dateKey, dateCurrent);
      }

      byAccount.set(post.threadsAccountId, current);
    }

    const accountNameMap = new Map<string, string>();
    for (const account of accounts) {
      accountNameMap.set(
        account.id,
        account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id
      );
    }

    const responseAccounts = accounts.map((account) => {
      const stats =
        byAccount.get(account.id) ??
        {
          totalScheduled: 0,
          monthlyScheduled: 0,
          monthlyPublished: 0,
          pending: 0,
          running: 0,
          success: 0,
          failed: 0,
          partialFailed: 0,
          engagement: { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 },
        };

      return {
        id: account.id,
        label: account.label,
        threadsUserId: account.threadsUserId,
        threadsUsername: account.threadsUsername,
        hasProxy: Boolean(account.proxyUrlEncrypted),
        tokenExpiresAt: account.tokenExpiresAt.toISOString(),
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
        stats,
        followerStats:
          followerTrends.get(account.id) ?? {
            currentFollowers: null,
            dailyDelta: null,
            weeklyDelta: null,
            weekStartDateKst: null,
            weekEndDateKst: null,
            latestDateKst: null,
            latestCapturedAt: null,
            daysTracked: 0,
          },
      };
    });

    const calendarDays = Array.from(calendarMap.entries())
      .map(([date, value]) => ({
        date,
        total: value.total,
        byAccount: Array.from(value.byAccount.entries()).map(([accountId, item]) => ({
          accountId,
          accountName: accountNameMap.get(accountId) ?? accountId,
          ...item,
        })),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    type BucketExample = {
      postId: string;
      accountId: string;
      accountName: string;
      scheduledAt: string;
      text: string;
      views: number;
      interactions: number;
      score: number;
    };
    type BucketValue = {
      label: string;
      posts: number;
      totalViews: number;
      totalInteractions: number;
      totalScore: number;
      examples: BucketExample[];
    };

    const bucketMapHour = new Map<string, BucketValue>();
    const bucketMapLength = new Map<string, BucketValue>();
    const bucketMapStyle = new Map<string, BucketValue>();

    const postedRows = posts.filter((post) => post.remotePostId);
    for (const post of postedRows) {
      const views = post.viewsCount;
      const interactions = post.likesCount + post.repliesCount + post.repostsCount + post.quotesCount;
      const score = postScore(post);
      const example: BucketExample = {
        postId: post.id,
        accountId: post.threadsAccountId,
        accountName: accountNameMap.get(post.threadsAccountId) ?? post.threadsAccountId,
        scheduledAt: post.scheduledAt.toISOString(),
        text: compactText(post.text),
        views,
        interactions,
        score,
      };

      const hour = toKstHour(post.scheduledAt);
      const hourKey = `H${String(hour).padStart(2, "0")}`;
      const hourLabel = `${String(hour).padStart(2, "0")}:00~${String(hour).padStart(2, "0")}:59`;
      const hourBucket = bucketMapHour.get(hourKey) ?? {
        label: hourLabel,
        posts: 0,
        totalViews: 0,
        totalInteractions: 0,
        totalScore: 0,
        examples: [],
      };
      hourBucket.posts += 1;
      hourBucket.totalViews += views;
      hourBucket.totalInteractions += interactions;
      hourBucket.totalScore += score;
      hourBucket.examples.push(example);
      bucketMapHour.set(hourKey, hourBucket);

      const length = classifyLengthBucket(post.text);
      const lengthBucket = bucketMapLength.get(length.key) ?? {
        label: length.label,
        posts: 0,
        totalViews: 0,
        totalInteractions: 0,
        totalScore: 0,
        examples: [],
      };
      lengthBucket.posts += 1;
      lengthBucket.totalViews += views;
      lengthBucket.totalInteractions += interactions;
      lengthBucket.totalScore += score;
      lengthBucket.examples.push(example);
      bucketMapLength.set(length.key, lengthBucket);

      const style = classifyStyleBucket(post.text);
      const styleBucket = bucketMapStyle.get(style.key) ?? {
        label: style.label,
        posts: 0,
        totalViews: 0,
        totalInteractions: 0,
        totalScore: 0,
        examples: [],
      };
      styleBucket.posts += 1;
      styleBucket.totalViews += views;
      styleBucket.totalInteractions += interactions;
      styleBucket.totalScore += score;
      styleBucket.examples.push(example);
      bucketMapStyle.set(style.key, styleBucket);
    }

    const toRankingRows = (map: Map<string, BucketValue>) =>
      Array.from(map.entries())
        .map(([key, value]) => {
          const posts = value.posts || 1;
          const avgViews = value.totalViews / posts;
          const avgScore = value.totalScore / posts;
          const engagementRate = value.totalViews > 0 ? value.totalInteractions / value.totalViews : 0;
          const examples = [...value.examples]
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              if (b.interactions !== a.interactions) return b.interactions - a.interactions;
              return b.views - a.views;
            })
            .slice(0, 5);
          return {
            key,
            label: value.label,
            posts: value.posts,
            avgViews,
            avgScore,
            avgEngagementRate: engagementRate,
            examples,
          };
        })
        .sort((a, b) => {
          if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
          return b.posts - a.posts;
        });

    const byHour = toRankingRows(bucketMapHour);
    const byLength = toRankingRows(bucketMapLength);
    const byStyle = toRankingRows(bucketMapStyle);
    const optimization = {
      totalPosted: postedRows.length,
      overallAverageScore:
        postedRows.length > 0
          ? postedRows.reduce((sum, post) => sum + postScore(post), 0) / postedRows.length
          : 0,
      byHour,
      byLength,
      byStyle,
      recommendations: {
        bestHours: byHour.slice(0, 3),
        bestLength: byLength[0] ?? null,
        bestStyle: byStyle[0] ?? null,
      },
    };

    return withCookie(
      NextResponse.json({
        month: range.month,
        accounts: responseAccounts,
        calendarDays,
        optimization,
        aiUsage,
      })
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
