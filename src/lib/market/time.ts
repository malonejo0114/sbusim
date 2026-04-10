const KST_TZ = "Asia/Seoul";

export function nowKst() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: KST_TZ }));
}

export function toKstDateKey(d: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const map = new Map(parts.map((p) => [p.type, p.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

export function toKstDate(d: Date = new Date()) {
  return new Date(`${toKstDateKey(d)}T00:00:00+09:00`);
}

export function parseAnyDate(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
