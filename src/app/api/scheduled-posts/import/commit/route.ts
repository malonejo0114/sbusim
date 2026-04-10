import { NextResponse } from "next/server";
import { z } from "zod";
import { MediaType, ScheduledPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueuePublishJob } from "@/server/queue";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { defaultCommentDelaySeconds } from "@/server/replyDelays";

const CommitSchema = z.object({
  items: z
    .array(
      z.object({
        rowNumber: z.number().int().min(2),
        threadsAccountId: z.string().trim().min(1),
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
        mediaType: z.enum(["TEXT", "IMAGE", "VIDEO"]),
        mediaUrl: z.string().url().nullable().optional(),
        scheduledAtIso: z.string().trim().min(1).nullable().optional(),
      })
    )
    .min(1)
    .max(1000),
});
const MIN_FUTURE_BUFFER_MS = 60 * 1000;

function isTooOld(date: Date) {
  return date.getTime() < Date.now() + MIN_FUTURE_BUFFER_MS;
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const json = await req.json().catch(() => null);
  const parsed = CommitSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);

    const accountIds = Array.from(new Set(parsed.data.items.map((item) => item.threadsAccountId)));
    const accounts = await prisma.threadsAccount.findMany({
      where: { userId, id: { in: accountIds } },
      select: { id: true, label: true, threadsUsername: true, threadsUserId: true },
    });
    const accountSet = new Set(accounts.map((acc) => acc.id));

    const results: Array<{ rowNumber: number; postId?: string; error?: string; threadsAccountId: string }> = [];
    let created = 0;

    for (const item of parsed.data.items) {
      if (!accountSet.has(item.threadsAccountId)) {
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          error: "해당 계정은 현재 사용자 소유가 아닙니다.",
        });
        continue;
      }

      if ((item.mediaType === MediaType.IMAGE || item.mediaType === MediaType.VIDEO) && !item.mediaUrl) {
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          error: "IMAGE/VIDEO는 mediaUrl이 필요합니다.",
        });
        continue;
      }
      if (item.mediaType === MediaType.TEXT && item.mediaUrl) {
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          error: "TEXT는 mediaUrl을 비워야 합니다.",
        });
        continue;
      }

      if (!item.scheduledAtIso) {
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          error: "예약 시간이 없습니다. 미리보기에서 자동 배정 설정 후 다시 시도하세요.",
        });
        continue;
      }
      const scheduledAt = new Date(item.scheduledAtIso);
      if (Number.isNaN(scheduledAt.getTime())) {
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          error: "scheduledAtIso가 유효한 날짜가 아닙니다.",
        });
        continue;
      }
      if (isTooOld(scheduledAt)) {
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          error: "예약 시간이 현재보다 과거입니다. 미리보기에서 시작 시각을 다시 잡아주세요.",
        });
        continue;
      }

      try {
        const commentDelaySeconds = item.replies.length > 0 ? defaultCommentDelaySeconds(item.mediaType) : 0;
        const post = await prisma.scheduledPost.create({
          data: {
            userId,
            threadsAccountId: item.threadsAccountId,
            text: item.text,
            mediaType: item.mediaType,
            mediaUrl: item.mediaUrl ?? null,
            commentText: null,
            commentDelaySeconds,
            scheduledAt,
            status: ScheduledPostStatus.PENDING,
            replies:
              item.replies.length > 0
                ? {
                    create: item.replies.map((reply, index) => ({
                      orderIndex: index,
                      text: reply.text,
                    })),
                  }
                : undefined,
          },
        });

        try {
          await enqueuePublishJob({
            scheduledPostId: post.id,
            delayMs: scheduledAt.getTime() - Date.now(),
          });
        } catch (queueErr) {
          const detail = queueErr instanceof Error ? queueErr.message : String(queueErr);
          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
              status: ScheduledPostStatus.FAILED,
              lastError: `Enqueue failed: ${detail}`,
            },
          });
          results.push({
            rowNumber: item.rowNumber,
            threadsAccountId: item.threadsAccountId,
            postId: post.id,
            error: "큐 등록 실패(해당 행은 FAILED 처리됨)",
          });
          continue;
        }

        created += 1;
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          postId: post.id,
        });
      } catch (rowErr) {
        results.push({
          rowNumber: item.rowNumber,
          threadsAccountId: item.threadsAccountId,
          error: rowErr instanceof Error ? rowErr.message : String(rowErr),
        });
      }
    }

    const failed = results.filter((r) => r.error).length;
    return withCookie(
      NextResponse.json({
        ok: true,
        created,
        failed,
        total: parsed.data.items.length,
        results,
      })
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
