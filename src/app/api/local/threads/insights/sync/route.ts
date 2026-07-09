import { NextResponse } from "next/server";
import { isLocalApiValidationMessage, requireLocalApiKey } from "@/server/localApiAuth";
import { syncScheduledPostInsightsById } from "@/server/insights";
import { findLocalInsightSyncTargets } from "@/server/localThreadsPosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type SyncBody = {
  date?: unknown;
  owners?: unknown;
  accounts?: unknown;
};

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function validateDate(date: unknown) {
  if (typeof date !== "string" || !date.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    throw new Error("date는 YYYY-MM-DD 형식이어야 합니다.");
  }
  return date.trim();
}

function validateStringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field}는 문자열 배열이어야 합니다.`);
  }
  const normalized = value.map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

async function readBody(req: Request): Promise<SyncBody> {
  try {
    return (await req.json()) as SyncBody;
  } catch {
    throw new Error("JSON 본문을 해석하지 못했습니다.");
  }
}

export async function POST(req: Request) {
  const denied = requireLocalApiKey(req);
  if (denied) return denied;

  try {
    const body = await readBody(req);
    const date = validateDate(body.date);
    const owners = validateStringArray(body.owners, "owners");
    const accounts = validateStringArray(body.accounts, "accounts");
    const targets = await findLocalInsightSyncTargets({ date, owners, accounts });
    const errors: { postId: string; message: string }[] = [];
    let synced = 0;
    let failed = 0;

    for (let index = 0; index < targets.length; index += 4) {
      const chunk = targets.slice(index, index + 4);
      const results = await Promise.all(
        chunk.map(async (target) => {
          try {
            const result = await syncScheduledPostInsightsById(target.id);
            if (result.ok) return { postId: target.id, ok: true, message: null };
            return { postId: target.id, ok: false, message: result.reason };
          } catch (err) {
            return { postId: target.id, ok: false, message: errorMessage(err) };
          }
        })
      );

      for (const result of results) {
        if (result.ok) {
          synced += 1;
        } else {
          failed += 1;
          if (errors.length < 20) {
            errors.push({ postId: result.postId, message: result.message ?? "알 수 없는 오류" });
          }
        }
      }
    }

    return NextResponse.json({
      ok: targets.length === 0 || synced > 0,
      synced,
      failed,
      errors,
    });
  } catch (err) {
    const message = errorMessage(err);
    if (isLocalApiValidationMessage(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Local Threads insights sync API failed", { message });
    return NextResponse.json({ error: "서버 에러가 발생했습니다." }, { status: 500 });
  }
}
