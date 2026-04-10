import { nowKst, toKstDateKey } from "@/lib/market/time";
import {
  createOrGetPostQueue,
  ensureDefaultRssSources,
  findPostQueueById,
  getLatestScheduledAtForTarget,
  getEnabledMarketInstruments,
  insertMarketChart,
  insertPostLog,
  listDueQueuedPostQueue,
  listEnabledRssSources,
  listRecentPostQueue,
  listRecentRssItems,
  type PostQueueRow,
  updatePostQueue,
  upsertCotSnapshots,
  upsertEconomicEvents,
  upsertMarketSnapshots,
} from "@/lib/market/repository";
import { prisma } from "@/lib/prisma";
import { fetchSnapshot, fetchHistorical, tradingEconomicsSourceUrl } from "@/lib/market/tradingEconomics";
import { fetchTodayTopEvents } from "@/lib/market/calendar";
import { fetchLatestCotSnapshots, cftcSourceUrl } from "@/lib/market/cftc";
import { syncRssSource } from "@/lib/market/rss";
import { fetchFreeSnapshot, yahooSourceUrl } from "@/lib/market/freeMarket";
import { buildDailyCalendarCopy, buildDailySnapshotCopy, buildRssInsightCopy, buildWeeklyCotCopy } from "@/lib/market/copy";
import { renderDailySnapshot4Pack, uploadChartImage } from "@/lib/market/chartRenderer";
import { getSupabaseAdminClient } from "@/server/supabaseAdmin";
import { isThreadsPostingAvailable, publishToThreads } from "@/lib/platforms/threads";
import { optionalEnv } from "@/server/env";
import { isTelegramAlertEnabled, sendTelegramAlert } from "@/server/telegram";
import type { SourceLink } from "@/lib/market/types";

function errToString(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function resolveIncludeSources(flag?: boolean) {
  if (typeof flag === "boolean") return flag;
  return process.env.DEFAULT_INCLUDE_SOURCES !== "0";
}

function isTradingEconomicsEnabled() {
  return Boolean(optionalEnv("TE_API_KEY"));
}

function buildMockSnapshotPanels() {
  return [
    { label: "S&P 500", current: 5342.2, dailyPct: 0.62, series: [5250, 5271, 5290, 5311, 5302, 5330, 5342.2] },
    { label: "DXY", current: 104.18, dailyPct: -0.28, series: [104.9, 104.8, 104.6, 104.4, 104.5, 104.3, 104.18] },
    { label: "WTI", current: 77.45, dailyPct: 1.32, series: [74.2, 74.9, 75.8, 76.4, 76.1, 76.9, 77.45] },
    { label: "Gold", current: 2412.8, dailyPct: 0.41, series: [2361, 2375, 2388, 2397, 2401, 2408, 2412.8] },
  ];
}

async function tryPostQueueItem(
  row: PostQueueRow,
  options?: {
    userId?: string;
    overrideThreadsAccountId?: string;
  }
) {
  const targetThreadsAccountId = options?.overrideThreadsAccountId?.trim() || row.target_threads_account_id?.trim() || undefined;
  if (row.post_type === "rss_insight" && !targetThreadsAccountId) {
    await insertPostLog(row.id, "posting_skipped", "타겟 Threads 계정이 없어 발행을 건너뜁니다.");
    return { posted: false as const, skipped: true as const, reason: "missing_target_threads_account" };
  }

  const canPost = await isThreadsPostingAvailable({
    userId: options?.userId,
    threadsAccountId: targetThreadsAccountId,
  });
  if (!canPost) {
    await insertPostLog(row.id, "posting", "Threads 계정이 없어 posting 스킵(queued 유지)");
    return { posted: false as const, skipped: true as const };
  }

  await updatePostQueue({ id: row.id, status: "posting", error: null });
  await insertPostLog(row.id, "posting", "Threads 발행 시작");

  try {
    const result = await publishToThreads({
      text: row.text,
      mediaUrl: row.media_url,
      userId: options?.userId,
      threadsAccountId: targetThreadsAccountId,
    });

    if (!result.posted) {
      await updatePostQueue({ id: row.id, status: "queued", error: result.reason ?? "Posting skipped" });
      await insertPostLog(row.id, "posting_skipped", result.reason ?? "Posting skipped");
      return { posted: false as const, skipped: true as const };
    }

    await updatePostQueue({ id: row.id, status: "posted", postedAt: new Date().toISOString(), error: null });
    await insertPostLog(row.id, "posted", `Threads 게시 완료: ${result.postId}`);
    return { posted: true as const, skipped: false as const, postId: result.postId };
  } catch (err) {
    const msg = errToString(err);
    const nextRetries = row.retries + 1;
    const nextStatus = nextRetries >= 3 ? "failed" : "queued";
    await updatePostQueue({ id: row.id, status: nextStatus, error: msg, retriesDelta: 1 });
    await insertPostLog(row.id, "posting_failed", `retries=${nextRetries} ${msg}`);
    return { posted: false as const, skipped: false as const, error: msg };
  }
}

async function finalizeQueue(args: {
  dedupeKey: string;
  postType: "daily_snapshot" | "daily_calendar" | "weekly_cot" | "rss_insight";
  text: string;
  mediaUrl?: string;
  targetThreadsAccountId?: string | null;
  sources: SourceLink[];
  includeSources: boolean;
  scheduledAt?: string;
  autoPost?: boolean;
}) {
  const created = await createOrGetPostQueue({
    postType: args.postType,
    dedupeKey: args.dedupeKey,
    scheduledAtIso: args.scheduledAt ?? new Date().toISOString(),
    targetThreadsAccountId: args.targetThreadsAccountId,
    text: args.text,
    mediaUrl: args.mediaUrl,
    sources: args.sources,
    hideSources: !args.includeSources,
  });

  if (created.created) {
    await insertPostLog(created.row.id, "queued", `생성 완료 (${args.postType})`);
  } else {
    await insertPostLog(created.row.id, "dedupe", `중복 감지: ${args.dedupeKey}`);
  }

  const shouldAutoPost = args.autoPost ?? true;
  if (shouldAutoPost && created.row.status === "queued") {
    await tryPostQueueItem(created.row);
  }

  return created;
}

async function notifyRssDraftReady(args: {
  targetAccountLabel: string;
  sourceName: string;
  topicTitle: string;
  link: string;
  queueId: string;
}) {
  if (!isTelegramAlertEnabled()) return;

  const appBaseUrl = optionalEnv("APP_BASE_URL")?.replace(/\/+$/, "") || "";
  const reviewUrl = appBaseUrl ? `${appBaseUrl}/tools` : "/tools";
  await sendTelegramAlert(
    [
      "SBUSIM RSS 초안 도착",
      `대상 계정: ${args.targetAccountLabel}`,
      `소스: ${args.sourceName}`,
      `제목: ${args.topicTitle}`,
      `원문: ${args.link}`,
      `큐ID: ${args.queueId}`,
      `검수/발행: ${reviewUrl}`,
    ].join("\n")
  ).catch(() => {});
}

export async function renderDailySnapshotPreview(options?: { mockIfTeDisabled?: boolean }) {
  const asofDate = toKstDateKey(nowKst());
  const teEnabled = isTradingEconomicsEnabled();
  const panels = [] as Array<{ label: string; current: number; dailyPct: number; series: number[] }>;

  if (!teEnabled) {
    const instruments = await getEnabledMarketInstruments();
    const selected = instruments.slice(0, 4);
    if (selected.length >= 4) {
      const free = await fetchFreeSnapshot(selected, 7);
      for (const item of free) {
        panels.push({
          label: item.label,
          current: item.last,
          dailyPct: item.dailyPct,
          series: item.series,
        });
      }
    } else if (options?.mockIfTeDisabled) {
      panels.push(...buildMockSnapshotPanels());
    } else {
      throw new Error("market_instruments 활성 항목이 4개 이상 필요합니다.");
    }
  } else {
    const instruments = await getEnabledMarketInstruments();
    const selected = instruments.slice(0, 4);
    if (selected.length < 4) {
      throw new Error("market_instruments 활성 항목이 4개 이상 필요합니다.");
    }

    const snapshot = await fetchSnapshot(selected);
    for (const item of snapshot.slice(0, 4)) {
      const historical = await fetchHistorical(item.symbol, 7).catch(() => []);
      panels.push({
        label: item.label,
        current: item.last,
        dailyPct: item.dailyPct,
        series: historical.map((p) => p.close).filter((n) => Number.isFinite(n)),
      });
    }

    while (panels.length < 4) {
      panels.push({ label: `Panel ${panels.length + 1}`, current: 0, dailyPct: 0, series: [0, 0, 0, 0, 0, 0, 0] });
    }
  }

  const buffer = renderDailySnapshot4Pack(
    panels.map((p) => ({
      ...p,
      series: p.series.length >= 2 ? p.series : [p.current, p.current],
    })),
    asofDate
  );

  const supabase = getSupabaseAdminClient();
  const uploaded = await uploadChartImage({
    supabase,
    asofDate,
    chartKind: "daily_snapshot_4pack",
    buffer,
  });

  return {
    asofDate,
    chartUrl: uploaded.url,
    chartPath: uploaded.path,
    panels,
  };
}

export async function runDailySnapshotJob(options?: { includeSources?: boolean }) {
  const includeSources = resolveIncludeSources(options?.includeSources);
  const preview = await renderDailySnapshotPreview();
  const teEnabled = isTradingEconomicsEnabled();

  const instruments = await getEnabledMarketInstruments();
  const snapshot = teEnabled ? await fetchSnapshot(instruments) : await fetchFreeSnapshot(instruments, 7);
  await upsertMarketSnapshots(
    preview.asofDate,
    snapshot.map((s) => ({
      instrumentId: s.instrumentId,
      last: s.last,
      dailyPct: s.dailyPct,
      raw: s.raw,
    }))
  );

  await insertMarketChart({
    asofDate: preview.asofDate,
    chartKind: "daily_snapshot_4pack",
    imageUrl: preview.chartUrl,
    meta: {
      panels: preview.panels,
      chartPath: preview.chartPath,
    },
  });

  const sources: SourceLink[] = teEnabled
    ? [
        { name: "Trading Economics Markets Snapshot", url: tradingEconomicsSourceUrl("snapshot") },
        { name: "Trading Economics Markets Historical", url: tradingEconomicsSourceUrl("historical") },
      ]
    : Array.from(new Set(snapshot.map((s) => s.symbol).filter(Boolean)))
        .slice(0, 4)
        .map((symbol) => ({ name: `Yahoo Finance ${symbol}`, url: yahooSourceUrl(symbol) }));

  const text = await buildDailySnapshotCopy({
    asofDate: preview.asofDate,
    items: preview.panels.map((p) => ({ label: p.label, last: p.current, dailyPct: p.dailyPct })),
    sources,
    includeSources,
  });

  const dedupeKey = `daily_snapshot:${preview.asofDate}`;
  return finalizeQueue({
    dedupeKey,
    postType: "daily_snapshot",
    text,
    mediaUrl: preview.chartUrl,
    sources,
    includeSources,
  });
}

export async function runDailyCalendarJob(options?: { includeSources?: boolean }) {
  if (!isTradingEconomicsEnabled()) {
    return {
      skipped: true,
      reason: "Trading Economics 미사용 설정(TE_API_KEY 없음)으로 daily-calendar를 건너뜁니다.",
    };
  }

  const includeSources = resolveIncludeSources(options?.includeSources);
  const today = nowKst();
  const asofDate = toKstDateKey(today);

  const events = await fetchTodayTopEvents(today, 3, 5);
  await upsertEconomicEvents(events);

  const formatted = events.map((event) => ({
    timeKst: event.eventTimeIso
      ? new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul", hour12: false }).format(
          new Date(event.eventTimeIso)
        )
      : "시간미정",
    country: event.country,
    event: event.event,
    importance: event.importance,
  }));

  const sources: SourceLink[] = [{ name: "Trading Economics Calendar", url: tradingEconomicsSourceUrl("calendar") }];
  const text = await buildDailyCalendarCopy({
    asofDate,
    topEvents: formatted,
    sources,
    includeSources,
  });

  const dedupeKey = `daily_calendar:${asofDate}`;
  return finalizeQueue({
    dedupeKey,
    postType: "daily_calendar",
    text,
    sources,
    includeSources,
  });
}

export async function runWeeklyCotJob(options?: { includeSources?: boolean }) {
  const includeSources = resolveIncludeSources(options?.includeSources);
  const snapshots = await fetchLatestCotSnapshots();
  if (snapshots.length === 0) throw new Error("COT 데이터가 비어 있습니다.");

  await upsertCotSnapshots(snapshots);

  const latestDate = snapshots
    .map((s) => s.reportDate)
    .sort((a, b) => (a < b ? 1 : -1))[0];

  const topMoves = snapshots
    .filter((s) => s.reportDate === latestDate)
    .sort((a, b) => Math.abs(b.netChangeWoW) - Math.abs(a.netChangeWoW))
    .slice(0, 3)
    .map((s) => ({
      marketCode: s.marketCode,
      net: s.netNonCommercial,
      wow: s.netChangeWoW,
    }));

  const sources: SourceLink[] = [{ name: "CFTC Public Reporting", url: cftcSourceUrl() }];
  const text = await buildWeeklyCotCopy({
    reportDate: latestDate,
    topMoves,
    sources,
    includeSources,
  });

  const dedupeKey = `weekly_cot:${latestDate}`;
  return finalizeQueue({
    dedupeKey,
    postType: "weekly_cot",
    text,
    sources,
    includeSources,
  });
}

function makeRssSummaryFromTitle(title: string) {
  const compact = title.replace(/\s+/g, " ").trim();
  if (!compact) return "핵심 뉴스 업데이트입니다.";
  return [
    `핵심 이슈: ${compact}`,
    "시장에 영향을 줄 수 있는 맥락을 체크하고 리스크를 관리하세요.",
    "세부 수치는 원문 링크에서 확인하는 것이 안전합니다.",
  ].join("\n\n");
}

function parseKeywordCsv(input?: string | null) {
  if (!input) return [] as string[];
  const tokens = input
    .split(/[\n,;]+/g)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  return Array.from(new Set(tokens));
}

function stringifyRssRaw(raw: Record<string, unknown>) {
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

function matchesKeywordSet(args: {
  title: string;
  link: string;
  raw: Record<string, unknown>;
  includeKeywords: string[];
  excludeKeywords: string[];
}) {
  const haystack = `${args.title}\n${args.link}\n${stringifyRssRaw(args.raw)}`.toLowerCase();
  const matchedExclude = args.excludeKeywords.find((keyword) => haystack.includes(keyword));
  if (matchedExclude) {
    return { ok: false as const, reason: `excluded:${matchedExclude}` };
  }

  if (args.includeKeywords.length === 0) {
    return { ok: true as const, reason: "no_include_filter" };
  }

  const matchedInclude = args.includeKeywords.find((keyword) => haystack.includes(keyword));
  if (!matchedInclude) {
    return { ok: false as const, reason: "include_not_matched" };
  }
  return { ok: true as const, reason: `included:${matchedInclude}` };
}

function normalizeIntervalRange(min?: number, max?: number) {
  const minClamped = Number.isFinite(min) ? Math.max(1, Math.min(Math.trunc(min as number), 24 * 60)) : 60;
  const maxClamped = Number.isFinite(max) ? Math.max(1, Math.min(Math.trunc(max as number), 24 * 60)) : 90;
  const from = Math.min(minClamped, maxClamped);
  const to = Math.max(minClamped, maxClamped);
  return { min: from, max: to };
}

function randomIntInclusive(min: number, max: number) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export async function runRssInsightJob(options?: {
  includeSources?: boolean;
  autoPost?: boolean;
  autoPostMinIntervalMinutes?: number;
  autoPostMaxIntervalMinutes?: number;
  maxCreateCount?: number;
  targetThreadsAccountId?: string;
  targetAccountLabel?: string;
  keywordIncludeCsv?: string | null;
  keywordExcludeCsv?: string | null;
  promptTemplate?: string | null;
  forceRegenerate?: boolean;
  requireTargetAccount?: boolean;
}) {
  const includeSources = resolveIncludeSources(options?.includeSources);
  const autoPost = options?.autoPost ?? false;
  const intervalRange = normalizeIntervalRange(options?.autoPostMinIntervalMinutes, options?.autoPostMaxIntervalMinutes);
  const forceRegenerate = options?.forceRegenerate ?? false;
  const maxCreateCount = Math.max(1, Math.min(options?.maxCreateCount ?? 1, 20));
  const targetThreadsAccountId = options?.targetThreadsAccountId?.trim() || null;
  if (options?.requireTargetAccount && !targetThreadsAccountId) {
    throw new Error("targetThreadsAccountId is required");
  }
  const targetAccountLabel = options?.targetAccountLabel?.trim() || targetThreadsAccountId || "미지정";
  const includeKeywords = parseKeywordCsv(options?.keywordIncludeCsv);
  const excludeKeywords = parseKeywordCsv(options?.keywordExcludeCsv);
  const autoPostBySchedule = autoPost && Boolean(targetThreadsAccountId);
  let autoPostCursor: Date | null = null;
  if (autoPostBySchedule && targetThreadsAccountId) {
    const latestScheduledAt = await getLatestScheduledAtForTarget(targetThreadsAccountId);
    const now = new Date();
    if (latestScheduledAt) {
      const parsed = new Date(latestScheduledAt);
      autoPostCursor = Number.isNaN(parsed.getTime()) ? now : parsed;
    } else {
      autoPostCursor = now;
    }
    if (autoPostCursor.getTime() < now.getTime()) autoPostCursor = now;
  }

  const seedResult = await ensureDefaultRssSources();
  const sources = await listEnabledRssSources();

  if (sources.length === 0) throw new Error("활성화된 RSS 소스가 없습니다.");

  const syncWarnings: string[] = [];
  let syncedSourceCount = 0;
  for (const source of sources) {
    try {
      await syncRssSource(source, 30);
      syncedSourceCount += 1;
    } catch (err) {
      syncWarnings.push(`${source.name}: ${errToString(err)}`);
    }
  }

  if (syncedSourceCount === 0) {
    throw new Error(`모든 RSS 소스 동기화 실패: ${syncWarnings.join(" | ")}`);
  }

  const items = await listRecentRssItems(100);
  if (items.length === 0) throw new Error("RSS 아이템이 없습니다.");

  const candidates = items
    .filter((item) => item.title && item.link)
    .sort((a, b) => {
      if (!a.published_at || !b.published_at) return 0;
      return a.published_at < b.published_at ? 1 : -1;
    });

  if (candidates.length === 0) {
    return {
      createdCount: 0,
      createdRows: [],
      syncedSourceCount,
      sourceCount: sources.length,
      syncWarnings,
      seedResult,
      autoPost,
      targetThreadsAccountId,
      targetAccountLabel,
      keywordFilter: {
        include: includeKeywords,
        exclude: excludeKeywords,
        matchedCount: 0,
      },
      skippedReason: "no_candidates",
    };
  }

  const filteredCandidates = candidates.filter((candidate) =>
    matchesKeywordSet({
      title: candidate.title,
      link: candidate.link,
      raw: candidate.raw,
      includeKeywords,
      excludeKeywords,
    }).ok
  );

  const createdRows: Array<{
    queueId: string;
    dedupeKey: string;
    targetThreadsAccountId: string | null;
    title: string;
    link: string;
    sourceName: string;
    publishedAt: string | null;
  }> = [];
  let dedupedCount = 0;

  for (const candidate of filteredCandidates) {
    if (createdRows.length >= maxCreateCount) break;

    const source = sources.find((s) => s.id === candidate.source_id);
    const dedupeTarget = targetThreadsAccountId ?? "global";
    const baseDedupeKey = `rss_insight:${dedupeTarget}:${candidate.source_id}:${candidate.guid}`;
    const dedupeKey = forceRegenerate
      ? `${baseDedupeKey}:manual:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
      : baseDedupeKey;
    const sourceName = source?.name ?? "RSS";
    const sourceLinks: SourceLink[] = [
      { name: sourceName, url: source?.url ?? candidate.link },
      { name: "원문", url: candidate.link },
    ];

    const text = await buildRssInsightCopy({
      topicTitle: candidate.title,
      summary: makeRssSummaryFromTitle(candidate.title),
      link: candidate.link,
      sourceName,
      sources: sourceLinks,
      includeSources,
      promptTemplate: options?.promptTemplate,
    });

    let scheduledAt: string | undefined;
    if (autoPostBySchedule && autoPostCursor) {
      const stepMinutes = randomIntInclusive(intervalRange.min, intervalRange.max);
      autoPostCursor = new Date(autoPostCursor.getTime() + stepMinutes * 60 * 1000);
      scheduledAt = autoPostCursor.toISOString();
    }

    const queued = await finalizeQueue({
      dedupeKey,
      postType: "rss_insight",
      targetThreadsAccountId,
      scheduledAt,
      text,
      sources: sourceLinks,
      includeSources,
      autoPost: autoPost && !autoPostBySchedule,
    });
    if (!queued.created) {
      dedupedCount += 1;
      continue;
    }

    createdRows.push({
      queueId: queued.row.id,
      dedupeKey,
      targetThreadsAccountId,
      title: candidate.title,
      link: candidate.link,
      sourceName,
      publishedAt: candidate.published_at,
    });

    if (syncWarnings.length > 0) {
      await insertPostLog(queued.row.id, "rss_source_warning", syncWarnings.join(" | ").slice(0, 1900));
    }
    if (seedResult.inserted || seedResult.updated || seedResult.disabled) {
      await insertPostLog(
        queued.row.id,
        "rss_source_seed",
        `inserted=${seedResult.inserted} updated=${seedResult.updated} disabled=${seedResult.disabled}`
      );
    }
    await notifyRssDraftReady({
      targetAccountLabel,
      sourceName,
      topicTitle: candidate.title,
      link: candidate.link,
      queueId: queued.row.id,
    });
  }

  return {
    createdCount: createdRows.length,
    createdRows,
    syncedSourceCount,
    sourceCount: sources.length,
    forceRegenerate,
    syncWarnings,
    seedResult,
    autoPost,
    autoPostScheduleMode: autoPostBySchedule ? "random_interval" : autoPost ? "immediate" : "off",
    autoPostInterval: intervalRange,
    targetThreadsAccountId,
    targetAccountLabel,
    keywordFilter: {
      include: includeKeywords,
      exclude: excludeKeywords,
      matchedCount: filteredCandidates.length,
    },
    dedupedCount,
    filteredCandidateCount: filteredCandidates.length,
    skippedReason:
      createdRows.length > 0
        ? undefined
        : filteredCandidates.length === 0
          ? "keyword_not_matched"
          : dedupedCount > 0
            ? "deduped_existing"
            : "no_creatable_row",
  };
}

export async function getRecentQueue(
  limit = 50,
  options?: {
    targetThreadsAccountIds?: string[];
  }
) {
  return listRecentPostQueue(limit, {
    targetThreadsAccountIds: options?.targetThreadsAccountIds,
  });
}

export async function postQueueById(
  postId: string,
  options?: {
    userId?: string;
    overrideThreadsAccountId?: string;
  }
) {
  const row = await findPostQueueById(postId);
  if (!row) throw new Error("post_queue item not found");

  const targetThreadsAccountId =
    options?.overrideThreadsAccountId?.trim() || row.target_threads_account_id?.trim() || undefined;
  if (options?.userId) {
    if (!targetThreadsAccountId) {
      throw new Error("대상 Threads 계정을 지정해야 발행할 수 있습니다.");
    }
    if (row.target_threads_account_id && row.target_threads_account_id !== targetThreadsAccountId) {
      throw new Error("이 RSS 큐는 생성된 대상 계정으로만 발행할 수 있습니다.");
    }

    const allowed = await prisma.threadsAccount.findFirst({
      where: { id: targetThreadsAccountId, userId: options.userId },
      select: { id: true },
    });
    if (!allowed) {
      throw new Error("선택한 계정에 대한 발행 권한이 없습니다.");
    }
  }

  return tryPostQueueItem(row, {
    userId: options?.userId,
    overrideThreadsAccountId: targetThreadsAccountId,
  });
}

export async function schedulePostQueueById(
  postId: string,
  args: {
    scheduledAtIso: string;
    userId?: string;
    overrideThreadsAccountId?: string;
  }
) {
  const row = await findPostQueueById(postId);
  if (!row) throw new Error("post_queue item not found");
  if (row.status === "posted") throw new Error("이미 발행 완료된 글은 다시 예약할 수 없습니다.");

  const targetThreadsAccountId =
    args.overrideThreadsAccountId?.trim() || row.target_threads_account_id?.trim() || undefined;
  if (args.userId) {
    if (!targetThreadsAccountId) {
      throw new Error("대상 Threads 계정을 지정해야 예약할 수 있습니다.");
    }
    if (row.target_threads_account_id && row.target_threads_account_id !== targetThreadsAccountId) {
      throw new Error("이 RSS 큐는 생성된 대상 계정으로만 예약할 수 있습니다.");
    }

    const allowed = await prisma.threadsAccount.findFirst({
      where: { id: targetThreadsAccountId, userId: args.userId },
      select: { id: true },
    });
    if (!allowed) {
      throw new Error("선택한 계정에 대한 예약 권한이 없습니다.");
    }
  }

  const scheduledAt = new Date(args.scheduledAtIso);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("예약 시간이 올바르지 않습니다.");
  }
  const now = new Date();
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new Error("예약 시간은 현재 시각 이후여야 합니다.");
  }

  await updatePostQueue({
    id: row.id,
    status: "queued",
    error: null,
    scheduledAt: scheduledAt.toISOString(),
  });
  await insertPostLog(row.id, "scheduled", `예약 갱신: ${scheduledAt.toISOString()}`);

  const updated = await findPostQueueById(row.id);
  return {
    row: updated ?? row,
    scheduledAt: scheduledAt.toISOString(),
  };
}

export async function processDuePostQueue(limit = 20) {
  const rows = await listDueQueuedPostQueue(Math.max(1, Math.min(limit, 200)));
  let postedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    try {
      const result = await tryPostQueueItem(row, {
        overrideThreadsAccountId: row.target_threads_account_id?.trim() || undefined,
      });
      if (result.posted) postedCount += 1;
      else if (result.skipped) skippedCount += 1;
      else failedCount += 1;
    } catch (err) {
      const msg = errToString(err);
      failedCount += 1;
      await updatePostQueue({
        id: row.id,
        status: "failed",
        error: msg,
        retriesDelta: 1,
      });
      await insertPostLog(row.id, "dispatch_failed", msg.slice(0, 1900));
    }
  }

  return {
    dueCount: rows.length,
    postedCount,
    skippedCount,
    failedCount,
    processedIds: rows.map((row) => row.id),
  };
}

export async function runAllForDebug(options?: { includeSources?: boolean }) {
  const includeSources = resolveIncludeSources(options?.includeSources);
  const result = {
    dailySnapshot: await runDailySnapshotJob({ includeSources }),
    dailyCalendar: await runDailyCalendarJob({ includeSources }),
    weeklyCot: await runWeeklyCotJob({ includeSources }),
    rssInsight: await runRssInsightJob({ includeSources }),
  };
  return result;
}
