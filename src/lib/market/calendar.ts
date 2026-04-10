import { requireEnv, optionalEnv } from "@/server/env";
import { fetchJsonWithRetry } from "@/lib/market/net";
import { addDays, parseAnyDate, toKstDateKey } from "@/lib/market/time";

type TeCalendarRow = Record<string, unknown>;

export type TopEconomicEvent = {
  eventDate: string;
  eventTimeIso: string | null;
  country: string;
  event: string;
  importance: number;
  sourceUrl: string;
  raw: TeCalendarRow;
};

function teBaseUrl() {
  return (optionalEnv("TE_BASE_URL") ?? "https://api.tradingeconomics.com").replace(/\/+$/, "");
}

function buildCalendarUrl(params?: Record<string, string | number | undefined>) {
  const url = new URL(`${teBaseUrl()}/calendar`);
  url.searchParams.set("c", requireEnv("TE_API_KEY"));
  url.searchParams.set("f", "json");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function toImportance(raw: TeCalendarRow) {
  const value =
    raw.Importance ?? raw.importance ?? raw.ImportanceLevel ?? raw.importanceLevel ?? raw.Relevance ?? raw.relevance;
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function toEventTime(raw: TeCalendarRow) {
  const v = raw.Date ?? raw.date ?? raw.DateTime ?? raw.dateTime ?? raw.CalendarDate;
  const parsed = parseAnyDate(v);
  return parsed ? parsed.toISOString() : null;
}

export async function fetchTodayTopEvents(dateKst: Date, importance = 3, top = 5): Promise<TopEconomicEvent[]> {
  const day = toKstDateKey(dateKst);
  const nextDay = toKstDateKey(addDays(dateKst, 1));

  const candidateUrls = [
    buildCalendarUrl({ d1: day, d2: day, importance, output: "json" }),
    buildCalendarUrl({ d1: day, d2: nextDay }),
    buildCalendarUrl(),
  ];

  let rows: TeCalendarRow[] = [];
  let lastError: unknown = null;
  for (const url of candidateUrls) {
    try {
      const json = await fetchJsonWithRetry<unknown>(url, { method: "GET" }, { timeoutMs: 20_000, retries: 2 });
      if (Array.isArray(json)) {
        rows = json as TeCalendarRow[];
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (rows.length === 0 && lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const mapped = rows
    .map((raw) => {
      const eventTimeIso = toEventTime(raw);
      const eventDate = eventTimeIso ? toKstDateKey(new Date(eventTimeIso)) : day;
      const country = String(raw.Country ?? raw.country ?? "").trim();
      const event = String(raw.Event ?? raw.event ?? raw.Calendar ?? raw.name ?? "").trim();
      const score = toImportance(raw);
      return {
        eventDate,
        eventTimeIso,
        country,
        event,
        importance: score,
        sourceUrl: `${teBaseUrl()}/calendar`,
        raw,
      };
    })
    .filter((row) => row.eventDate === day)
    .filter((row) => row.importance >= importance)
    .filter((row) => row.event.length > 0)
    .sort((a, b) => {
      if (a.importance !== b.importance) return b.importance - a.importance;
      if (a.eventTimeIso && b.eventTimeIso) return a.eventTimeIso < b.eventTimeIso ? -1 : 1;
      if (a.eventTimeIso) return -1;
      if (b.eventTimeIso) return 1;
      return 0;
    })
    .slice(0, Math.max(1, Math.min(top, 20)));

  return mapped;
}
