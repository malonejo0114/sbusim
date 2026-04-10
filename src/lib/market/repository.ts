import { getSupabaseAdminClient } from "@/server/supabaseAdmin";
import type { MarketInstrumentRow, PostQueueStatus, PostQueueType, SourceLink } from "@/lib/market/types";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type PostQueueRow = {
  id: string;
  platform: "threads";
  post_type: PostQueueType;
  dedupe_key: string | null;
  target_threads_account_id: string | null;
  scheduled_at: string;
  status: PostQueueStatus;
  text: string;
  media_url: string | null;
  sources: SourceLink[];
  hide_sources: boolean;
  error: string | null;
  retries: number;
  posted_at: string | null;
  created_at: string;
};

export type RssSourceConfig = {
  name: string;
  url: string;
};

export const DEFAULT_RSS_SOURCES: RssSourceConfig[] = [
  { name: "Investing KR 뉴스", url: "https://kr.investing.com/rss/news.rss" },
  { name: "Investing 세계 뉴스", url: "https://www.investing.com/rss/news_287.rss" },
  { name: "Investing 선물/원자재", url: "https://www.investing.com/rss/news_11.rss" },
  { name: "Investing 주식", url: "https://www.investing.com/rss/news_25.rss" },
  { name: "Investing 경제지표", url: "https://www.investing.com/rss/news_95.rss" },
];

export async function getEnabledMarketInstruments(): Promise<MarketInstrumentRow[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("market_instruments")
    .select("id,label,te_symbol,category,enabled,sort")
    .eq("enabled", true)
    .order("sort", { ascending: true });

  if (error) throw new Error(`market_instruments query failed: ${error.message}`);
  return (data ?? []) as MarketInstrumentRow[];
}

export async function upsertMarketSnapshots(
  asofDate: string,
  rows: Array<{ instrumentId: string; last: number; dailyPct: number; raw: Record<string, unknown> }>
) {
  const supabase = getSupabaseAdminClient();
  if (rows.length === 0) return;
  const payload = rows.map((row) => ({
    asof_date: asofDate,
    instrument_id: row.instrumentId,
    last: row.last,
    daily_pct: row.dailyPct,
    raw: row.raw,
  }));

  const { error } = await supabase
    .from("market_snapshots")
    .upsert(payload, { onConflict: "asof_date,instrument_id", ignoreDuplicates: false });

  if (error) throw new Error(`market_snapshots upsert failed: ${error.message}`);
}

export async function insertMarketChart(args: {
  asofDate: string;
  chartKind: "daily_snapshot_4pack" | "single_instrument_7d";
  imageUrl: string;
  meta: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("market_charts").insert({
    asof_date: args.asofDate,
    chart_kind: args.chartKind,
    image_url: args.imageUrl,
    meta: args.meta,
  });
  if (error) throw new Error(`market_charts insert failed: ${error.message}`);
}

export async function upsertEconomicEvents(
  rows: Array<{
    eventDate: string;
    eventTimeIso: string | null;
    country: string;
    event: string;
    importance: number;
    sourceUrl: string;
    raw: Record<string, unknown>;
  }>
) {
  if (rows.length === 0) return;
  const supabase = getSupabaseAdminClient();
  const payload = rows.map((row) => ({
    event_date: row.eventDate,
    event_time: row.eventTimeIso,
    country: row.country,
    event: row.event,
    importance: row.importance,
    source_url: row.sourceUrl,
    raw: row.raw,
  }));

  const { error } = await supabase.from("economic_events").insert(payload);
  if (error) throw new Error(`economic_events insert failed: ${error.message}`);
}

export async function upsertCotSnapshots(
  rows: Array<{
    reportDate: string;
    marketCode: string;
    netNonCommercial: number;
    netChangeWoW: number;
    raw: Record<string, unknown>;
  }>
) {
  if (rows.length === 0) return;
  const supabase = getSupabaseAdminClient();
  const payload = rows.map((row) => ({
    report_date: row.reportDate,
    market_code: row.marketCode,
    net_noncommercial: row.netNonCommercial,
    net_change_wow: row.netChangeWoW,
    raw: row.raw,
  }));

  const { error } = await supabase
    .from("cot_snapshots")
    .upsert(payload, { onConflict: "report_date,market_code", ignoreDuplicates: false });

  if (error) throw new Error(`cot_snapshots upsert failed: ${error.message}`);
}

export async function listEnabledRssSources() {
  return prisma.$queryRaw<Array<{ id: string; name: string; url: string; enabled: boolean }>>`
    select id::text as id, name, url, enabled
    from content_sources
    where enabled = true and type = 'rss'
    order by name asc
  `;
}

export async function listAllRssSources() {
  return prisma.$queryRaw<Array<{
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
  }>>`
    select
      id::text as id,
      name,
      url,
      enabled,
      created_at::text as created_at,
      updated_at::text as updated_at
    from content_sources
    where type = 'rss'
    order by enabled desc, name asc
  `;
}

export async function ensureDefaultRssSources() {
  const nowIso = new Date().toISOString();
  const allowedSourceUrls = new Set(DEFAULT_RSS_SOURCES.map((source) => source.url));
  const existingRows = await prisma.$queryRaw<Array<{ id: string; name: string; url: string; enabled: boolean }>>`
    select id::text as id, name, url, enabled
    from content_sources
    where type = 'rss'
  `;

  const existingByUrl = new Map<string, { id: string; name: string; url: string; enabled: boolean }>();
  for (const row of existingRows) {
    existingByUrl.set(row.url, row as { id: string; name: string; url: string; enabled: boolean });
  }

  let inserted = 0;
  let updated = 0;
  let disabled = 0;

  // Keep the active source set strict for predictable curation/review quality.
  for (const row of existingRows) {
    if (!row.enabled) continue;
    if (allowedSourceUrls.has(row.url)) continue;
    await prisma.$executeRaw`
      update content_sources
      set enabled = false, updated_at = ${nowIso}::timestamptz
      where id = ${row.id}::uuid
    `;
    disabled += 1;
  }

  for (const source of DEFAULT_RSS_SOURCES) {
    const existing = existingByUrl.get(source.url);

    if (!existing) {
      await prisma.$executeRaw`
        insert into content_sources (type, name, url, enabled, created_at, updated_at)
        values ('rss'::content_source_type, ${source.name}, ${source.url}, true, now(), now())
      `;
      inserted += 1;
      continue;
    }

    if (existing.name !== source.name || !existing.enabled) {
      await prisma.$executeRaw`
        update content_sources
        set name = ${source.name}, enabled = true, updated_at = ${nowIso}::timestamptz
        where id = ${existing.id}::uuid
      `;
      updated += 1;
    }
  }

  const enabledSources = await listEnabledRssSources();
  return {
    inserted,
    updated,
    disabled,
    enabledCount: enabledSources.length,
    enabledSources,
  };
}

export async function createOrGetPostQueue(args: {
  postType: PostQueueType;
  dedupeKey: string;
  scheduledAtIso: string;
  targetThreadsAccountId?: string | null;
  text: string;
  mediaUrl?: string | null;
  sources: SourceLink[];
  hideSources: boolean;
}) {
  const insertedRows = await prisma.$queryRaw<Array<PostQueueRow>>`
    insert into post_queue (
      platform,
      post_type,
      dedupe_key,
      target_threads_account_id,
      scheduled_at,
      status,
      text,
      media_url,
      sources,
      hide_sources
    ) values (
      'threads'::post_platform_type,
      ${args.postType}::post_type_type,
      ${args.dedupeKey},
      ${args.targetThreadsAccountId ?? null},
      ${args.scheduledAtIso}::timestamptz,
      'queued'::post_status_type,
      ${args.text},
      ${args.mediaUrl ?? null},
      ${JSON.stringify(args.sources)}::jsonb,
      ${args.hideSources}
    )
    on conflict (dedupe_key) do nothing
    returning
      id::text as id,
      platform::text as platform,
      post_type::text as post_type,
      dedupe_key,
      target_threads_account_id,
      scheduled_at::text as scheduled_at,
      status::text as status,
      text,
      media_url,
      sources,
      hide_sources,
      error,
      retries,
      posted_at::text as posted_at,
      created_at::text as created_at
  `;

  const inserted = insertedRows[0];
  if (inserted) {
    return { row: inserted, created: true };
  }

  const existing = await prisma.$queryRaw<Array<PostQueueRow>>`
    select
      id::text as id,
      platform::text as platform,
      post_type::text as post_type,
      dedupe_key,
      target_threads_account_id,
      scheduled_at::text as scheduled_at,
      status::text as status,
      text,
      media_url,
      sources,
      hide_sources,
      error,
      retries,
      posted_at::text as posted_at,
      created_at::text as created_at
    from post_queue
    where dedupe_key = ${args.dedupeKey}
    limit 1
  `;
  if (!existing[0]) throw new Error("post_queue dedupe read failed");
  return { row: existing[0], created: false };
}

export async function updatePostQueue(args: {
  id: string;
  status?: PostQueueStatus;
  error?: string | null;
  retriesDelta?: number;
  postedAt?: string | null;
  scheduledAt?: string | null;
}) {
  let nextRetries: number | null = null;
  if (args.retriesDelta && args.retriesDelta !== 0) {
    const existing = await prisma.$queryRaw<Array<{ retries: number }>>`
      select retries from post_queue where id = ${args.id}::uuid limit 1
    `;
    nextRetries = Number(existing[0]?.retries ?? 0) + args.retriesDelta;
  }

  const updates: Prisma.Sql[] = [];
  if (args.status) updates.push(Prisma.sql`status = ${args.status}::post_status_type`);
  if (args.error !== undefined) updates.push(Prisma.sql`error = ${args.error}`);
  if (args.postedAt !== undefined) {
    if (args.postedAt) {
      updates.push(Prisma.sql`posted_at = ${args.postedAt}::timestamptz`);
    } else {
      updates.push(Prisma.sql`posted_at = null`);
    }
  }
  if (args.scheduledAt !== undefined) {
    if (args.scheduledAt) {
      updates.push(Prisma.sql`scheduled_at = ${args.scheduledAt}::timestamptz`);
    } else {
      updates.push(Prisma.sql`scheduled_at = now()`);
    }
  }
  if (nextRetries !== null) updates.push(Prisma.sql`retries = ${nextRetries}`);
  if (updates.length === 0) return;

  await prisma.$executeRaw(
    Prisma.sql`update post_queue set ${Prisma.join(updates, ", ")} where id = ${args.id}::uuid`
  );
}

export async function insertPostLog(postId: string, step: string, message: string) {
  await prisma.$executeRaw`
    insert into post_logs (post_id, step, message)
    values (${postId}::uuid, ${step}, ${message})
  `;
}

export async function listRecentPostQueue(
  limit = 50,
  options?: {
    targetThreadsAccountIds?: string[];
  }
): Promise<PostQueueRow[]> {
  const hasTargetFilter = Array.isArray(options?.targetThreadsAccountIds);
  const targetThreadsAccountIds = Array.from(
    new Set((options?.targetThreadsAccountIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0))
  );
  if (hasTargetFilter && targetThreadsAccountIds.length === 0) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(limit, 200));
  if (hasTargetFilter) {
    return prisma.$queryRaw<Array<PostQueueRow>>`
      select
        id::text as id,
        platform::text as platform,
        post_type::text as post_type,
        dedupe_key,
        target_threads_account_id,
        scheduled_at::text as scheduled_at,
        status::text as status,
        text,
        media_url,
        sources,
        hide_sources,
        error,
        retries,
        posted_at::text as posted_at,
        created_at::text as created_at
      from post_queue
      where target_threads_account_id in (${Prisma.join(targetThreadsAccountIds)})
      order by created_at desc
      limit ${safeLimit}
    `;
  }

  return prisma.$queryRaw<Array<PostQueueRow>>`
    select
      id::text as id,
      platform::text as platform,
      post_type::text as post_type,
      dedupe_key,
      target_threads_account_id,
      scheduled_at::text as scheduled_at,
      status::text as status,
      text,
      media_url,
      sources,
      hide_sources,
      error,
      retries,
      posted_at::text as posted_at,
      created_at::text as created_at
    from post_queue
    order by created_at desc
    limit ${safeLimit}
  `;
}

export async function findPostQueueById(id: string): Promise<PostQueueRow | null> {
  const rows = await prisma.$queryRaw<Array<PostQueueRow>>`
    select
      id::text as id,
      platform::text as platform,
      post_type::text as post_type,
      dedupe_key,
      target_threads_account_id,
      scheduled_at::text as scheduled_at,
      status::text as status,
      text,
      media_url,
      sources,
      hide_sources,
      error,
      retries,
      posted_at::text as posted_at,
      created_at::text as created_at
    from post_queue
    where id = ${id}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listDueQueuedPostQueue(limit = 20): Promise<PostQueueRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  return prisma.$queryRaw<Array<PostQueueRow>>`
    select
      id::text as id,
      platform::text as platform,
      post_type::text as post_type,
      dedupe_key,
      target_threads_account_id,
      scheduled_at::text as scheduled_at,
      status::text as status,
      text,
      media_url,
      sources,
      hide_sources,
      error,
      retries,
      posted_at::text as posted_at,
      created_at::text as created_at
    from post_queue
    where status = 'queued'::post_status_type
      and post_type = 'rss_insight'::post_type_type
      and scheduled_at <= now()
      and scheduled_at > (created_at + interval '5 seconds')
    order by scheduled_at asc
    limit ${safeLimit}
  `;
}

export async function getLatestScheduledAtForTarget(targetThreadsAccountId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ scheduled_at: string | null }>>`
    select max(scheduled_at)::text as scheduled_at
    from post_queue
    where target_threads_account_id = ${targetThreadsAccountId}
      and status in ('queued'::post_status_type, 'posting'::post_status_type)
  `;
  return rows[0]?.scheduled_at ?? null;
}

export async function listRecentRssItems(limit = 30) {
  return prisma.$queryRaw<Array<{
    source_id: string;
    guid: string;
    title: string;
    link: string;
    published_at: string | null;
    raw: Record<string, unknown>;
  }>>`
    select
      source_id::text as source_id,
      guid,
      title,
      link,
      published_at::text as published_at,
      raw
    from rss_items
    order by published_at desc nulls last
    limit ${Math.max(1, Math.min(limit, 200))}
  `;
}

export async function upsertRssItems(
  sourceId: string,
  items: Array<{
    guid: string;
    title: string;
    link: string;
    publishedAt: string | null;
    raw: Record<string, unknown>;
  }>
) {
  if (items.length === 0) return;

  for (const item of items) {
    await prisma.$executeRaw`
      insert into rss_items (source_id, guid, title, link, published_at, raw)
      values (
        ${sourceId}::uuid,
        ${item.guid},
        ${item.title},
        ${item.link},
        nullif(${item.publishedAt ?? ""}, '')::timestamptz,
        ${JSON.stringify(item.raw)}::jsonb
      )
      on conflict (source_id, guid)
      do update set
        title = excluded.title,
        link = excluded.link,
        published_at = excluded.published_at,
        raw = excluded.raw
    `;
  }
}
