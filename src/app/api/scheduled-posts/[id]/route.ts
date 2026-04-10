import { NextResponse } from "next/server";
import { z } from "zod";
import { ScheduledPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueuePublishJob, removeScheduledPostJobs } from "@/server/queue";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

const UpdateScheduledPostSchema = z.object({
  text: z.string().trim().min(1),
  replies: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
      })
    )
    .max(10)
    .optional()
    .default([]),
  scheduledAt: z.string().trim().min(1),
});

const MIN_FUTURE_BUFFER_MS = 60 * 1000;

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

function isTooOld(date: Date) {
  return date.getTime() < Date.now() + MIN_FUTURE_BUFFER_MS;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = UpdateScheduledPostSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  const scheduledAtDate = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAtDate.getTime())) {
    return withCookie(NextResponse.json({ error: "Invalid scheduledAt" }, { status: 400 }));
  }
  if (isTooOld(scheduledAtDate)) {
    return withCookie(
      NextResponse.json({ error: "예약 시간은 현재 시각보다 최소 1분 이후여야 합니다." }, { status: 400 })
    );
  }

  try {
    await upsertUserById(userId);

    const post = await prisma.scheduledPost.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        remotePostId: true,
      },
    });
    if (!post) {
      return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));
    }
    if (post.status !== ScheduledPostStatus.PENDING || post.remotePostId) {
      return withCookie(NextResponse.json({ error: "발행 전 대기 상태의 예약글만 수정할 수 있습니다." }, { status: 409 }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.scheduledPost.update({
        where: { id: post.id },
        data: {
          text: parsed.data.text,
          scheduledAt: scheduledAtDate,
          lastError: null,
          replies: {
            deleteMany: {},
            ...(parsed.data.replies.length > 0
              ? {
                  create: parsed.data.replies.map((reply, index) => ({
                    orderIndex: index,
                    text: reply.text,
                  })),
                }
              : {}),
          },
        },
      });

      return tx.scheduledPost.findUniqueOrThrow({
        where: { id: post.id },
        include: {
          replies: {
            orderBy: { orderIndex: "asc" },
          },
        },
      });
    });

    await removeScheduledPostJobs(post.id);
    await enqueuePublishJob({
      scheduledPostId: post.id,
      delayMs: Math.max(0, scheduledAtDate.getTime() - Date.now()),
    });

    return withCookie(
      NextResponse.json({
        post: {
          ...updated,
          scheduledAt: updated.scheduledAt.toISOString(),
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          replies: updated.replies.map((reply) => ({
            ...reply,
            createdAt: reply.createdAt.toISOString(),
            updatedAt: reply.updatedAt.toISOString(),
          })),
        },
      })
    );
  } catch (err) {
    console.error("PATCH /api/scheduled-posts/:id failed:", err);
    const details = err instanceof Error ? err.message : String(err);
    const error = toPublicInfraError(details);
    return withCookie(
      NextResponse.json(process.env.NODE_ENV === "production" ? { error } : { error, details }, { status: 500 })
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const { id } = await ctx.params;

  try {
    await upsertUserById(userId);

    const post = await prisma.scheduledPost.findFirst({
      where: { id, userId },
      select: { id: true, status: true, remotePostId: true },
    });
    if (!post) {
      return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));
    }

    if (post.status === ScheduledPostStatus.RUNNING) {
      return withCookie(NextResponse.json({ error: "현재 발행 중인 글은 삭제할 수 없습니다." }, { status: 409 }));
    }
    if (post.status === ScheduledPostStatus.SUCCESS || post.remotePostId) {
      return withCookie(NextResponse.json({ error: "이미 발행된 글은 삭제할 수 없습니다." }, { status: 409 }));
    }

    await prisma.scheduledPost.delete({ where: { id: post.id } });

    await removeScheduledPostJobs(post.id).catch((err) => {
      // Even if queue cleanup fails, the deleted row prevents duplicate publishing.
      console.warn("DELETE /api/scheduled-posts/:id queue cleanup failed:", err);
    });

    return withCookie(NextResponse.json({ ok: true }));
  } catch (err) {
    console.error("DELETE /api/scheduled-posts/:id failed:", err);
    const details = err instanceof Error ? err.message : String(err);
    const error = toPublicInfraError(details);
    return withCookie(
      NextResponse.json(process.env.NODE_ENV === "production" ? { error } : { error, details }, { status: 500 })
    );
  }
}
