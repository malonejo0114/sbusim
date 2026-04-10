import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry } from "@/lib/market/net";
import { upsertRssItems } from "@/lib/market/repository";

export type RssSourceRow = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
};

export type ParsedRssItem = {
  guid: string;
  title: string;
  link: string;
  publishedAt: string | null;
  raw: Record<string, unknown>;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function pickGuid(item: Record<string, unknown>, index: number) {
  const guid = item.guid;
  if (typeof guid === "string" && guid.trim()) return guid.trim();

  if (typeof guid === "object" && guid && "#text" in guid) {
    const text = (guid as { "#text"?: unknown })["#text"];
    if (typeof text === "string" && text.trim()) return text.trim();
  }

  const link = typeof item.link === "string" ? item.link.trim() : "";
  if (link) return link;
  return `item-${index}`;
}

export async function fetchRssItems(url: string): Promise<ParsedRssItem[]> {
  const res = await fetchWithRetry(url, { method: "GET" }, { timeoutMs: 20_000, retries: 3 });
  const xml = await res.text();
  const parsed = parser.parse(xml) as Record<string, unknown>;

  const rssItems = toArray(
    ((parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined)?.item as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | undefined
  );

  const atomEntries = toArray(
    (parsed.feed as Record<string, unknown> | undefined)?.entry as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | undefined
  );

  const items = rssItems.length > 0 ? rssItems : atomEntries;

  return items.map((item, index) => {
    const link =
      typeof item.link === "string"
        ? item.link
        : typeof item.link === "object" && item.link && "@_href" in item.link
          ? String((item.link as { "@_href"?: unknown })["@_href"] ?? "")
          : "";

    const titleRaw = item.title;
    const title = typeof titleRaw === "string" ? titleRaw : String(titleRaw ?? "");

    return {
      guid: pickGuid(item, index),
      title: title.trim(),
      link: link.trim(),
      publishedAt: normalizeDate(item.pubDate ?? item.published ?? item.updated),
      raw: item,
    };
  });
}

export async function syncRssSource(
  source: RssSourceRow,
  limit = 30
): Promise<ParsedRssItem[]> {
  const parsed = await fetchRssItems(source.url);
  const trimmed = parsed.slice(0, Math.max(1, Math.min(limit, 100)));

  await upsertRssItems(
    source.id,
    trimmed.map((item) => ({
      guid: item.guid,
      title: item.title,
      link: item.link,
      publishedAt: item.publishedAt,
      raw: item.raw,
    }))
  );

  return trimmed;
}
