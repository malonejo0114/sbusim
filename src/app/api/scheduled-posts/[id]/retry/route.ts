import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueCommentJob, enqueuePublishJob } from "@/server/queue";
import { ScheduledPostStatus } from "@prisma/client";
import { ensureSessionScope, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { userWhereForScope } from "@/server/sessionScope";

function toPublicInfraError(details: string) {
  const d = details.toLowerCase();
  if (d.includes("6379") || d.includes("redis") || d.includes("ioredis") || d.includes("bullmq")) {
    return "Redis 연결 실패: Redis를 실행하세요 (docker compose up -d)";
  }
  if (d.includes("5432") || d.includes("postgres") || d.includes("database") || d.includes("prisma")) {
    return "DB 연결 실패: Postgres를 실행하세요 (docker compose up -d)";
  }
  return "서버 에러가 발생했습니다. (Postgres/Redis 실행 여부를 확인하세요)";
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const scope = await ensureSessionScope();
  const withCookie = (res: NextResponse) => {
    if (scope.setCookie) res.cookies.set(session.cookieName, scope.userId, sessionCookieOptions());
    return res;
  };
  const { id } = await ctx.params;

  try {
    await upsertUserById(scope.userId);

    const post = await prisma.scheduledPost.findFirst({
      where: { id, ...userWhereForScope(scope) },
    });
    if (!post) return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));

    await prisma.scheduledPost.update({
      where: { id },
      data: { status: ScheduledPostStatus.PENDING, lastError: null },
    });

    if (post.remotePostId) {
      await prisma.scheduledPost.update({
        where: { id },
        data: { status: ScheduledPostStatus.RUNNING, lastError: null },
      });
      await enqueueCommentJob({ scheduledPostId: id, delayMs: post.commentDelaySeconds * 1000 });
    } else {
      await enqueuePublishJob({ scheduledPostId: id, delayMs: 0 });
    }
    return withCookie(NextResponse.json({ ok: true }));
  } catch (err) {
    console.error("POST /api/scheduled-posts/:id/retry failed:", err);
    const details = err instanceof Error ? err.message : String(err);
    await prisma.scheduledPost
      .update({
        where: { id },
        data: { status: ScheduledPostStatus.FAILED, lastError: `Enqueue failed: ${details}` },
      })
      .catch(() => null);
    const error = toPublicInfraError(details);
    return withCookie(
      NextResponse.json(process.env.NODE_ENV === "production" ? { error } : { error, details }, { status: 500 })
    );
  }
}
