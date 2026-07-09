import { NextResponse } from "next/server";

import { parseCsvParam, requireLocalApiKey, resolveLocalAccounts } from "@/server/localApiAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireLocalApiKey(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const accounts = await resolveLocalAccounts({
      owners: parseCsvParam(url.searchParams.getAll("owners")),
      accounts: parseCsvParam(url.searchParams.getAll("accounts")),
    });

    return NextResponse.json({
      accounts: accounts.map((account) => ({
        id: account.id,
        owner: account.owner,
        label: account.label,
        threadsUsername: account.threadsUsername,
        threadsUserId: account.threadsUserId,
        tokenExpiresAt: account.tokenExpiresAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof Error && isKnownValidationError(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Local Threads accounts API error", error);
    return NextResponse.json({ error: "서버 에러가 발생했습니다." }, { status: 500 });
  }
}

function isKnownValidationError(message: string) {
  return message.startsWith("알 수 없는 owner입니다:") || message.startsWith("알 수 없는 계정입니다:");
}
