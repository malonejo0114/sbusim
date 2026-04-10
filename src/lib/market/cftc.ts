import { optionalEnv } from "@/server/env";
import { fetchJsonWithRetry } from "@/lib/market/net";
import { parseAnyDate, toKstDateKey } from "@/lib/market/time";

type CotRow = Record<string, unknown>;

export type CotSnapshot = {
  reportDate: string;
  marketCode: string;
  netNonCommercial: number;
  netChangeWoW: number;
  raw: CotRow;
};

const MARKET_MATCHERS: Array<{ code: string; keywords: string[] }> = [
  { code: "GOLD", keywords: ["GOLD", "COMEX GOLD"] },
  { code: "CRUDE", keywords: ["CRUDE", "WTI", "LIGHT SWEET"] },
  { code: "SP500", keywords: ["S&P 500", "SP 500"] },
  { code: "NASDAQ", keywords: ["NASDAQ"] },
  { code: "DXY", keywords: ["U.S. DOLLAR INDEX", "DOLLAR INDEX"] },
];

function cftcBaseUrl() {
  return (
    optionalEnv("CFTC_SOCRATA_URL") ??
    "https://publicreporting.cftc.gov/resource/kh3c-gbw2.json"
  );
}

function numberOrZero(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickDate(raw: CotRow) {
  const d =
    raw.report_date_as_yyyy_mm_dd ??
    raw.report_date ??
    raw.report_date_as_yyyy_mm_dd_1 ??
    raw.date;
  const parsed = parseAnyDate(d);
  return parsed ? toKstDateKey(parsed) : null;
}

function pickMarketName(raw: CotRow) {
  const name =
    raw.market_and_exchange_names ??
    raw.market_and_exchange_name ??
    raw.contract_market_name ??
    raw.commodity_name ??
    raw.market_name;
  return String(name ?? "").toUpperCase();
}

function normalizeMarketCode(raw: CotRow) {
  const marketName = pickMarketName(raw);
  for (const matcher of MARKET_MATCHERS) {
    if (matcher.keywords.some((keyword) => marketName.includes(keyword.toUpperCase()))) {
      return matcher.code;
    }
  }

  const directCode = String(
    raw.cftc_contract_market_code ?? raw.contract_market_code ?? raw.market_code ?? ""
  )
    .trim()
    .toUpperCase();
  if (directCode) return directCode;
  return "UNKNOWN";
}

function pickLong(raw: CotRow) {
  return numberOrZero(
    raw.noncomm_positions_long_all ??
      raw.noncommercial_long ??
      raw.noncomm_long ??
      raw.noncommercial_positions_long_all
  );
}

function pickShort(raw: CotRow) {
  return numberOrZero(
    raw.noncomm_positions_short_all ??
      raw.noncommercial_short ??
      raw.noncomm_short ??
      raw.noncommercial_positions_short_all
  );
}

async function fetchCotRows() {
  const url = new URL(cftcBaseUrl());
  url.searchParams.set("$limit", "1500");
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");

  const json = await fetchJsonWithRetry<unknown>(url.toString(), { method: "GET" }, { timeoutMs: 20_000, retries: 3 });
  return Array.isArray(json) ? (json as CotRow[]) : [];
}

export async function fetchLatestCotSnapshots(): Promise<CotSnapshot[]> {
  const rows = await fetchCotRows();

  const byMarket = new Map<string, Array<{ reportDate: string; net: number; raw: CotRow }>>();

  for (const raw of rows) {
    const reportDate = pickDate(raw);
    if (!reportDate) continue;

    const marketCode = normalizeMarketCode(raw);
    if (marketCode === "UNKNOWN") continue;

    const net = pickLong(raw) - pickShort(raw);
    const arr = byMarket.get(marketCode) ?? [];
    arr.push({ reportDate, net, raw });
    byMarket.set(marketCode, arr);
  }

  const snapshots: CotSnapshot[] = [];
  for (const [marketCode, values] of byMarket.entries()) {
    const sorted = values.sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
    const latest = sorted[0];
    if (!latest) continue;
    const prev = sorted.find((v) => v.reportDate !== latest.reportDate);
    snapshots.push({
      reportDate: latest.reportDate,
      marketCode,
      netNonCommercial: latest.net,
      netChangeWoW: latest.net - (prev?.net ?? latest.net),
      raw: latest.raw,
    });
  }

  return snapshots.sort((a, b) => (a.marketCode < b.marketCode ? -1 : 1));
}

export function cftcSourceUrl() {
  return "https://publicreporting.cftc.gov";
}
