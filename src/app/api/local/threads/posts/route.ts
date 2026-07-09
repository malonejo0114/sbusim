import { NextResponse } from "next/server";
import { isLocalApiValidationMessage, requireLocalApiKey, parseCsvParam } from "@/server/localApiAuth";
import { syncScheduledPostInsightsById } from "@/server/insights";
import { findLocalInsightSyncTargets, queryLocalThreadsPosts } from "@/server/localThreadsPosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function validateDate(date: string | null) {
  const normalized = date?.trim();
  if (!normalized) throw new Error("date는 YYYY-MM-DD 형식이어야 합니다.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("date는 YYYY-MM-DD 형식이어야 합니다.");
  }
  return normalized;
}

async function syncInsightsForDate(args: { date: string; owners?: string[]; accounts?: string[] }) {
  const targets = await findLocalInsightSyncTargets(args);
  for (let index = 0; index < targets.length; index += 4) {
    const chunk = targets.slice(index, index + 4);
    await Promise.all(
      chunk.map(async (target) => {
        try {
          await syncScheduledPostInsightsById(target.id);
        } catch (err) {
          console.error("Local Threads insight sync failed", {
            postId: target.id,
            message: errorMessage(err),
          });
        }
      })
    );
  }
}

export async function GET(req: Request) {
  const denied = requireLocalApiKey(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const date = validateDate(url.searchParams.get("date"));
    const owners = parseCsvParam(url.searchParams.get("owners"));
    const accounts = parseCsvParam(url.searchParams.get("accounts"));
    const shouldSyncInsights =
      url.searchParams.get("syncInsights") === "true" || url.searchParams.get("syncInsights") === "1";

    if (shouldSyncInsights) await syncInsightsForDate({ date, owners, accounts });

    const result = await queryLocalThreadsPosts({ date, owners, accounts });
    return NextResponse.json(result);
  } catch (err) {
    const message = errorMessage(err);
    if (isLocalApiValidationMessage(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Local Threads posts API failed", { message });
    return NextResponse.json({ error: "서버 에러가 발생했습니다." }, { status: 500 });
  }
}
