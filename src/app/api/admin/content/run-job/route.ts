import { NextResponse } from "next/server";
import { ensureDefaultRssSources } from "@/lib/market/repository";
import { runRssInsightJob } from "@/lib/market/jobs";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { prisma } from "@/lib/prisma";

type RunJobBody = {
  job?: "rss_insight" | "seed_rss_sources";
  includeSources?: boolean;
  autoPost?: boolean;
  targetThreadsAccountId?: string;
  forceRegenerate?: boolean;
  maxCreateCount?: number;
};

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const body = (await req.json().catch(() => ({}))) as RunJobBody;
  const job = body.job ?? "rss_insight";
  if (job !== "rss_insight" && job !== "seed_rss_sources") {
    return withCookie(NextResponse.json({ error: "Invalid job type" }, { status: 400 }));
  }
  const includeSources = typeof body.includeSources === "boolean" ? body.includeSources : undefined;
  const forceRegenerate = typeof body.forceRegenerate === "boolean" ? body.forceRegenerate : false;
  const maxCreateCount = typeof body.maxCreateCount === "number" ? Math.max(1, Math.min(Math.trunc(body.maxCreateCount), 20)) : undefined;
  const targetThreadsAccountId = body.targetThreadsAccountId?.trim() || "";

  try {
    await upsertUserById(userId);

    if (job === "seed_rss_sources") {
      const result = await ensureDefaultRssSources();
      return withCookie(NextResponse.json({ ok: true, job, result }));
    }

    if (!targetThreadsAccountId) {
      return withCookie(NextResponse.json({ error: "targetThreadsAccountId is required" }, { status: 400 }));
    }

    const account = await prisma.threadsAccount.findFirst({
      where: { id: targetThreadsAccountId, userId },
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
    if (!account) {
      return withCookie(NextResponse.json({ error: "선택한 Threads 계정을 찾을 수 없습니다." }, { status: 404 }));
    }

    const result = await runRssInsightJob({
      includeSources: typeof includeSources === "boolean" ? includeSources : account.rssIncludeSources,
      autoPost: typeof body.autoPost === "boolean" ? body.autoPost : account.rssAutoPostEnabled,
      autoPostMinIntervalMinutes: account.rssAutoPostMinIntervalMinutes,
      autoPostMaxIntervalMinutes: account.rssAutoPostMaxIntervalMinutes,
      maxCreateCount: maxCreateCount ?? account.rssFetchCount,
      forceRegenerate,
      targetThreadsAccountId: account.id,
      targetAccountLabel: account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id,
      keywordIncludeCsv: account.rssKeywordIncludeCsv,
      keywordExcludeCsv: account.rssKeywordExcludeCsv,
      promptTemplate: account.rssPromptTemplate,
      requireTargetAccount: true,
    });
    return withCookie(NextResponse.json({ ok: true, job: "rss_insight", result }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
