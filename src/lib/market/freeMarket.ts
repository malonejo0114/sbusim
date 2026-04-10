import { fetchJsonWithRetry } from "@/lib/market/net";
import type { MarketInstrumentRow } from "@/lib/market/types";

type YahooChartMeta = {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
};

type YahooChartResult = {
  meta?: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
};

type YahooChartResponse = {
  chart?: {
    result?: YahooChartResult[];
    error?: unknown;
  };
};

type FreeSnapshotRow = {
  instrumentId: string;
  symbol: string;
  label: string;
  last: number;
  dailyPct: number;
  series: number[];
  raw: Record<string, unknown>;
};

const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const SYMBOL_MAP: Record<string, string> = {
  US500: "ES=F",
  SP500: "ES=F",
  US100: "NQ=F",
  NAS100: "NQ=F",
  NASDAQ100: "NQ=F",
  DXY: "DX-Y.NYB",
  CRUDE: "CL=F",
  WTI: "CL=F",
  XAUUSD: "GC=F",
  GOLD: "GC=F",
};

function toNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function resolveYahooSymbol(instrument: MarketInstrumentRow) {
  const raw = instrument.te_symbol.trim().toUpperCase();
  if (raw.includes("=") || raw.startsWith("^") || raw.includes(".")) return instrument.te_symbol;
  const byKey = SYMBOL_MAP[raw];
  if (byKey) return byKey;

  const label = instrument.label.trim().toUpperCase();
  if (label.includes("S&P")) return "ES=F";
  if (label.includes("NASDAQ") || label.includes("NAS")) return "NQ=F";
  if (label.includes("DXY") || label.includes("DOLLAR")) return "DX-Y.NYB";
  if (label.includes("WTI") || label.includes("CRUDE") || label.includes("OIL")) return "CL=F";
  if (label.includes("GOLD") || label.includes("XAU")) return "GC=F";

  return instrument.te_symbol;
}

function quoteUrl(symbol: string) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

async function fetchYahooSeries(symbol: string, days = 7) {
  const rangeDays = Math.max(7, Math.min(days + 3, 30));
  const url = `${YAHOO_CHART_BASE_URL}/${encodeURIComponent(symbol)}?interval=1d&range=${rangeDays}d`;
  const json = await fetchJsonWithRetry<YahooChartResponse>(url, { method: "GET" }, { timeoutMs: 20_000, retries: 3 });

  const result = json.chart?.result?.[0];
  if (!result) {
    throw new Error(`Yahoo chart empty for ${symbol}`);
  }

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const points = timestamps
    .map((ts, idx) => ({ ts, close: toNumber(closes[idx]) }))
    .filter((p): p is { ts: number; close: number } => p.close !== null)
    .sort((a, b) => a.ts - b.ts);

  const series = points.map((p) => p.close).slice(-Math.max(2, days));
  const last = series[series.length - 1] ?? toNumber(result.meta?.regularMarketPrice) ?? 0;
  const prev =
    toNumber(result.meta?.chartPreviousClose) ??
    toNumber(result.meta?.previousClose) ??
    (series.length >= 2 ? series[series.length - 2] : null) ??
    last;

  const dailyPct = prev ? ((last - prev) / prev) * 100 : 0;

  return {
    last,
    dailyPct: Number.isFinite(dailyPct) ? dailyPct : 0,
    series: series.length >= 2 ? series : [last, last],
    raw: json as unknown as Record<string, unknown>,
  };
}

export function yahooSourceUrl(symbol: string) {
  return quoteUrl(symbol);
}

export async function fetchFreeSnapshot(instruments: MarketInstrumentRow[], days = 7): Promise<FreeSnapshotRow[]> {
  const settled = await Promise.allSettled(
    instruments.map(async (instrument) => {
      const symbol = resolveYahooSymbol(instrument);
      const quote = await fetchYahooSeries(symbol, days);
      return {
        instrumentId: instrument.id,
        symbol,
        label: instrument.label,
        last: quote.last,
        dailyPct: quote.dailyPct,
        series: quote.series,
        raw: quote.raw,
      } satisfies FreeSnapshotRow;
    })
  );

  const rows: FreeSnapshotRow[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const item = settled[i];
    if (item.status === "fulfilled") {
      rows.push(item.value);
      continue;
    }

    const instrument = instruments[i];
    const symbol = resolveYahooSymbol(instrument);
    rows.push({
      instrumentId: instrument.id,
      symbol,
      label: instrument.label,
      last: 0,
      dailyPct: 0,
      series: [0, 0],
      raw: {
        provider: "yahoo-finance",
        error: item.reason instanceof Error ? item.reason.message : String(item.reason),
        source: quoteUrl(symbol),
      },
    });
  }

  return rows;
}
