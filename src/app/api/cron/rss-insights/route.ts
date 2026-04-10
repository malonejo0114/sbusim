import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron/auth";
import { runRssInsightJob } from "@/lib/market/jobs";
import { prisma } from "@/lib/prisma";

function parseAutoPost(req: Request) {
  const url = new URL(req.url);
  const v = url.searchParams.get("autoPost");
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

function parseTargetThreadsAccountId(req: Request) {
  const url = new URL(req.url);
  const direct = url.searchParams.get("targetThreadsAccountId")?.trim();
  if (direct) return direct;

  const envRaw = process.env.RSS_REVIEW_TARGET_ACCOUNT_IDS ?? "";
  const first = envRaw
    .split(",")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  return first ?? "";
}

export async function GET(req: Request) {
  const blocked = verifyCronRequest(req);
  if (blocked) return blocked;
  try {
    const url = new URL(req.url);
    const includeParam = url.searchParams.get("includeSources");
    const includeSourcesOverride =
      includeParam === "1" || includeParam === "true" ? true : includeParam === "0" || includeParam === "false" ? false : undefined;
    const autoPostOverride = parseAutoPost(req);
    const targetThreadsAccountId = parseTargetThreadsAccountId(req);
    if (!targetThreadsAccountId) {
      return NextResponse.json({ error: "targetThreadsAccountId is required (query or RSS_REVIEW_TARGET_ACCOUNT_IDS)" }, { status: 400 });
    }

    const account = await prisma.threadsAccount.findUnique({
      where: { id: targetThreadsAccountId },
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
      return NextResponse.json({ error: "targetThreadsAccountId not found" }, { status: 404 });
    }

    const result = await runRssInsightJob({
      includeSources: typeof includeSourcesOverride === "boolean" ? includeSourcesOverride : account.rssIncludeSources,
      autoPost: typeof autoPostOverride === "boolean" ? autoPostOverride : account.rssAutoPostEnabled,
      autoPostMinIntervalMinutes: account.rssAutoPostMinIntervalMinutes,
      autoPostMaxIntervalMinutes: account.rssAutoPostMaxIntervalMinutes,
      maxCreateCount: account.rssFetchCount,
      targetThreadsAccountId: account.id,
      targetAccountLabel: account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id,
      keywordIncludeCsv: account.rssKeywordIncludeCsv,
      keywordExcludeCsv: account.rssKeywordExcludeCsv,
      promptTemplate: account.rssPromptTemplate,
      requireTargetAccount: true,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
