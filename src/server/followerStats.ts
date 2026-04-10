import { prisma } from "@/lib/prisma";

export type FollowerTrend = {
  currentFollowers: number | null;
  dailyDelta: number | null;
  weeklyDelta: number | null;
  weekStartDateKst: string | null;
  weekEndDateKst: string | null;
  latestDateKst: string | null;
  latestCapturedAt: string | null;
  daysTracked: number;
};

type SnapshotPoint = {
  dateKst: string;
  followerCount: number;
  capturedAt: Date;
};

function emptyFollowerTrend(): FollowerTrend {
  return {
    currentFollowers: null,
    dailyDelta: null,
    weeklyDelta: null,
    weekStartDateKst: null,
    weekEndDateKst: null,
    latestDateKst: null,
    latestCapturedAt: null,
    daysTracked: 0,
  };
}

function parseDateKey(key: string) {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getWeekRangeDateKeys(dateKey: string) {
  const base = parseDateKey(dateKey);
  if (!base) {
    return {
      weekStartDateKst: null,
      weekEndDateKst: null,
    };
  }

  const day = base.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const weekStart = new Date(base.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);

  return {
    weekStartDateKst: formatDateKey(weekStart),
    weekEndDateKst: formatDateKey(weekEnd),
  };
}

export function toKstDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function computeFollowerTrend(points: SnapshotPoint[]): FollowerTrend {
  if (!points.length) return emptyFollowerTrend();

  const ordered = [...points].sort((a, b) => {
    if (a.dateKst !== b.dateKst) return a.dateKst < b.dateKst ? -1 : 1;
    return a.capturedAt.getTime() - b.capturedAt.getTime();
  });

  const latest = ordered[ordered.length - 1];
  const prev = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const dailyDelta = prev ? latest.followerCount - prev.followerCount : null;

  const { weekStartDateKst, weekEndDateKst } = getWeekRangeDateKeys(latest.dateKst);
  const weeklyBase =
    (weekStartDateKst
      ? [...ordered].reverse().find((point) => point.dateKst <= weekStartDateKst) ??
        ordered.find((point) => point.dateKst >= weekStartDateKst && point.dateKst <= latest.dateKst)
      : null) ?? null;
  const weeklyDelta = weeklyBase ? latest.followerCount - weeklyBase.followerCount : null;

  return {
    currentFollowers: latest.followerCount,
    dailyDelta,
    weeklyDelta,
    weekStartDateKst,
    weekEndDateKst,
    latestDateKst: latest.dateKst,
    latestCapturedAt: latest.capturedAt.toISOString(),
    daysTracked: ordered.length,
  };
}

export async function upsertFollowerSnapshot(args: {
  userId: string;
  threadsAccountId: string;
  followerCount: number;
  capturedAt?: Date;
}) {
  const capturedAt = args.capturedAt ?? new Date();
  const dateKst = toKstDateKey(capturedAt);

  return prisma.threadsFollowerSnapshot.upsert({
    where: {
      threadsAccountId_dateKst: {
        threadsAccountId: args.threadsAccountId,
        dateKst,
      },
    },
    create: {
      userId: args.userId,
      threadsAccountId: args.threadsAccountId,
      dateKst,
      followerCount: Math.max(0, Math.trunc(args.followerCount)),
      capturedAt,
    },
    update: {
      followerCount: Math.max(0, Math.trunc(args.followerCount)),
      capturedAt,
    },
  });
}

export async function loadFollowerTrendsForAccounts(args: {
  userId: string;
  threadsAccountIds: string[];
}) {
  const accountIds = Array.from(new Set(args.threadsAccountIds.map((id) => id.trim()).filter((id) => id.length > 0)));
  const trends = new Map<string, FollowerTrend>();
  if (accountIds.length === 0) return trends;

  const snapshots = await prisma.threadsFollowerSnapshot.findMany({
    where: {
      userId: args.userId,
      threadsAccountId: { in: accountIds },
    },
    orderBy: [{ threadsAccountId: "asc" }, { dateKst: "asc" }],
    select: {
      threadsAccountId: true,
      dateKst: true,
      followerCount: true,
      capturedAt: true,
    },
  });

  const grouped = new Map<string, SnapshotPoint[]>();
  for (const row of snapshots) {
    const list = grouped.get(row.threadsAccountId) ?? [];
    list.push({
      dateKst: row.dateKst,
      followerCount: row.followerCount,
      capturedAt: row.capturedAt,
    });
    grouped.set(row.threadsAccountId, list);
  }

  for (const accountId of accountIds) {
    trends.set(accountId, computeFollowerTrend(grouped.get(accountId) ?? []));
  }

  return trends;
}

export async function loadFollowerTrendForAccount(args: {
  userId: string;
  threadsAccountId: string;
}) {
  const map = await loadFollowerTrendsForAccounts({
    userId: args.userId,
    threadsAccountIds: [args.threadsAccountId],
  });
  return map.get(args.threadsAccountId) ?? emptyFollowerTrend();
}
