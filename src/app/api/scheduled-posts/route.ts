import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enqueuePublishJob } from "@/server/queue";
import { MediaType, ScheduledPostStatus } from "@prisma/client";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { assertPublicMediaUrlReachable, isPublicMediaUrl } from "@/server/publicMedia";
import { defaultCommentDelaySeconds } from "@/server/replyDelays";

const CreateScheduledPostSchema = z.object({
  threadsAccountId: z.string().trim().min(1),
  text: z.string().trim().min(1),
  mediaType: z.enum(["TEXT", "IMAGE", "VIDEO"]),
  mediaUrl: z.string().url().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  immediate: z.boolean().optional().default(false),
  replies: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
      })
    )
    .max(10)
    .optional()
    .default([]),
  // Accept both RFC3339 and <input type="datetime-local"> values (no timezone).
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

function isMediaValidationError(details: string) {
  return (
    details.includes("미디어 URL은") ||
    details.includes("미디어 공개 URL") ||
    details.includes("Content-Type") ||
    details.includes("외부에서 접근 가능한 공개") ||
    details.includes("HTTP 4")
  );
}

function isTooOld(date: Date) {
  return date.getTime() < Date.now() + MIN_FUTURE_BUFFER_MS;
}

export async function GET(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const url = new URL(req.url);
  const threadsAccountId = url.searchParams.get("threadsAccountId")?.trim() || undefined;

  try {
    await upsertUserById(userId);

    const threadsAccounts = await prisma.threadsAccount.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }],
    });

    const posts = await prisma.scheduledPost.findMany({
      where: {
        userId,
        ...(threadsAccountId ? { threadsAccountId } : {}),
      },
      orderBy: { scheduledAt: "desc" },
      include: {
        threadsAccount: {
          select: {
            id: true,
            label: true,
            threadsUserId: true,
            threadsUsername: true,
          },
        },
        replies: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            orderIndex: true,
            text: true,
            status: true,
            remoteReplyId: true,
            lastError: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const res = NextResponse.json({
      threadsAccounts: threadsAccounts.map((acc) => ({
        id: acc.id,
        label: acc.label,
        threadsUserId: acc.threadsUserId,
        threadsUsername: acc.threadsUsername,
        hasProxy: Boolean(acc.proxyUrlEncrypted),
        tokenExpiresAt: acc.tokenExpiresAt.toISOString(),
      })),
      posts: posts.map((p) => ({
        ...p,
        account: p.threadsAccount
          ? {
              id: p.threadsAccount.id,
              label: p.threadsAccount.label,
              threadsUserId: p.threadsAccount.threadsUserId,
              threadsUsername: p.threadsAccount.threadsUsername,
            }
          : null,
        scheduledAt: p.scheduledAt.toISOString(),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        replies: p.replies.map((reply) => ({
          ...reply,
          createdAt: reply.createdAt.toISOString(),
          updatedAt: reply.updatedAt.toISOString(),
        })),
      })),
    });
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("GET /api/scheduled-posts failed:", err);
    const details = err instanceof Error ? err.message : String(err);
    const error = toPublicInfraError(details);
    const res = NextResponse.json(
      process.env.NODE_ENV === "production" ? { error } : { error, details },
      { status: 500 }
    );
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  }
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const json = await req.json().catch(() => null);
  const parsed = CreateScheduledPostSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  const { threadsAccountId, text, mediaType, mediaUrl, immediate, replies, scheduledAt } = parsed.data;

  if ((mediaType === "IMAGE" || mediaType === "VIDEO") && !mediaUrl) {
    return withCookie(NextResponse.json({ error: "mediaUrl is required for IMAGE/VIDEO" }, { status: 400 }));
  }
  if (mediaType === "TEXT" && mediaUrl) {
    return withCookie(NextResponse.json({ error: "mediaUrl must be empty for TEXT posts" }, { status: 400 }));
  }
  if ((mediaType === "IMAGE" || mediaType === "VIDEO") && mediaUrl && !isPublicMediaUrl(mediaUrl)) {
    return withCookie(
      NextResponse.json(
        { error: "이미지/영상 URL은 외부에서 접근 가능한 공개 http(s) 주소여야 합니다. localhost/내부 IP 주소는 사용할 수 없습니다." },
        { status: 400 }
      )
    );
  }

  const scheduledAtDate = immediate ? new Date() : new Date(scheduledAt);
  const commentDelaySeconds = replies.length > 0 ? defaultCommentDelaySeconds(mediaType as MediaType) : 0;
  if (Number.isNaN(scheduledAtDate.getTime())) {
    return withCookie(NextResponse.json({ error: "Invalid scheduledAt" }, { status: 400 }));
  }
  if (!immediate && isTooOld(scheduledAtDate)) {
    return withCookie(
      NextResponse.json({ error: "예약 시간은 현재 시각보다 최소 1분 이후여야 합니다." }, { status: 400 })
    );
  }

  try {
    if ((mediaType === "IMAGE" || mediaType === "VIDEO") && mediaUrl) {
      await assertPublicMediaUrlReachable({
        url: mediaUrl,
        kind: mediaType === "IMAGE" ? "image" : "video",
      });
    }

    await upsertUserById(userId);

    const threadsAccount = await prisma.threadsAccount.findFirst({
      where: { id: threadsAccountId, userId },
    });
    if (!threadsAccount) {
      return withCookie(NextResponse.json({ error: "선택한 Threads 계정을 찾을 수 없습니다." }, { status: 400 }));
    }

    const post = await prisma.scheduledPost.create({
      data: {
        userId,
        threadsAccountId: threadsAccount.id,
        text,
        mediaType: mediaType as MediaType,
        mediaUrl: mediaUrl ?? null,
        commentText: null,
        commentDelaySeconds,
        scheduledAt: scheduledAtDate,
        status: ScheduledPostStatus.PENDING,
        replies:
          replies.length > 0
            ? {
                create: replies.map((reply, index) => ({
                  orderIndex: index,
                  text: reply.text,
                })),
              }
            : undefined,
      },
      include: {
        replies: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });

    try {
      await enqueuePublishJob({
        scheduledPostId: post.id,
        delayMs: immediate ? 0 : scheduledAtDate.getTime() - Date.now(),
      });
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: ScheduledPostStatus.FAILED, lastError: `Enqueue failed: ${details}` },
      });
      const error = toPublicInfraError(details);
      return withCookie(
        NextResponse.json(process.env.NODE_ENV === "production" ? { error } : { error, details }, { status: 500 })
      );
    }

    return withCookie(
      NextResponse.json({
        post: {
          ...post,
          scheduledAt: post.scheduledAt.toISOString(),
          createdAt: post.createdAt.toISOString(),
          updatedAt: post.updatedAt.toISOString(),
          replies: post.replies.map((reply) => ({
            ...reply,
            createdAt: reply.createdAt.toISOString(),
            updatedAt: reply.updatedAt.toISOString(),
          })),
        },
      })
    );
  } catch (err) {
    console.error("POST /api/scheduled-posts failed:", err);
    const details = err instanceof Error ? err.message : String(err);
    if (isMediaValidationError(details)) {
      return withCookie(NextResponse.json({ error: details }, { status: 400 }));
    }
    const error = toPublicInfraError(details);
    return withCookie(
      NextResponse.json(process.env.NODE_ENV === "production" ? { error } : { error, details }, { status: 500 })
    );
  }
}
