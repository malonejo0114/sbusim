import { NextResponse } from "next/server";
import { MediaType, ScheduledPostStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isLocalApiValidationMessage, requireLocalApiKey, resolveLocalAccounts, ownerForUserId } from "@/server/localApiAuth";
import { assertPublicMediaUrlReachable, isPublicMediaUrl } from "@/server/publicMedia";
import { enqueuePublishJob } from "@/server/queue";
import { defaultCommentDelaySeconds } from "@/server/replyDelays";
import { upsertUserById } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_FUTURE_BUFFER_MS = 60 * 1000;
const KST_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const ScheduleLocalThreadPostSchema = z
  .object({
    account: z.string().trim().min(1),
    text: z.string().trim().min(1),
    mediaType: z.enum(["TEXT", "IMAGE", "VIDEO"]).optional().default("TEXT"),
    mediaUrl: z.string().url().nullable().optional(),
    replies: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(500),
        })
      )
      .max(10)
      .optional()
      .default([]),
    scheduledAt: z.string().trim().datetime({ offset: true }).optional(),
    immediate: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.immediate && !value.scheduledAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledAt"],
        message: "scheduledAt is required unless immediate is true",
      });
    }
  });

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

function isInfraError(details: string) {
  const d = details.toLowerCase();
  return (
    d.includes("6379") ||
    d.includes("redis") ||
    d.includes("ioredis") ||
    d.includes("bullmq") ||
    d.includes("5432") ||
    d.includes("postgres") ||
    d.includes("database") ||
    d.includes("prisma")
  );
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

function formatKstMinute(date: Date) {
  return KST_FORMATTER.format(date).replace("T", " ");
}

function accountDisplayName(account: { id: string; label: string | null; threadsUsername: string | null }) {
  return account.label ?? account.threadsUsername ?? account.id;
}

export async function POST(req: Request) {
  const authError = requireLocalApiKey(req);
  if (authError) return authError;

  const json = await req.json().catch(() => null);
  const parsed = ScheduleLocalThreadPostSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { account: accountRef, text, mediaType, mediaUrl, replies, scheduledAt, immediate } = parsed.data;

  if ((mediaType === "IMAGE" || mediaType === "VIDEO") && !mediaUrl) {
    return NextResponse.json({ error: "mediaUrl is required for IMAGE/VIDEO" }, { status: 400 });
  }
  if (mediaType === "TEXT" && mediaUrl) {
    return NextResponse.json({ error: "mediaUrl must be empty for TEXT posts" }, { status: 400 });
  }
  if ((mediaType === "IMAGE" || mediaType === "VIDEO") && mediaUrl && !isPublicMediaUrl(mediaUrl)) {
    return NextResponse.json(
      {
        error:
          "이미지/영상 URL은 외부에서 접근 가능한 공개 http(s) 주소여야 합니다. localhost/내부 IP 주소는 사용할 수 없습니다.",
      },
      { status: 400 }
    );
  }

  const scheduledAtDate = immediate ? new Date() : new Date(scheduledAt as string);
  if (Number.isNaN(scheduledAtDate.getTime())) {
    return NextResponse.json({ error: "Invalid scheduledAt" }, { status: 400 });
  }
  if (!immediate && isTooOld(scheduledAtDate)) {
    return NextResponse.json({ error: "예약 시간은 현재 시각보다 최소 1분 이후여야 합니다." }, { status: 400 });
  }

  try {
    const accounts = await resolveLocalAccounts({ accounts: [accountRef] });
    if (accounts.length !== 1) {
      return NextResponse.json({ error: "계정을 정확히 하나만 찾을 수 없습니다." }, { status: 400 });
    }
    const [account] = accounts;

    if ((mediaType === "IMAGE" || mediaType === "VIDEO") && mediaUrl) {
      await assertPublicMediaUrlReachable({
        url: mediaUrl,
        kind: mediaType === "IMAGE" ? "image" : "video",
      });
    }

    await upsertUserById(account.userId);

    const commentDelaySeconds = replies.length > 0 ? defaultCommentDelaySeconds(mediaType as MediaType) : 0;
    const post = await prisma.scheduledPost.create({
      data: {
        userId: account.userId,
        threadsAccountId: account.id,
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
      return NextResponse.json(process.env.NODE_ENV === "production" ? { error } : { error, details }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      post: {
        id: post.id,
        owner: ownerForUserId(account.userId),
        account: accountDisplayName(account),
        threadsUsername: account.threadsUsername,
        status: ScheduledPostStatus.PENDING,
        immediate,
        scheduledAtKst: formatKstMinute(post.scheduledAt),
      },
    });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    if (isMediaValidationError(details) || isLocalApiValidationMessage(details)) {
      return NextResponse.json({ error: details }, { status: 400 });
    }

    console.error("POST /api/local/threads/schedule failed:", {
      error: err,
      account: accountRef,
      mediaType,
      immediate,
    });
    if (isInfraError(details)) {
      const error = toPublicInfraError(details);
      return NextResponse.json(process.env.NODE_ENV === "production" ? { error } : { error, details }, { status: 500 });
    }
    return NextResponse.json({ error: "서버 에러가 발생했습니다." }, { status: 500 });
  }
}
