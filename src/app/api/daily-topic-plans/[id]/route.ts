import { DailyTopicPlanContentType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

const UpdatePlanSchema = z.object({
  topic: z.string().trim().min(1).max(300).optional(),
  promptHint: z.string().trim().max(2000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  ctaText: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  contentType: z.nativeEnum(DailyTopicPlanContentType).optional(),
  dailyCount: z.coerce.number().int().min(1).max(250).optional(),
  intervalMinMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
  intervalMaxMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
  windowStartHour: z.coerce.number().int().min(0).max(23).optional(),
  windowEndHour: z.coerce.number().int().min(0).max(23).optional(),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).optional(),
  infoRatioPercent: z.coerce.number().int().min(0).max(100).optional(),
  ctaRatioPercent: z.coerce.number().int().min(0).max(100).optional(),
  similarityThresholdPct: z.coerce.number().int().min(30).max(95).optional(),
  telegramOnError: z.coerce.boolean().optional(),
  enabled: z.coerce.boolean().optional(),
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const body = await req.json().catch(() => null);
  const parsed = UpdatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);
    const { id } = await ctx.params;
    const existing = await prisma.dailyTopicPlan.findFirst({
      where: { id, userId },
    });
    if (!existing) return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));

    const input = parsed.data;
    const patch: Record<string, unknown> = {};

    if (input.topic !== undefined) patch.topic = input.topic;
    if (input.promptHint !== undefined) patch.promptHint = input.promptHint ?? null;
    if (input.ctaText !== undefined) patch.ctaText = input.ctaText ?? null;
    if (input.contentType !== undefined) patch.contentType = input.contentType;
    if (input.dailyCount !== undefined) patch.dailyCount = input.dailyCount;
    if (input.windowStartHour !== undefined) patch.windowStartHour = input.windowStartHour;
    if (input.windowEndHour !== undefined) patch.windowEndHour = input.windowEndHour;
    if (input.weekdays !== undefined) patch.weekdaysCsv = normalizeWeekdays(input.weekdays);
    if (input.telegramOnError !== undefined) patch.telegramOnError = input.telegramOnError;
    if (input.similarityThresholdPct !== undefined) patch.similarityThresholdPct = input.similarityThresholdPct;
    if (input.enabled !== undefined) patch.enabled = input.enabled;

    const intervalMin = input.intervalMinMinutes ?? existing.intervalMinMinutes;
    const intervalMax = input.intervalMaxMinutes ?? existing.intervalMaxMinutes;
    if (input.intervalMinMinutes !== undefined || input.intervalMaxMinutes !== undefined) {
      patch.intervalMinMinutes = Math.min(intervalMin, intervalMax);
      patch.intervalMaxMinutes = Math.max(intervalMin, intervalMax);
      patch.intervalMinutes = patch.intervalMinMinutes;
    }

    const nextInfo = input.infoRatioPercent ?? existing.infoRatioPercent;
    const nextCta = input.ctaRatioPercent ?? existing.ctaRatioPercent;
    if (input.infoRatioPercent !== undefined || input.ctaRatioPercent !== undefined) {
      const ratios = normalizeRatios(nextInfo, nextCta);
      patch.infoRatioPercent = ratios.info;
      patch.ctaRatioPercent = ratios.cta;
    }

    const updated = await prisma.dailyTopicPlan.update({
      where: { id },
      data: patch,
    });

    return withCookie(
      NextResponse.json({
        plan: {
          ...updated,
          weekdays: updated.weekdaysCsv
            .split(",")
            .map((v) => Number(v))
            .filter((v) => Number.isInteger(v) && v >= 1 && v <= 7),
          lastGeneratedAt: updated.lastGeneratedAt?.toISOString() ?? null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const { id } = await ctx.params;
    const existing = await prisma.dailyTopicPlan.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));

    await prisma.dailyTopicPlan.delete({ where: { id } });
    return withCookie(NextResponse.json({ ok: true }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
