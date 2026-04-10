import { prisma } from "@/lib/prisma";
import { optionalEnv } from "@/server/env";

export type AiTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AiUsageSummaryBucket = {
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostKrw: number;
};

export type AiUsageSummary = {
  daily: AiUsageSummaryBucket;
  weekly: AiUsageSummaryBucket;
  monthly: AiUsageSummaryBucket;
};

type AiPricingRate = {
  promptUsdPer1M: number;
  completionUsdPer1M: number;
  requestUsd: number;
};

type AiUsageCostRow = {
  provider: string;
  model: string;
  _sum: {
    promptTokens: number | null;
    completionTokens: number | null;
    requestCount: number | null;
  };
};

const DEFAULT_MODEL_PRICING: Record<string, AiPricingRate> = {
  "gemini/gemini-2.0-flash": { promptUsdPer1M: 0.1, completionUsdPer1M: 0.4, requestUsd: 0 },
  "gemini/gemini-2.0-flash-lite": { promptUsdPer1M: 0.075, completionUsdPer1M: 0.3, requestUsd: 0 },
  "gemini/gemini-3.0-flash-preview": { promptUsdPer1M: 0.35, completionUsdPer1M: 1.05, requestUsd: 0 },
  "gemini/gemini-3.0-pro-preview": { promptUsdPer1M: 3.5, completionUsdPer1M: 10, requestUsd: 0 },
  "perplexity/sonar": { promptUsdPer1M: 1, completionUsdPer1M: 1, requestUsd: 0 },
  "perplexity/sonar-pro": { promptUsdPer1M: 3, completionUsdPer1M: 15, requestUsd: 0 },
};

const DEFAULT_PROVIDER_PRICING: Record<string, AiPricingRate> = {
  gemini: { promptUsdPer1M: 0.1, completionUsdPer1M: 0.4, requestUsd: 0 },
  perplexity: { promptUsdPer1M: 1, completionUsdPer1M: 1, requestUsd: 0 },
};

const ZERO_RATE: AiPricingRate = { promptUsdPer1M: 0, completionUsdPer1M: 0, requestUsd: 0 };

function normalizeRate(input: Partial<AiPricingRate> | null | undefined): AiPricingRate {
  return {
    promptUsdPer1M: Math.max(0, Number(input?.promptUsdPer1M ?? 0) || 0),
    completionUsdPer1M: Math.max(0, Number(input?.completionUsdPer1M ?? 0) || 0),
    requestUsd: Math.max(0, Number(input?.requestUsd ?? 0) || 0),
  };
}

function loadPricingOverrides(): Record<string, AiPricingRate> {
  const raw = optionalEnv("AI_MODEL_PRICING_JSON");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<AiPricingRate>>;
    const out: Record<string, AiPricingRate> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const normKey = key.trim().toLowerCase();
      if (!normKey) continue;
      out[normKey] = normalizeRate(value);
    }
    return out;
  } catch {
    return {};
  }
}

const PRICING_OVERRIDES = loadPricingOverrides();

function resolvePricingRate(provider: string, model: string): AiPricingRate {
  const p = provider.trim().toLowerCase();
  const m = model.trim().toLowerCase();
  const exact = `${p}/${m}`;
  const providerWildcard = `${p}/*`;

  return (
    PRICING_OVERRIDES[exact] ||
    PRICING_OVERRIDES[providerWildcard] ||
    DEFAULT_MODEL_PRICING[exact] ||
    DEFAULT_PROVIDER_PRICING[p] ||
    ZERO_RATE
  );
}

function usdToKrwRate() {
  const raw = optionalEnv("USD_KRW_RATE");
  const value = raw ? Number(raw) : NaN;
  if (Number.isFinite(value) && value > 0) return value;
  return 1380;
}

function roundUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(6));
}

function roundKrw(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function estimateCostUsd(rows: AiUsageCostRow[]): number {
  let total = 0;
  for (const row of rows) {
    const rate = resolvePricingRate(row.provider, row.model);
    const promptTokens = clampInt(row._sum.promptTokens ?? 0);
    const completionTokens = clampInt(row._sum.completionTokens ?? 0);
    const requestCount = clampInt(row._sum.requestCount ?? 0);
    total +=
      (promptTokens / 1_000_000) * rate.promptUsdPer1M +
      (completionTokens / 1_000_000) * rate.completionUsdPer1M +
      requestCount * rate.requestUsd;
  }
  return roundUsd(total);
}

function clampInt(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function kstDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function kstMidnightUtc(parts: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(parts.year, parts.month, parts.day, 0, 0, 0, 0) - 9 * 60 * 60 * 1000);
}

function getKstPeriodStarts(now = new Date()) {
  const parts = kstDateParts(now);
  const dailyStart = kstMidnightUtc(parts);

  const diffToMonday = (parts.weekday + 6) % 7; // Sun=0 => 6, Mon=1 => 0
  const weekStartParts = {
    year: parts.year,
    month: parts.month,
    day: parts.day - diffToMonday,
  };
  const weeklyStart = kstMidnightUtc(weekStartParts);
  const monthlyStart = kstMidnightUtc({
    year: parts.year,
    month: parts.month,
    day: 1,
  });

  return {
    dailyStart,
    weeklyStart,
    monthlyStart,
  };
}

export async function recordAiUsage(args: {
  userId?: string | null;
  provider: string;
  model: string;
  requestType?: string;
  usage?: Partial<AiTokenUsage> | null;
}) {
  const userId = args.userId?.trim();
  if (!userId) return;

  const promptTokens = clampInt(args.usage?.promptTokens ?? 0);
  const completionTokens = clampInt(args.usage?.completionTokens ?? 0);
  const totalTokensRaw = args.usage?.totalTokens ?? promptTokens + completionTokens;
  const totalTokens = clampInt(totalTokensRaw);

  await prisma.aiUsageLog
    .create({
      data: {
        userId,
        provider: args.provider,
        model: args.model,
        requestType: args.requestType?.trim() || null,
        promptTokens,
        completionTokens,
        totalTokens,
        requestCount: 1,
      },
    })
    .catch(() => {});
}

function toSummaryBucket(row: {
  _count: { _all: number };
  _sum: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    requestCount: number | null;
  };
}, costUsd: number, usdKrw: number): AiUsageSummaryBucket {
  return {
    requestCount: clampInt((row._sum.requestCount ?? 0) || row._count._all || 0),
    promptTokens: clampInt(row._sum.promptTokens ?? 0),
    completionTokens: clampInt(row._sum.completionTokens ?? 0),
    totalTokens: clampInt(row._sum.totalTokens ?? 0),
    estimatedCostUsd: roundUsd(costUsd),
    estimatedCostKrw: roundKrw(costUsd * usdKrw),
  };
}

export async function getAiUsageSummaryForUser(userId: string): Promise<AiUsageSummary> {
  const uid = userId.trim();
  if (!uid) {
    return {
      daily: { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, estimatedCostKrw: 0 },
      weekly: { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, estimatedCostKrw: 0 },
      monthly: { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, estimatedCostKrw: 0 },
    };
  }

  const { dailyStart, weeklyStart, monthlyStart } = getKstPeriodStarts();
  const [daily, weekly, monthly, dailyRows, weeklyRows, monthlyRows] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where: { userId: uid, createdAt: { gte: dailyStart } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, requestCount: true },
    }),
    prisma.aiUsageLog.aggregate({
      where: { userId: uid, createdAt: { gte: weeklyStart } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, requestCount: true },
    }),
    prisma.aiUsageLog.aggregate({
      where: { userId: uid, createdAt: { gte: monthlyStart } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, requestCount: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ["provider", "model"],
      where: { userId: uid, createdAt: { gte: dailyStart } },
      _sum: { promptTokens: true, completionTokens: true, requestCount: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ["provider", "model"],
      where: { userId: uid, createdAt: { gte: weeklyStart } },
      _sum: { promptTokens: true, completionTokens: true, requestCount: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ["provider", "model"],
      where: { userId: uid, createdAt: { gte: monthlyStart } },
      _sum: { promptTokens: true, completionTokens: true, requestCount: true },
    }),
  ]);

  const usdKrw = usdToKrwRate();
  const dailyCostUsd = estimateCostUsd(dailyRows);
  const weeklyCostUsd = estimateCostUsd(weeklyRows);
  const monthlyCostUsd = estimateCostUsd(monthlyRows);

  return {
    daily: toSummaryBucket(daily, dailyCostUsd, usdKrw),
    weekly: toSummaryBucket(weekly, weeklyCostUsd, usdKrw),
    monthly: toSummaryBucket(monthly, monthlyCostUsd, usdKrw),
  };
}
