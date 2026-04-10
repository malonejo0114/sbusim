export type NaverCount = {
  raw: string;
  value: number | null;
  underTen: boolean;
};

export type SearchAdKeywordOverview = {
  relKeyword: string;
  monthlyPcQcCnt: NaverCount;
  monthlyMobileQcCnt: NaverCount;
  monthlyAvePcClkCnt: number | null;
  monthlyAveMobileClkCnt: number | null;
  monthlyAvePcCtr: number | null;
  monthlyAveMobileCtr: number | null;
  plAvgDepth: number | null;
  compIdx: string | null;
};

export type SearchAdBidEstimate = {
  keyword: string;
  nccKeywordId: string | null;
  position: number;
  bidUnits: number;
  bidKrw: number;
};

export type NaverTrendPoint = {
  period: string;
  ratio: number;
};

export type NaverTrendGroup = {
  groupName: string;
  keywords: string[];
  data: NaverTrendPoint[];
};

export function normalizeSearchAdCount(input: unknown): NaverCount {
  const raw = typeof input === "string" ? input.trim() : String(input ?? "").trim();
  if (!raw) {
    return { raw: "", value: null, underTen: false };
  }

  if (raw === "<10") {
    return { raw, value: 0, underTen: true };
  }

  const numeric = Number(raw);
  return {
    raw,
    value: Number.isFinite(numeric) ? numeric : null,
    underTen: false,
  };
}

export function normalizeNumericMetric(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "-") return null;
    if (trimmed === "<10") return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeSearchAdOverviewRow(row: Record<string, unknown>): SearchAdKeywordOverview {
  return {
    relKeyword: String(row.relKeyword ?? "").trim(),
    monthlyPcQcCnt: normalizeSearchAdCount(row.monthlyPcQcCnt),
    monthlyMobileQcCnt: normalizeSearchAdCount(row.monthlyMobileQcCnt),
    monthlyAvePcClkCnt: normalizeNumericMetric(row.monthlyAvePcClkCnt),
    monthlyAveMobileClkCnt: normalizeNumericMetric(row.monthlyAveMobileClkCnt),
    monthlyAvePcCtr: normalizeNumericMetric(row.monthlyAvePcCtr),
    monthlyAveMobileCtr: normalizeNumericMetric(row.monthlyAveMobileCtr),
    plAvgDepth: normalizeNumericMetric(row.plAvgDepth),
    compIdx: typeof row.compIdx === "string" && row.compIdx.trim() ? row.compIdx.trim() : null,
  };
}

export function normalizeSearchAdBidRow(row: Record<string, unknown>): SearchAdBidEstimate {
  const bidUnits = normalizeNumericMetric(row.bid) ?? 0;
  return {
    keyword: String(row.keyword ?? "").trim(),
    nccKeywordId: typeof row.nccKeywordId === "string" && row.nccKeywordId.trim() ? row.nccKeywordId.trim() : null,
    position: Math.max(1, Math.floor(normalizeNumericMetric(row.position) ?? 1)),
    bidUnits: Math.max(0, Math.floor(bidUnits)),
    bidKrw: Math.max(0, Math.floor(bidUnits)) * 10,
  };
}

export function normalizeNaverTrendGroup(row: Record<string, unknown>): NaverTrendGroup {
  const keywords = Array.isArray(row.keywords)
    ? row.keywords.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const data = Array.isArray(row.data)
    ? row.data
        .map((point) => ({
          period: String((point as Record<string, unknown>)?.period ?? "").trim(),
          ratio: Number((point as Record<string, unknown>)?.ratio ?? 0),
        }))
        .filter((point) => point.period.length > 0 && Number.isFinite(point.ratio))
    : [];

  return {
    groupName: String(row.title ?? row.groupName ?? "").trim(),
    keywords,
    data,
  };
}
