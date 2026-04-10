import { NextResponse } from "next/server";
import { getRecentQueue } from "@/lib/market/jobs";
import { isThreadsPostingAvailable } from "@/lib/platforms/threads";
import { listAllRssSources } from "@/lib/market/repository";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const requestHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);

    const accounts = await prisma.threadsAccount.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        label: true,
        threadsUserId: true,
        threadsUsername: true,
        rssReviewEnabled: true,
        rssIncludeSources: true,
        rssAutoPostEnabled: true,
        rssAutoPostMinIntervalMinutes: true,
        rssAutoPostMaxIntervalMinutes: true,
        rssFetchCount: true,
        rssKeywordIncludeCsv: true,
        rssKeywordExcludeCsv: true,
        rssPromptTemplate: true,
        updatedAt: true,
      },
    });
    const postingAvailable = await isThreadsPostingAvailable({ userId });

    const sources = await listAllRssSources();

    const accountIds = accounts.map((account) => account.id);
    const queueRows = await getRecentQueue(100, { targetThreadsAccountIds: accountIds });

    const accountMap = new Map(accounts.map((account) => [account.id, account]));

    const rows = queueRows
      .filter((row) => row.post_type === "rss_insight")
      .map((row) => {
        const account = row.target_threads_account_id ? accountMap.get(row.target_threads_account_id) : undefined;
        return {
          ...row,
          targetAccount: account
            ? {
                id: account.id,
                label: account.label,
                threadsUserId: account.threadsUserId,
                threadsUsername: account.threadsUsername,
              }
            : null,
        };
      });

    return withCookie(
      NextResponse.json({
        rows,
        postingAvailable,
        sources,
        accounts: accounts.map((account) => ({
          id: account.id,
          label: account.label,
          threadsUserId: account.threadsUserId,
          threadsUsername: account.threadsUsername,
          rssReviewEnabled: account.rssReviewEnabled,
          rssIncludeSources: account.rssIncludeSources,
          rssAutoPostEnabled: account.rssAutoPostEnabled,
          rssAutoPostMinIntervalMinutes: account.rssAutoPostMinIntervalMinutes,
          rssAutoPostMaxIntervalMinutes: account.rssAutoPostMaxIntervalMinutes,
          rssFetchCount: account.rssFetchCount,
          rssKeywordIncludeCsv: account.rssKeywordIncludeCsv ?? "",
          rssKeywordExcludeCsv: account.rssKeywordExcludeCsv ?? "",
          rssPromptTemplate: account.rssPromptTemplate ?? "",
          updatedAt: account.updatedAt.toISOString(),
        })),
        sessionUserId: userId,
        requestHost,
        rssBackendReady: true,
      })
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(
      NextResponse.json(
        {
          error,
          rows: [],
          postingAvailable: false,
          sources: [],
          accounts: [],
          sessionUserId: userId,
          requestHost,
          rssBackendReady: false,
          rssBackendError: error,
        },
        { status: 500 }
      )
    );
  }
}
