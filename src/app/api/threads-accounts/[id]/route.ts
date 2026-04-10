import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptString } from "@/server/crypto";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { loadFollowerTrendForAccount } from "@/server/followerStats";

function getKstDayRange(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");

  const startUtc = new Date(Date.UTC(year, month - 1, day, -9, 0, 0, 0));
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

const UpdateAccountSchema = z.object({
  label: z.string().trim().max(80).optional(),
  proxyUrl: z.string().trim().max(500).optional(),
  rssReviewEnabled: z.boolean().optional(),
  rssIncludeSources: z.boolean().optional(),
  rssAutoPostEnabled: z.boolean().optional(),
  rssAutoPostMinIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  rssAutoPostMaxIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  rssFetchCount: z.number().int().min(1).max(20).optional(),
  rssKeywordIncludeCsv: z.string().trim().max(5000).optional(),
  rssKeywordExcludeCsv: z.string().trim().max(5000).optional(),
  rssPromptTemplate: z.string().trim().max(12000).optional(),
});

function validateProxyUrl(proxyUrl: string) {
  const u = new URL(proxyUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("proxyUrl must start with http:// or https://");
  }
  return u.toString();
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const { id } = await ctx.params;
    const account = await prisma.threadsAccount.findFirst({
      where: { id, userId },
      select: {
        id: true,
        label: true,
        threadsUserId: true,
        threadsUsername: true,
        proxyUrlEncrypted: true,
        tokenExpiresAt: true,
        rssReviewEnabled: true,
        rssIncludeSources: true,
        rssAutoPostEnabled: true,
        rssAutoPostMinIntervalMinutes: true,
        rssAutoPostMaxIntervalMinutes: true,
        rssFetchCount: true,
        rssKeywordIncludeCsv: true,
        rssKeywordExcludeCsv: true,
        rssPromptTemplate: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!account) return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));
    const { startUtc, endUtc } = getKstDayRange();
    const [followerStats, todayPublishedCount] = await Promise.all([
      loadFollowerTrendForAccount({ userId, threadsAccountId: account.id }),
      prisma.scheduledPost.count({
        where: {
          userId,
          threadsAccountId: account.id,
          remotePostId: { not: null },
          publishedAt: {
            gte: startUtc,
            lt: endUtc,
          },
        },
      }),
    ]);

    return withCookie(
      NextResponse.json({
        account: {
          id: account.id,
          label: account.label,
          threadsUserId: account.threadsUserId,
          threadsUsername: account.threadsUsername,
          hasProxy: Boolean(account.proxyUrlEncrypted),
          tokenExpiresAt: account.tokenExpiresAt.toISOString(),
          rssReviewEnabled: account.rssReviewEnabled,
          rssIncludeSources: account.rssIncludeSources,
          rssAutoPostEnabled: account.rssAutoPostEnabled,
          rssAutoPostMinIntervalMinutes: account.rssAutoPostMinIntervalMinutes,
          rssAutoPostMaxIntervalMinutes: account.rssAutoPostMaxIntervalMinutes,
          rssFetchCount: account.rssFetchCount,
          rssKeywordIncludeCsv: account.rssKeywordIncludeCsv ?? "",
          rssKeywordExcludeCsv: account.rssKeywordExcludeCsv ?? "",
          rssPromptTemplate: account.rssPromptTemplate ?? "",
          followerStats,
          workspaceStats: {
            todayPublishedCount,
          },
          createdAt: account.createdAt.toISOString(),
          updatedAt: account.updatedAt.toISOString(),
        },
      })
    );
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: details }, { status: 500 }));
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const json = await req.json().catch(() => null);
  const parsed = UpdateAccountSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  const { id } = await ctx.params;
  const account = await prisma.threadsAccount.findFirst({
    where: { id, userId },
  });
  if (!account) return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));

  try {
    await upsertUserById(userId);
    const proxyProvided =
      typeof json === "object" &&
      json !== null &&
      Object.prototype.hasOwnProperty.call(json, "proxyUrl");
    const proxyInput = proxyProvided ? (parsed.data.proxyUrl ?? "").trim() : undefined;

    const data: {
      label?: string | null;
      proxyUrlEncrypted?: string | null;
      rssReviewEnabled?: boolean;
      rssIncludeSources?: boolean;
      rssAutoPostEnabled?: boolean;
      rssAutoPostMinIntervalMinutes?: number;
      rssAutoPostMaxIntervalMinutes?: number;
      rssFetchCount?: number;
      rssKeywordIncludeCsv?: string | null;
      rssKeywordExcludeCsv?: string | null;
      rssPromptTemplate?: string | null;
    } = {};

    if (parsed.data.label !== undefined) {
      data.label = parsed.data.label.trim() || null;
    }
    if (proxyInput !== undefined) {
      data.proxyUrlEncrypted = proxyInput ? encryptString(validateProxyUrl(proxyInput)) : null;
    }
    if (typeof parsed.data.rssReviewEnabled === "boolean") {
      data.rssReviewEnabled = parsed.data.rssReviewEnabled;
    }
    if (typeof parsed.data.rssIncludeSources === "boolean") {
      data.rssIncludeSources = parsed.data.rssIncludeSources;
    }
    if (typeof parsed.data.rssAutoPostEnabled === "boolean") {
      data.rssAutoPostEnabled = parsed.data.rssAutoPostEnabled;
    }
    if (typeof parsed.data.rssAutoPostMinIntervalMinutes === "number") {
      data.rssAutoPostMinIntervalMinutes = Math.max(1, Math.min(parsed.data.rssAutoPostMinIntervalMinutes, 1440));
    }
    if (typeof parsed.data.rssAutoPostMaxIntervalMinutes === "number") {
      data.rssAutoPostMaxIntervalMinutes = Math.max(1, Math.min(parsed.data.rssAutoPostMaxIntervalMinutes, 1440));
    }
    if (
      typeof data.rssAutoPostMinIntervalMinutes === "number" ||
      typeof data.rssAutoPostMaxIntervalMinutes === "number"
    ) {
      const nextMin = data.rssAutoPostMinIntervalMinutes ?? account.rssAutoPostMinIntervalMinutes;
      const nextMax = data.rssAutoPostMaxIntervalMinutes ?? account.rssAutoPostMaxIntervalMinutes;
      data.rssAutoPostMinIntervalMinutes = Math.min(nextMin, nextMax);
      data.rssAutoPostMaxIntervalMinutes = Math.max(nextMin, nextMax);
    }
    if (typeof parsed.data.rssFetchCount === "number") {
      data.rssFetchCount = Math.max(1, Math.min(parsed.data.rssFetchCount, 20));
    }

    const includeProvided =
      typeof json === "object" &&
      json !== null &&
      Object.prototype.hasOwnProperty.call(json, "rssKeywordIncludeCsv");
    const excludeProvided =
      typeof json === "object" &&
      json !== null &&
      Object.prototype.hasOwnProperty.call(json, "rssKeywordExcludeCsv");
    const promptProvided =
      typeof json === "object" &&
      json !== null &&
      Object.prototype.hasOwnProperty.call(json, "rssPromptTemplate");
    if (includeProvided) {
      data.rssKeywordIncludeCsv = (parsed.data.rssKeywordIncludeCsv ?? "").trim() || null;
    }
    if (excludeProvided) {
      data.rssKeywordExcludeCsv = (parsed.data.rssKeywordExcludeCsv ?? "").trim() || null;
    }
    if (promptProvided) {
      data.rssPromptTemplate = (parsed.data.rssPromptTemplate ?? "").trim() || null;
    }

    if (Object.keys(data).length === 0) {
      const { startUtc, endUtc } = getKstDayRange();
      const [followerStats, todayPublishedCount] = await Promise.all([
        loadFollowerTrendForAccount({ userId, threadsAccountId: account.id }),
        prisma.scheduledPost.count({
          where: {
            userId,
            threadsAccountId: account.id,
            remotePostId: { not: null },
            publishedAt: {
              gte: startUtc,
              lt: endUtc,
            },
          },
        }),
      ]);
      return withCookie(
        NextResponse.json({
          account: {
            id: account.id,
            label: account.label,
            threadsUserId: account.threadsUserId,
            threadsUsername: account.threadsUsername,
            hasProxy: Boolean(account.proxyUrlEncrypted),
            tokenExpiresAt: account.tokenExpiresAt.toISOString(),
            rssReviewEnabled: account.rssReviewEnabled,
            rssIncludeSources: account.rssIncludeSources,
            rssAutoPostEnabled: account.rssAutoPostEnabled,
            rssAutoPostMinIntervalMinutes: account.rssAutoPostMinIntervalMinutes,
            rssAutoPostMaxIntervalMinutes: account.rssAutoPostMaxIntervalMinutes,
            rssFetchCount: account.rssFetchCount,
            rssKeywordIncludeCsv: account.rssKeywordIncludeCsv ?? "",
            rssKeywordExcludeCsv: account.rssKeywordExcludeCsv ?? "",
            rssPromptTemplate: account.rssPromptTemplate ?? "",
            followerStats,
            workspaceStats: {
              todayPublishedCount,
            },
          },
        })
      );
    }

    const updated = await prisma.threadsAccount.update({
      where: { id },
      data,
    });
    const { startUtc, endUtc } = getKstDayRange();
    const [followerStats, todayPublishedCount] = await Promise.all([
      loadFollowerTrendForAccount({ userId, threadsAccountId: updated.id }),
      prisma.scheduledPost.count({
        where: {
          userId,
          threadsAccountId: updated.id,
          remotePostId: { not: null },
          publishedAt: {
            gte: startUtc,
            lt: endUtc,
          },
        },
      }),
    ]);

    return withCookie(
      NextResponse.json({
        account: {
          id: updated.id,
          label: updated.label,
          threadsUserId: updated.threadsUserId,
          threadsUsername: updated.threadsUsername,
          hasProxy: Boolean(updated.proxyUrlEncrypted),
          tokenExpiresAt: updated.tokenExpiresAt.toISOString(),
          rssReviewEnabled: updated.rssReviewEnabled,
          rssIncludeSources: updated.rssIncludeSources,
          rssAutoPostEnabled: updated.rssAutoPostEnabled,
          rssAutoPostMinIntervalMinutes: updated.rssAutoPostMinIntervalMinutes,
          rssAutoPostMaxIntervalMinutes: updated.rssAutoPostMaxIntervalMinutes,
          rssFetchCount: updated.rssFetchCount,
          rssKeywordIncludeCsv: updated.rssKeywordIncludeCsv ?? "",
          rssKeywordExcludeCsv: updated.rssKeywordExcludeCsv ?? "",
          rssPromptTemplate: updated.rssPromptTemplate ?? "",
          followerStats,
          workspaceStats: {
            todayPublishedCount,
          },
        },
      })
    );
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: details }, { status: 400 }));
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const { id } = await ctx.params;
    const account = await prisma.threadsAccount.findFirst({
      where: { id, userId },
      select: {
        id: true,
        label: true,
        threadsUsername: true,
        threadsUserId: true,
      },
    });
    if (!account) return withCookie(NextResponse.json({ error: "Not found" }, { status: 404 }));

    const scheduledPostCount = await prisma.scheduledPost.count({
      where: { threadsAccountId: id, userId },
    });
    const dailyPlanCount = await prisma.dailyTopicPlan.count({
      where: { threadsAccountId: id, userId },
    });

    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!force && (scheduledPostCount > 0 || dailyPlanCount > 0)) {
      return withCookie(
        NextResponse.json(
          {
            error: "이 계정에는 연결된 예약/자동발행 데이터가 있습니다. 강제 삭제(force=1)로만 삭제할 수 있습니다.",
            counts: {
              scheduledPosts: scheduledPostCount,
              dailyTopicPlans: dailyPlanCount,
            },
          },
          { status: 409 }
        )
      );
    }

    await prisma.threadsAccount.delete({
      where: { id },
    });

    return withCookie(
      NextResponse.json({
        ok: true,
        deleted: {
          id: account.id,
          label: account.label,
          threadsUsername: account.threadsUsername,
          threadsUserId: account.threadsUserId,
        },
      })
    );
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: details }, { status: 400 }));
  }
}
