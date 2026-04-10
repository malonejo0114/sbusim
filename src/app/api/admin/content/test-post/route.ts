import { NextResponse } from "next/server";
import { postQueueById, schedulePostQueueById } from "@/lib/market/jobs";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const body = (await req.json().catch(() => null)) as { postId?: string; threadsAccountId?: string; scheduledAt?: string } | null;
  const postId = body?.postId?.trim();
  const threadsAccountId = body?.threadsAccountId?.trim() || undefined;
  const scheduledAt = body?.scheduledAt?.trim();
  if (!postId) {
    return withCookie(NextResponse.json({ error: "postId is required" }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);
    if (scheduledAt) {
      const result = await schedulePostQueueById(postId, {
        scheduledAtIso: scheduledAt,
        userId,
        overrideThreadsAccountId: threadsAccountId,
      });
      return withCookie(NextResponse.json({ ok: true, mode: "scheduled", result }));
    }

    const result = await postQueueById(postId, { userId, overrideThreadsAccountId: threadsAccountId });
    return withCookie(NextResponse.json({ ok: true, mode: "immediate", result }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
