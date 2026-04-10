import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncPostInsightsBatch } from "@/server/insights";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);

    const url = new URL(req.url);
    const threadsAccountId = url.searchParams.get("threadsAccountId")?.trim() || undefined;
    const force = url.searchParams.get("force") === "1";

    if (threadsAccountId) {
      const exists = await prisma.threadsAccount.findFirst({
        where: { id: threadsAccountId, userId },
        select: { id: true },
      });
      if (!exists) {
        return withCookie(NextResponse.json({ error: "Account not found" }, { status: 404 }));
      }
    }

    const result = await syncPostInsightsBatch({
      userId,
      threadsAccountId,
      force,
      limit: 200,
    });

    return withCookie(NextResponse.json({ ok: true, result }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
