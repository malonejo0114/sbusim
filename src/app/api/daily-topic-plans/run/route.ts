import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runDailyTopicPlanner } from "@/server/dailyTopicPlanner";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

const RunSchema = z.object({
  threadsAccountId: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const body = await req.json().catch(() => null);
    const parsed = RunSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
    }

    const threadsAccountId = parsed.data.threadsAccountId;
    if (threadsAccountId) {
      const account = await prisma.threadsAccount.findFirst({
        where: { id: threadsAccountId, userId },
        select: { id: true },
      });
      if (!account) {
        return withCookie(NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 400 }));
      }
    }

    const result = await runDailyTopicPlanner({
      userId,
      threadsAccountId,
      includePostDetails: true,
      maxDetailItems: 120,
    });
    return withCookie(NextResponse.json({ ok: true, result }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
