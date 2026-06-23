import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncPostInsightsBatch } from "@/server/insights";
import { ensureSessionScope, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { userWhereForScope } from "@/server/sessionScope";

export async function POST(req: Request) {
  const scope = await ensureSessionScope();
  const withCookie = (res: NextResponse) => {
    if (scope.setCookie) res.cookies.set(session.cookieName, scope.userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(scope.userId);

    const url = new URL(req.url);
    const threadsAccountId = url.searchParams.get("threadsAccountId")?.trim() || undefined;
    const force = url.searchParams.get("force") === "1";

    let targetUserId: string | undefined = scope.isMaster ? undefined : scope.userId;
    if (threadsAccountId) {
      const exists = await prisma.threadsAccount.findFirst({
        where: { id: threadsAccountId, ...userWhereForScope(scope) },
        select: { id: true, userId: true },
      });
      if (!exists) {
        return withCookie(NextResponse.json({ error: "Account not found" }, { status: 404 }));
      }
      targetUserId = exists.userId;
    }

    const result = await syncPostInsightsBatch({
      userId: targetUserId,
      userIds: targetUserId ? undefined : scope.userIds,
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
