import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { generateMultiAccountIssuePack } from "@/server/issuePackGenerator";
import {
  failIssuePackProgress,
  finishIssuePackProgress,
  getIssuePackProgress,
  initIssuePackProgress,
  updateIssuePackProgress,
} from "@/server/issuePackProgressStore";

const GeneratePackSchema = z.object({
  requestId: z.string().trim().min(6).max(120).optional(),
  accountIds: z.array(z.string().trim().min(1)).min(1).max(30),
  sourceContext: z.string().trim().min(1).max(12000),
  templatePrompt: z.string().trim().max(4000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  countPerAccount: z.coerce.number().int().min(1).max(10).default(3),
  minGapMinutes: z.coerce.number().int().min(1).max(24 * 60).default(45),
  maxGapMinutes: z.coerce.number().int().min(1).max(24 * 60).default(90),
  ctaRatioMinPercent: z.coerce.number().int().min(0).max(100).default(30),
  ctaRatioMaxPercent: z.coerce.number().int().min(0).max(100).default(40),
  aiProvider: z.enum(["auto", "gemini", "perplexity"]).optional(),
  aiModel: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  writingAiProvider: z.enum(["auto", "gemini", "perplexity"]).optional(),
  writingAiModel: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  startAt: z.string().trim().min(1).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export async function GET(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  await upsertUserById(userId);

  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get("requestId")?.trim();
  if (!requestId) {
    return withCookie(NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 }));
  }

  const progress = getIssuePackProgress(requestId);
  if (!progress) {
    return withCookie(NextResponse.json({ error: "진행 정보를 찾을 수 없습니다." }, { status: 404 }));
  }

  return withCookie(NextResponse.json({ ok: true, progress }));
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };
  let requestId: string | undefined;
  let totalTasks = 0;
  let completedTasks = 0;

  try {
    await upsertUserById(userId);
    const body = await req.json().catch(() => null);
    const parsed = GeneratePackSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
    }

    const minGap = Math.min(parsed.data.minGapMinutes, parsed.data.maxGapMinutes);
    const maxGap = Math.max(parsed.data.minGapMinutes, parsed.data.maxGapMinutes);
    const minCta = Math.min(parsed.data.ctaRatioMinPercent, parsed.data.ctaRatioMaxPercent);
    const maxCta = Math.max(parsed.data.ctaRatioMinPercent, parsed.data.ctaRatioMaxPercent);

    const effectiveProvider = parsed.data.writingAiProvider ?? parsed.data.aiProvider ?? "auto";
    const effectiveModel = parsed.data.writingAiModel ?? parsed.data.aiModel;
    totalTasks = parsed.data.accountIds.length * parsed.data.countPerAccount;
    requestId = parsed.data.requestId?.trim() || undefined;

    if (requestId) {
      initIssuePackProgress({
        requestId,
        totalTasks,
      });
    }
    const progressRequestId = requestId;

    const result = await generateMultiAccountIssuePack({
      userId,
      accountIds: parsed.data.accountIds,
      sourceContext: parsed.data.sourceContext,
      templatePrompt: parsed.data.templatePrompt,
      countPerAccount: parsed.data.countPerAccount,
      minGapMinutes: minGap,
      maxGapMinutes: maxGap,
      ctaRatioMinPercent: minCta,
      ctaRatioMaxPercent: maxCta,
      aiProvider: effectiveProvider,
      aiModel: effectiveModel,
      writingAiProvider: effectiveProvider,
      writingAiModel: effectiveModel,
      startAt: parsed.data.startAt,
      onProgress: progressRequestId
        ? (progress) => {
            completedTasks = progress.completedTasks;
            updateIssuePackProgress({
              requestId: progressRequestId,
              totalTasks: progress.totalTasks,
              completedTasks: progress.completedTasks,
              message: progress.message,
              accountName: progress.accountName,
              contentType: progress.contentType,
            });
          }
        : undefined,
    });

    if (requestId) {
      finishIssuePackProgress({
        requestId,
        totalTasks,
      });
    }

    return withCookie(NextResponse.json({ ok: true, result }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (requestId) {
      failIssuePackProgress({
        requestId,
        totalTasks: Math.max(totalTasks, 1),
        completedTasks,
        error: message,
      });
    }
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
