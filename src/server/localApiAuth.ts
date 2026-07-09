import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { optionalEnv } from "@/server/env";
import { userIdFromLoginId } from "@/server/session";
import { getMasterScopeLoginIds } from "@/server/sessionScope";

const LOGIN_USER_ID_PREFIX = "login:";
const DEFAULT_OWNER_MAP: Record<string, string> = {
  admin: "hasun",
  ops2: "ops2",
};

// Returns a 401 NextResponse if auth fails, or null if authorized.
// Auth: header "Authorization: Bearer <key>" must exactly match env LOCAL_API_KEY.
// If LOCAL_API_KEY env is unset or empty -> always 401 (fail closed).
// 401 body: { "error": "Unauthorized" }. Use timing-safe comparison (crypto.timingSafeEqual on
// equal-length buffers; length mismatch -> fail).
export function requireLocalApiKey(req: Request): NextResponse | null {
  const expected = optionalEnv("LOCAL_API_KEY");
  const provided = parseBearerToken(req.headers.get("authorization"));
  if (!expected || !provided) {
    return unauthorized();
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return unauthorized();
  }

  return timingSafeEqual(expectedBuffer, providedBuffer) ? null : unauthorized();
}

export type LocalOwner = { owner: string; loginId: string; userId: string };

// Owner mapping: loginId -> external owner name used by the local program.
// Default map: admin -> hasun, ops2 -> ops2.
// Env override LOCAL_OWNER_MAP, CSV of "loginId:owner" pairs, e.g. "admin:hasun,ops2:ops2".
// The set of loginIds defaults to getMasterScopeLoginIds() merged with the keys of the map.
export function listLocalOwners(): LocalOwner[] {
  const ownerMap = getOwnerMap();
  const loginIds = Array.from(
    new Set([
      ...getMasterScopeLoginIds().map(normalizeLoginId),
      ...Object.keys(ownerMap).map(normalizeLoginId),
    ])
  ).filter((loginId) => loginId.length > 0);

  return loginIds
    .map((loginId) => ({
      loginId,
      userId: userIdFromLoginId(loginId),
      owner: ownerMap[loginId] ?? loginId,
    }))
    .sort((a, b) => a.owner.localeCompare(b.owner) || a.loginId.localeCompare(b.loginId));
}

// Reverse lookup: userId ("login:admin") -> owner ("hasun"). Unknown userId -> the part after "login:".
export function ownerForUserId(userId: string): string {
  const loginId = loginIdFromUserId(userId);
  return listLocalOwners().find((item) => item.userId === userId)?.owner ?? loginId;
}

// owners (e.g. ["hasun","ops2"]) -> userIds. undefined/empty -> all owners' userIds.
// Unknown owner names throw an Error with a clear Korean message listing valid owners.
export function resolveUserIdsForOwners(owners?: string[]): string[] {
  const localOwners = listLocalOwners();
  const uniqueOwners = normalizeFilterValues(owners);
  if (!uniqueOwners) {
    return localOwners.map((item) => item.userId);
  }

  const byOwner = new Map(localOwners.map((item) => [item.owner.toLowerCase(), item.userId]));
  const missing = uniqueOwners.filter((owner) => !byOwner.has(owner.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `알 수 없는 owner입니다: ${missing.join(", ")}. 유효한 owner: ${localOwners.map((item) => item.owner).join(", ")}`
    );
  }

  return uniqueOwners.map((owner) => byOwner.get(owner.toLowerCase()) as string);
}

export type LocalThreadsAccount = {
  id: string;
  userId: string;
  owner: string;
  label: string | null;
  threadsUserId: string | null;
  threadsUsername: string | null;
  tokenExpiresAt: Date;
};

// Finds ThreadsAccounts in scope. `accounts` entries may match account id, threadsUsername
// (case-insensitive, with or without leading "@"), or label (case-insensitive).
// owners filter applies first (resolveUserIdsForOwners). Never select or return token/proxy fields.
// If `accounts` is provided and some entry matches nothing, throw Error with Korean message naming it.
export async function resolveLocalAccounts(args: {
  owners?: string[];
  accounts?: string[];
}): Promise<LocalThreadsAccount[]> {
  const userIds = resolveUserIdsForOwners(args.owners);
  const rows = await prisma.threadsAccount.findMany({
    where: { userId: { in: userIds } },
    orderBy: [{ userId: "asc" }, { threadsUsername: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      label: true,
      threadsUserId: true,
      threadsUsername: true,
      tokenExpiresAt: true,
    },
  });

  const scopedAccounts = rows.map((row) => ({
    ...row,
    owner: ownerForUserId(row.userId),
  }));
  const accountFilters = normalizeFilterValues(args.accounts);
  if (!accountFilters) {
    return sortLocalAccounts(scopedAccounts);
  }

  const matchedIds = new Set<string>();
  const missing = accountFilters.filter((accountFilter) => {
    const normalizedFilter = normalizeAccountLookup(accountFilter);
    const matches = scopedAccounts.filter((account) => accountMatches(account, normalizedFilter));
    for (const match of matches) {
      matchedIds.add(match.id);
    }
    return matches.length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`알 수 없는 계정입니다: ${missing.join(", ")}`);
  }

  return sortLocalAccounts(scopedAccounts.filter((account) => matchedIds.has(account.id)));
}

// Messages thrown by local-API input validation (owner/account lookup, date/body/format parsing).
// Routes use this to map thrown validation errors to 400 instead of 500.
const VALIDATION_MESSAGE_PREFIXES = [
  "알 수 없는 owner입니다:",
  "알 수 없는 계정입니다:",
  "date는",
  "date를",
  "JSON 본문",
  "owners는",
  "accounts는",
  "format은",
  "includeThreadUrl는",
  "syncInsights는",
];

export function isLocalApiValidationMessage(message: string): boolean {
  return VALIDATION_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix));
}

// Parses "a,b , c" | string[] | undefined -> trimmed non-empty string[] | undefined
export function parseCsvParam(value: string | string[] | null | undefined): string[] | undefined {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const parsed = values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseBearerToken(value: string | null) {
  const prefix = "Bearer ";
  return value?.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}

function getOwnerMap() {
  const ownerMap = { ...DEFAULT_OWNER_MAP };
  const override = optionalEnv("LOCAL_OWNER_MAP");
  if (!override) return ownerMap;

  return override.split(",").reduce<Record<string, string>>((acc, pair) => {
    const [rawLoginId, ...ownerParts] = pair.split(":");
    const loginId = normalizeLoginId(rawLoginId ?? "");
    const owner = ownerParts.join(":").trim();
    if (loginId && owner) {
      acc[loginId] = owner;
    }
    return acc;
  }, ownerMap);
}

function normalizeLoginId(loginId: string) {
  return loginIdFromUserId(userIdFromLoginId(loginId));
}

function loginIdFromUserId(userId: string) {
  return userId.startsWith(LOGIN_USER_ID_PREFIX) ? userId.slice(LOGIN_USER_ID_PREFIX.length) : userId;
}

function normalizeFilterValues(values?: string[]) {
  const normalized = Array.from(new Set((values ?? []).map((item) => item.trim()).filter((item) => item.length > 0)));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAccountLookup(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function accountMatches(account: LocalThreadsAccount, normalizedFilter: string) {
  return (
    account.id === normalizedFilter ||
    normalizeAccountLookup(account.threadsUsername ?? "") === normalizedFilter ||
    (account.label?.trim().toLowerCase() ?? "") === normalizedFilter
  );
}

function sortLocalAccounts(accounts: LocalThreadsAccount[]) {
  return [...accounts].sort(
    (a, b) =>
      a.owner.localeCompare(b.owner) ||
      (a.threadsUsername ?? "").localeCompare(b.threadsUsername ?? "") ||
      a.id.localeCompare(b.id)
  );
}
