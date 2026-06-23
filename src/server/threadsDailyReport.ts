import { ScheduledPostStatus } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { ensureValidAccessToken } from "@/server/threadsToken";
import { listUserThreadsPosts } from "@/server/threadsApi";

export type ThreadsDailyReportAccount = {
  id: string;
  name: string;
};

export type ThreadsDailyReportItem = {
  accountId: string;
  source: "scheduled" | "direct" | "collection_error";
  sourceLabel: string;
  text: string;
  occurredAt: Date;
  remotePostId?: string | null;
  status?: ScheduledPostStatus | string | null;
};

export type ThreadsDailyReportAccountRows = {
  account: ThreadsDailyReportAccount;
  items: ThreadsDailyReportItem[];
};

export type ThreadsDailyReportError = {
  accountId: string;
  accountName: string;
  message: string;
};

type ThreadsAccountForReport = {
  id: string;
  label: string | null;
  threadsUserId: string | null;
  threadsUsername: string | null;
  accessTokenEncrypted: string;
  proxyUrlEncrypted: string | null;
  tokenExpiresAt: Date;
};

function accountDisplayName(account: {
  id: string;
  label?: string | null;
  threadsUsername?: string | null;
  threadsUserId?: string | null;
}) {
  return account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function getDateKeyInKst(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function getKstDateRange(dateKst?: string) {
  const normalized = dateKst?.trim() || getDateKeyInKst(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("date는 YYYY-MM-DD 형식이어야 합니다.");
  }

  const start = new Date(`${normalized}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("date를 해석하지 못했습니다.");
  }

  return {
    dateKst: normalized,
    start,
    end: addDays(start, 1),
  };
}

function isInRange(date: Date, range: { start: Date; end: Date }) {
  return date >= range.start && date < range.end;
}

function formatKstTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function sourceLabelForScheduledStatus(status: ScheduledPostStatus) {
  if (status === ScheduledPostStatus.SUCCESS) return "발행완료";
  if (status === ScheduledPostStatus.FAILED) return "실패";
  if (status === ScheduledPostStatus.PARTIAL_FAILED) return "부분실패";
  if (status === ScheduledPostStatus.RUNNING) return "진행";
  return "예약";
}

export function formatReportCell(item: ThreadsDailyReportItem) {
  const text = cleanText(item.text) || "(본문 없음)";
  return `${formatKstTime(item.occurredAt)} [${item.sourceLabel}] ${text}`;
}

function itemPriority(item: ThreadsDailyReportItem) {
  if (item.source === "scheduled") return 2;
  if (item.source === "collection_error") return 0;
  return 1;
}

export function mergeAccountReportItems(items: ThreadsDailyReportItem[]) {
  const result: ThreadsDailyReportItem[] = [];
  const remoteIndex = new Map<string, number>();

  for (const item of items) {
    if (!item.remotePostId) {
      result.push(item);
      continue;
    }

    const existingIndex = remoteIndex.get(item.remotePostId);
    if (existingIndex === undefined) {
      remoteIndex.set(item.remotePostId, result.length);
      result.push(item);
      continue;
    }

    if (itemPriority(item) > itemPriority(result[existingIndex])) {
      result[existingIndex] = item;
    }
  }

  return result.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

export function buildThreadsDailyReportRows(accountRows: ThreadsDailyReportAccountRows[]) {
  return accountRows.map((row) => [
    row.account.name,
    ...mergeAccountReportItems(row.items).map((item) => formatReportCell(item)),
  ]);
}

function scheduledPostToReportItem(post: {
  id: string;
  threadsAccountId: string;
  text: string;
  status: ScheduledPostStatus;
  remotePostId: string | null;
  scheduledAt: Date;
  publishedAt: Date | null;
  lastError: string | null;
}) {
  const sourceLabel = sourceLabelForScheduledStatus(post.status);
  const occurredAt = post.publishedAt ?? post.scheduledAt;
  const errorSuffix = post.lastError && post.status !== ScheduledPostStatus.PENDING ? ` / ${post.lastError}` : "";

  return {
    accountId: post.threadsAccountId,
    source: "scheduled" as const,
    sourceLabel,
    text: `${post.text}${errorSuffix}`,
    occurredAt,
    remotePostId: post.remotePostId,
    status: post.status,
  };
}

async function collectDirectItemsForAccount(args: {
  account: ThreadsAccountForReport;
  range: { start: Date; end: Date };
}) {
  const accountName = accountDisplayName(args.account);
  if (!args.account.threadsUserId) {
    return {
      items: [] as ThreadsDailyReportItem[],
      error: {
        accountId: args.account.id,
        accountName,
        message: "Threads user id가 없어 직접 게시글을 수집하지 못했습니다.",
      } satisfies ThreadsDailyReportError,
    };
  }

  try {
    const { accessToken, proxyUrl } = await ensureValidAccessToken(args.account);
    const posts = await listUserThreadsPosts({
      accessToken,
      threadsUserId: args.account.threadsUserId,
      proxyUrl,
      since: args.range.start,
      until: args.range.end,
      limit: 100,
      maxPages: 10,
    });

    const items: ThreadsDailyReportItem[] = [];
    for (const post of posts) {
      const occurredAt = post.timestamp ? new Date(post.timestamp) : null;
      if (!occurredAt || Number.isNaN(occurredAt.getTime()) || !isInRange(occurredAt, args.range)) continue;
      items.push({
        accountId: args.account.id,
        source: "direct",
        sourceLabel: "직접",
        text: post.text ?? post.permalink ?? post.mediaType ?? "(본문 없음)",
        occurredAt,
        remotePostId: post.id,
        status: null,
      });
    }

    return {
      items,
      error: null,
    };
  } catch (err) {
    return {
      items: [] as ThreadsDailyReportItem[],
      error: {
        accountId: args.account.id,
        accountName,
        message: err instanceof Error ? err.message : String(err),
      } satisfies ThreadsDailyReportError,
    };
  }
}

export async function buildThreadsDailyReport(args: {
  userId: string;
  dateKst?: string;
}) {
  const range = getKstDateRange(args.dateKst);
  const accounts = await prisma.threadsAccount.findMany({
    where: { userId: args.userId },
    orderBy: [{ label: "asc" }, { threadsUsername: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      label: true,
      threadsUserId: true,
      threadsUsername: true,
      accessTokenEncrypted: true,
      proxyUrlEncrypted: true,
      tokenExpiresAt: true,
    },
  });

  const scheduledPosts = await prisma.scheduledPost.findMany({
    where: {
      userId: args.userId,
      OR: [
        { scheduledAt: { gte: range.start, lt: range.end } },
        { publishedAt: { gte: range.start, lt: range.end } },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      threadsAccountId: true,
      text: true,
      status: true,
      remotePostId: true,
      scheduledAt: true,
      publishedAt: true,
      lastError: true,
    },
  });

  const itemsByAccount = new Map<string, ThreadsDailyReportItem[]>();
  for (const post of scheduledPosts) {
    const item = scheduledPostToReportItem(post);
    const current = itemsByAccount.get(item.accountId) ?? [];
    current.push(item);
    itemsByAccount.set(item.accountId, current);
  }

  const errors: ThreadsDailyReportError[] = [];
  for (const account of accounts) {
    const collected = await collectDirectItemsForAccount({ account, range });
    if (collected.error) errors.push(collected.error);
    if (collected.items.length === 0) continue;
    const current = itemsByAccount.get(account.id) ?? [];
    current.push(...collected.items);
    itemsByAccount.set(account.id, current);
  }

  const accountRows = accounts.map((account) => ({
    account: {
      id: account.id,
      name: accountDisplayName(account),
    },
    items: itemsByAccount.get(account.id) ?? [],
  }));

  return {
    dateKst: range.dateKst,
    accountRows,
    errors,
    rows: buildThreadsDailyReportRows(accountRows),
  };
}

export function createThreadsDailyReportWorkbookBuffer(args: {
  dateKst: string;
  rows: string[][];
  errors: ThreadsDailyReportError[];
}) {
  const workbook = XLSX.utils.book_new();
  const rows = args.rows.length > 0 ? args.rows : [["계정 없음"]];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const maxPostCount = rows.reduce((max, row) => Math.max(max, row.length - 1), 0);

  sheet["!cols"] = [{ wch: 24 }, ...Array.from({ length: Math.max(1, maxPostCount) }, () => ({ wch: 48 }))];
  XLSX.utils.book_append_sheet(workbook, sheet, `${args.dateKst} 글수집`);

  if (args.errors.length > 0) {
    const errorSheet = XLSX.utils.aoa_to_sheet([
      ["계정명", "오류"],
      ...args.errors.map((error) => [error.accountName, error.message]),
    ]);
    errorSheet["!cols"] = [{ wch: 24 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(workbook, errorSheet, "수집오류");
  }

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
}
