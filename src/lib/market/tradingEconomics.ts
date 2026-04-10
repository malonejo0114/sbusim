import { requireEnv, optionalEnv } from "@/server/env";
import { fetchJsonWithRetry } from "@/lib/market/net";
import type { MarketInstrumentRow } from "@/lib/market/types";

type TeMarketRow = Record<string, unknown>;

type HistoricalPoint = {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  raw: TeMarketRow;
};

function teBaseUrl() {
  return (optionalEnv("TE_BASE_URL") ?? "https://api.tradingeconomics.com").replace(/\/+$/, "");
}

function buildTeUrl(path: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(`${teBaseUrl()}${path}`);
  url.searchParams.set("c", requireEnv("TE_API_KEY"));
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function numberOrNull(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeSymbol(raw: TeMarketRow) {
  const symbol =
    (raw.Symbol as string | undefined) ??
    (raw.symbol as string | undefined) ??
    (raw.Ticker as string | undefined) ??
    (raw.ticker as string | undefined) ??
    (raw.Category as string | undefined) ??
    (raw.Name as string | undefined);
  return symbol ? String(symbol).trim().toUpperCase() : "";
}

function normalizeDailyPct(raw: TeMarketRow) {
  return (
    numberOrNull(raw.DailyPercentualChange) ??
    numberOrNull(raw.dailyPercentualChange) ??
    numberOrNull(raw.DailyChange) ??
    numberOrNull(raw.dailyChange) ??
    0
  );
}

function normalizeLast(raw: TeMarketRow) {
  return (
    numberOrNull(raw.Last) ??
    numberOrNull(raw.last) ??
    numberOrNull(raw.Price) ??
    numberOrNull(raw.price) ??
    numberOrNull(raw.Close) ??
    numberOrNull(raw.close) ??
    0
  );
}

export async function fetchSnapshotRaw(): Promise<TeMarketRow[]> {
  const url = buildTeUrl("/markets/snapshot", { f: "json" });
  const json = await fetchJsonWithRetry<unknown>(url, { method: "GET" }, { timeoutMs: 20_000, retries: 3 });
  return Array.isArray(json) ? (json as TeMarketRow[]) : [];
}

export async function fetchSnapshot(instruments: MarketInstrumentRow[]) {
  const rows = await fetchSnapshotRaw();
  const bySymbol = new Map<string, TeMarketRow[]>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row);
    if (!symbol) continue;
    const arr = bySymbol.get(symbol) ?? [];
    arr.push(row);
    bySymbol.set(symbol, arr);
  }

  const result = instruments.map((instrument) => {
    const target = instrument.te_symbol.trim().toUpperCase();
    const exact = bySymbol.get(target)?.[0];
    const fuzzy = exact
      ? exact
      : rows.find((row) => {
          const symbol = normalizeSymbol(row);
          const name = String((row.Name as string | undefined) ?? "").toUpperCase();
          return symbol.includes(target) || target.includes(symbol) || name.includes(target);
        });
    const picked = fuzzy ?? {};
    return {
      instrumentId: instrument.id,
      symbol: instrument.te_symbol,
      label: instrument.label,
      last: normalizeLast(picked),
      dailyPct: normalizeDailyPct(picked),
      raw: picked,
    };
  });

  return result;
}

function normalizeHistoricalDate(row: TeMarketRow) {
  const value =
    (row.Date as string | undefined) ??
    (row.date as string | undefined) ??
    (row.DateTime as string | undefined) ??
    (row.datetime as string | undefined);
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function fetchHistorical(symbol: string, days = 7): Promise<HistoricalPoint[]> {
  const safeDays = Math.max(2, Math.min(days, 120));

  const candidateUrls = [
    buildTeUrl(`/markets/historical/${encodeURIComponent(symbol)}`, { f: "json", output: "json" }),
    buildTeUrl(`/markets/historical/${encodeURIComponent(symbol)}`, { f: "json" }),
    buildTeUrl(`/historical/${encodeURIComponent(symbol)}`, { f: "json" }),
  ];

  let rows: TeMarketRow[] = [];
  let lastError: unknown = null;

  for (const url of candidateUrls) {
    try {
      const json = await fetchJsonWithRetry<unknown>(url, { method: "GET" }, { timeoutMs: 20_000, retries: 2 });
      if (Array.isArray(json)) {
        rows = json as TeMarketRow[];
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (rows.length === 0 && lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const mapped: HistoricalPoint[] = [];
  for (const row of rows) {
    const date = normalizeHistoricalDate(row);
    const close = numberOrNull(row.Close) ?? numberOrNull(row.close) ?? numberOrNull(row.Value) ?? numberOrNull(row.value);
    if (!date || close === null) continue;

    const point: HistoricalPoint = {
      date,
      close,
      raw: row,
    };
    const open = numberOrNull(row.Open) ?? numberOrNull(row.open) ?? undefined;
    const high = numberOrNull(row.High) ?? numberOrNull(row.high) ?? undefined;
    const low = numberOrNull(row.Low) ?? numberOrNull(row.low) ?? undefined;
    if (open !== undefined) point.open = open;
    if (high !== undefined) point.high = high;
    if (low !== undefined) point.low = low;
    mapped.push(point);
  }

  mapped.sort((a, b) => (a.date < b.date ? -1 : 1));

  if (mapped.length <= safeDays) return mapped;
  return mapped.slice(mapped.length - safeDays);
}

export function tradingEconomicsSourceUrl(kind: "snapshot" | "historical" | "calendar") {
  if (kind === "snapshot") return `${teBaseUrl()}/markets/snapshot`;
  if (kind === "historical") return `${teBaseUrl()}/markets/historical`;
  return `${teBaseUrl()}/calendar`;
}
