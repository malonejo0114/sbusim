import { DailyTopicPlanContentType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

const PlanSchema = z.object({
  threadsAccountId: z.string().trim().min(1),
  topic: z.string().trim().min(1).max(300),
  promptHint: z.string().trim().max(2000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  ctaText: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  contentType: z.nativeEnum(DailyTopicPlanContentType).optional().default(DailyTopicPlanContentType.TOPIC),
  dailyCount: z.coerce.number().int().min(1).max(250).optional().default(3),
  intervalMinMinutes: z.coerce.number().int().min(1).max(24 * 60).optional().default(60),
  intervalMaxMinutes: z.coerce.number().int().min(1).max(24 * 60).optional().default(90),
  windowStartHour: z.coerce.number().int().min(0).max(23).optional().default(9),
  windowEndHour: z.coerce.number().int().min(0).max(23).optional().default(23),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).optional().default([1, 2, 3, 4, 5]),
  infoRatioPercent: z.coerce.number().int().min(0).max(100).optional().default(70),
  ctaRatioPercent: z.coerce.number().int().min(0).max(100).optional().default(30),
  similarityThresholdPct: z.coerce.number().int().min(30).max(95).optional().default(72),
  telegramOnError: z.coerce.boolean().optional().default(true),
  enabled: z.coerce.boolean().optional().default(true),
});

function normalizeWeekdays(days: number[]) {
  return Array.from(new Set(days)).sort((a, b) => a - b).join(",");
}

function normalizeRatios(infoRatioPercent: number, ctaRatioPercent: number) {
  let info = Math.max(0, Math.min(100, infoRatioPercent));
  let cta = Math.max(0, Math.min(100, ctaRatioPercent));
  if (info + cta > 100) {
    cta = Math.max(0, 100 - info);
  }
  return { info, cta };
}

export async function GET(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const url = new URL(req.url);
    const threadsAccountId = url.searchParams.get("threadsAccountId")?.trim();

    const plans = await prisma.dailyTopicPlan.findMany({
      where: {
        userId,
        ...(threadsAccountId ? { threadsAccountId } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    return withCookie(
      NextResponse.json({
        plans: plans.map((plan) => ({
          ...plan,
          weekdays: plan.weekdaysCsv
            .split(",")
            .map((v) => Number(v))
            .filter((v) => Number.isInteger(v) && v >= 1 && v <= 7),
          lastGeneratedAt: plan.lastGeneratedAt?.toISOString() ?? null,
          createdAt: plan.createdAt.toISOString(),
          updatedAt: plan.updatedAt.toISOString(),
        })),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const body = await req.json().catch(() => null);
  const parsed = PlanSchema.safeParse(body);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);
    const input = parsed.data;
    const account = await prisma.threadsAccount.findFirst({
      where: { id: input.threadsAccountId, userId },
      select: { id: true },
    });
    if (!account) return withCookie(NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 400 }));

    const intervalMin = Math.min(input.intervalMinMinutes, input.intervalMaxMinutes);
    const intervalMax = Math.max(input.intervalMinMinutes, input.intervalMaxMinutes);
    const { info, cta } = normalizeRatios(input.infoRatioPercent, input.ctaRatioPercent);

    const created = await prisma.dailyTopicPlan.create({
      data: {
        userId,
        threadsAccountId: input.threadsAccountId,
        topic: input.topic,
        promptHint: input.promptHint ?? null,
        ctaText: input.ctaText ?? null,
        contentType: input.contentType,
        dailyCount: input.dailyCount,
        intervalMinutes: intervalMin,
        intervalMinMinutes: intervalMin,
        intervalMaxMinutes: intervalMax,
        scheduleHour: input.windowStartHour,
        scheduleMinute: 0,
        windowStartHour: input.windowStartHour,
        windowEndHour: input.windowEndHour,
        weekdaysCsv: normalizeWeekdays(input.weekdays),
        infoRatioPercent: info,
        ctaRatioPercent: cta,
        similarityThresholdPct: input.similarityThresholdPct,
        telegramOnError: input.telegramOnError,
        enabled: input.enabled,
      },
    });

    return withCookie(
      NextResponse.json({
        plan: {
          ...created,
          weekdays: created.weekdaysCsv
            .split(",")
            .map((v) => Number(v))
            .filter((v) => Number.isInteger(v) && v >= 1 && v <= 7),
          lastGeneratedAt: created.lastGeneratedAt?.toISOString() ?? null,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
