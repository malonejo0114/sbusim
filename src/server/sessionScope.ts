import { optionalEnv } from "@/server/env";
import { userIdFromLoginId } from "@/server/session";

export type SessionScope = {
  userId: string;
  loginId: string | null;
  canonicalLoginId: string;
  isMaster: boolean;
  canControlAccounts: boolean;
  userIds: string[];
};

function parseCsv(value: string | undefined, fallback: string[]) {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}

export function getMasterLoginIds() {
  return parseCsv(optionalEnv("MASTER_LOGIN_IDS"), ["master"]);
}

export function getMasterScopeLoginIds() {
  return parseCsv(optionalEnv("MASTER_SCOPE_LOGIN_IDS"), ["admin", "ops2"]);
}

export function buildSessionScope(args: {
  loginId?: string | null;
  canonicalLoginId: string;
}) {
  const loginId = args.loginId?.trim() || null;
  const canonicalLoginId = args.canonicalLoginId.trim() || "admin";
  const userId = userIdFromLoginId(canonicalLoginId);
  const isMaster = loginId ? getMasterLoginIds().includes(loginId) : false;
  const userIds = isMaster
    ? Array.from(new Set(getMasterScopeLoginIds().map((item) => userIdFromLoginId(item))))
    : [userId];

  return {
    userId,
    loginId,
    canonicalLoginId,
    isMaster,
    canControlAccounts: isMaster,
    userIds,
  } satisfies SessionScope;
}

export function userWhereForScope(scope: Pick<SessionScope, "userIds">) {
  return scope.userIds.length === 1 ? { userId: scope.userIds[0] } : { userId: { in: scope.userIds } };
}
