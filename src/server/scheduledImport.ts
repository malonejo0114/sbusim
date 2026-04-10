import { MediaType } from "@prisma/client";
import * as XLSX from "xlsx";

export type ImportAccount = {
  id: string;
  label: string | null;
  threadsUsername: string | null;
  threadsUserId: string | null;
};

export type ImportedPreviewRow = {
  rowNumber: number;
  accountInput: string;
  accountId: string | null;
  accountName: string | null;
  text: string;
  replies: Array<{ text: string }>;
  mediaType: MediaType;
  mediaUrl: string | null;
  scheduledAtInput: string;
  scheduledAtIso: string | null;
  errors: string[];
};

export type ValidImportedItem = {
  rowNumber: number;
  threadsAccountId: string;
  text: string;
  replies: Array<{ text: string }>;
  mediaType: MediaType;
  mediaUrl: string | null;
  scheduledAtIso: string | null;
};

const ACCOUNT_ALIASES = ["account", "계정", "아이디", "accountid", "threadsaccountid", "threadsuserid", "username"];
const TEXT_ALIASES = ["text", "본문", "content", "글"];
const SCHEDULED_AT_ALIASES = ["scheduledat", "예약시간", "예약시각", "예약일시", "발행시간", "발행시각"];
const MEDIA_TYPE_ALIASES = ["mediatype", "미디어타입", "타입"];
const MEDIA_URL_ALIASES = ["mediaurl", "미디어url", "이미지url", "영상url", "url"];
const REPLY_ALIAS_GROUPS = Array.from({ length: 10 }, (_, index) => {
  const n = index + 1;
  return [`reply${n}`, `comment${n}`, `댓글${n}`, `답글${n}`, `코멘트${n}`];
});

function normalizeKey(v: string) {
  return v.toLowerCase().replace(/\s+/g, "").replace(/[_-]/g, "");
}

function normalizeCell(v: unknown) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function accountDisplayName(account: ImportAccount) {
  return account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;
}

function parseMediaType(value: string): { value: MediaType; error?: string } {
  if (!value) return { value: MediaType.TEXT };
  const upper = value.toUpperCase();
  if (upper === MediaType.TEXT || upper === MediaType.IMAGE || upper === MediaType.VIDEO) {
    return { value: upper as MediaType };
  }
  return { value: MediaType.TEXT, error: `mediaType은 TEXT/IMAGE/VIDEO만 가능합니다. (입력값: ${value})` };
}

function toIsoFromKstParts(yyyy: number, mm: number, dd: number, hh: number, mi: number) {
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh < 0 || hh > 23 || mi < 0 || mi > 59) return null;
  const iso = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00+09:00`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseExcelSerialToIso(value: number) {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
  return toIsoFromKstParts(parsed.y, parsed.m, parsed.d, parsed.H ?? 0, parsed.M ?? 0);
}

function parseScheduledAtToIso(rawValue: unknown, opts?: { allowEmpty?: boolean }): { iso: string | null; error?: string } {
  const allowEmpty = opts?.allowEmpty === true;
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return allowEmpty ? { iso: null } : { iso: null, error: "scheduledAt(예약시간)이 비어 있습니다." };
  }

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    const fromExcel = parseExcelSerialToIso(rawValue);
    if (fromExcel) return { iso: fromExcel };
    return { iso: null, error: "scheduledAt 숫자 셀을 날짜로 해석하지 못했습니다." };
  }

  const value = String(rawValue).trim();
  if (!value) return allowEmpty ? { iso: null } : { iso: null, error: "scheduledAt(예약시간)이 비어 있습니다." };

  if (/^\d+(\.\d+)?$/.test(value)) {
    const fromExcel = parseExcelSerialToIso(Number(value));
    if (fromExcel) return { iso: fromExcel };
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime()) && /[zZ]|[+\-]\d{2}:?\d{2}$/.test(value)) {
    return { iso: direct.toISOString() };
  }

  const normalized = value
    .replace(/\//g, "-")
    .replace(/\./g, "-")
    .replace(/년/g, "-")
    .replace(/월/g, "-")
    .replace(/일/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const dateOnly = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    const iso = toIsoFromKstParts(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 9, 0);
    if (iso) return { iso };
  }

  const dateTime = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(?:(오전|오후|am|pm|AM|PM)\s*)?(\d{1,2})(?::(\d{1,2}))?)$/
  );
  if (dateTime) {
    const yyyy = Number(dateTime[1]);
    const mm = Number(dateTime[2]);
    const dd = Number(dateTime[3]);
    let hh = Number(dateTime[5]);
    const mi = Number(dateTime[6] ?? "0");
    const ampm = (dateTime[4] ?? "").toLowerCase();

    if (ampm === "pm" || ampm === "오후") {
      if (hh >= 1 && hh <= 11) hh += 12;
    } else if (ampm === "am" || ampm === "오전") {
      if (hh === 12) hh = 0;
    }

    const iso = toIsoFromKstParts(yyyy, mm, dd, hh, mi);
    if (iso) return { iso };
  }

  return {
    iso: null,
    error:
      "scheduledAt 형식이 올바르지 않습니다. 예: 2026-02-27 09:30 / 2026.2.27 오전 9:30 / 2026-02-27",
  };
}

function pickCellByAliases(rawRow: Record<string, unknown>, aliases: string[]) {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(rawRow)) {
    normalized.set(normalizeKey(key), value);
  }
  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined) return normalizeCell(value);
  }
  return "";
}

function pickReplies(rawRow: Record<string, unknown>) {
  return REPLY_ALIAS_GROUPS.map((aliases) => pickCellByAliases(rawRow, aliases).trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ text }));
}

function buildAccountIndex(accounts: ImportAccount[]) {
  const index = new Map<string, ImportAccount[]>();

  const put = (keyRaw: string, account: ImportAccount) => {
    const key = keyRaw.trim().toLowerCase();
    if (!key) return;
    const list = index.get(key) ?? [];
    if (!list.some((item) => item.id === account.id)) {
      list.push(account);
      index.set(key, list);
    }
  };

  for (const account of accounts) {
    put(account.id, account);
    if (account.label) put(account.label, account);
    if (account.threadsUsername) {
      put(account.threadsUsername, account);
      put(account.threadsUsername.replace(/^@/, ""), account);
    }
    if (account.threadsUserId) put(account.threadsUserId, account);
  }

  return index;
}

function resolveAccount(input: string, accounts: ImportAccount[], accountIndex: Map<string, ImportAccount[]>) {
  if (!input) {
    if (accounts.length === 1) {
      return { account: accounts[0] };
    }
    return { error: "계정 컬럼이 비어 있습니다. (다계정 업로드 시 계정 필수)" };
  }

  const key = input.trim().toLowerCase();
  const list = accountIndex.get(key) ?? accountIndex.get(key.replace(/^@/, ""));
  if (!list || list.length === 0) {
    return { error: `계정을 찾을 수 없습니다. (입력값: ${input})` };
  }
  if (list.length > 1) {
    return { error: `계정 식별이 모호합니다. 계정 ID로 지정하세요. (입력값: ${input})` };
  }
  return { account: list[0] };
}

export function parseExcelForScheduledPosts(
  buffer: Buffer,
  accounts: ImportAccount[],
  opts?: {
    allowEmptyScheduledAt?: boolean;
  }
) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("엑셀 시트가 비어 있습니다.");
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
    dateNF: "yyyy-mm-dd hh:mm",
    blankrows: false,
  });

  const accountIndex = buildAccountIndex(accounts);
  const items: ImportedPreviewRow[] = [];
  const validItems: ValidImportedItem[] = [];

  rows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const accountInput = pickCellByAliases(rawRow, ACCOUNT_ALIASES);
    const text = pickCellByAliases(rawRow, TEXT_ALIASES);
    const replies = pickReplies(rawRow);
    const scheduledAtInput = pickCellByAliases(rawRow, SCHEDULED_AT_ALIASES);
    const mediaTypeInput = pickCellByAliases(rawRow, MEDIA_TYPE_ALIASES);
    const mediaUrl = pickCellByAliases(rawRow, MEDIA_URL_ALIASES);

    const errors: string[] = [];

    const resolved = resolveAccount(accountInput, accounts, accountIndex);
    if (resolved.error) errors.push(resolved.error);

    if (!text.trim()) {
      errors.push("본문(text)이 비어 있습니다.");
    }
    for (const [replyIndex, reply] of replies.entries()) {
      if (reply.text.length > 500) {
        errors.push(`reply${replyIndex + 1}(댓글 ${replyIndex + 1})은 500자 이내여야 합니다.`);
      }
    }

    const mediaTypeParsed = parseMediaType(mediaTypeInput);
    if (mediaTypeParsed.error) errors.push(mediaTypeParsed.error);

    const scheduledAtParsed = parseScheduledAtToIso(scheduledAtInput, {
      allowEmpty: opts?.allowEmptyScheduledAt === true,
    });
    if (scheduledAtParsed.error) errors.push(scheduledAtParsed.error);

    const normalizedMediaUrl = mediaUrl.trim() ? mediaUrl.trim() : null;
    if ((mediaTypeParsed.value === MediaType.IMAGE || mediaTypeParsed.value === MediaType.VIDEO) && !normalizedMediaUrl) {
      errors.push("IMAGE/VIDEO는 mediaUrl이 필요합니다.");
    }
    if (mediaTypeParsed.value === MediaType.TEXT && normalizedMediaUrl) {
      errors.push("TEXT는 mediaUrl을 비워야 합니다.");
    }
    if (normalizedMediaUrl) {
      try {
        new URL(normalizedMediaUrl);
      } catch {
        errors.push("mediaUrl이 올바른 URL이 아닙니다.");
      }
    }

    const account = resolved.account ?? null;
    const row: ImportedPreviewRow = {
      rowNumber,
      accountInput,
      accountId: account?.id ?? null,
      accountName: account ? accountDisplayName(account) : null,
      text: text.trim(),
      replies,
      mediaType: mediaTypeParsed.value,
      mediaUrl: normalizedMediaUrl,
      scheduledAtInput,
      scheduledAtIso: scheduledAtParsed.iso,
      errors,
    };

    items.push(row);

    if (errors.length === 0 && account) {
      validItems.push({
        rowNumber,
        threadsAccountId: account.id,
        text: text.trim(),
        replies,
        mediaType: mediaTypeParsed.value,
        mediaUrl: normalizedMediaUrl,
        scheduledAtIso: scheduledAtParsed.iso,
      });
    }
  });

  const byAccountMap = new Map<string, { accountId: string; accountName: string; validCount: number }>();
  for (const row of items) {
    if (!row.accountId || row.errors.length > 0) continue;
    const prev = byAccountMap.get(row.accountId);
    if (prev) {
      prev.validCount += 1;
    } else {
      byAccountMap.set(row.accountId, {
        accountId: row.accountId,
        accountName: row.accountName ?? row.accountId,
        validCount: 1,
      });
    }
  }

  return {
    sheetName,
    totalRows: items.length,
    validRows: validItems.length,
    invalidRows: items.length - validItems.length,
    byAccount: Array.from(byAccountMap.values()).sort((a, b) => b.validCount - a.validCount),
    items,
    validItems,
  };
}
