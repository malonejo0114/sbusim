import { cookies } from "next/headers";
import { session, sessionCookieOptions, userIdFromLoginId } from "@/server/session";
import {
  AUTH_COOKIE_NAME,
  AUTH_LOGIN_ID_COOKIE_NAME,
  getCanonicalLoginIdForAccount,
  getDashboardLoginAccounts,
  getDashboardLoginConfig,
} from "@/server/auth";
import { buildSessionScope, type SessionScope } from "@/server/sessionScope";

export async function ensureSessionUserId(): Promise<{ userId: string; setCookie: boolean }> {
  const store = await cookies();
  const existing = store.get(session.cookieName)?.value;
  const hasAuth = Boolean(store.get(AUTH_COOKIE_NAME)?.value);
  const loginIdInCookie = store.get(AUTH_LOGIN_ID_COOKIE_NAME)?.value?.trim();
  const accounts = await getDashboardLoginAccounts();
  const matched = loginIdInCookie ? accounts.find((acc) => acc.loginId === loginIdInCookie) : null;
  const canonicalLoginId = getCanonicalLoginIdForAccount(matched ?? (await getDashboardLoginConfig()));
  const canonicalUserId = userIdFromLoginId(canonicalLoginId);

  if (existing) {
    if (hasAuth && existing !== canonicalUserId) {
      return { userId: canonicalUserId, setCookie: true };
    }
    return { userId: existing, setCookie: false };
  }

  if (hasAuth) {
    return { userId: canonicalUserId, setCookie: true };
  }

  const userId = crypto.randomUUID();
  return { userId, setCookie: true };
}

export async function ensureSessionScope(): Promise<SessionScope & { setCookie: boolean }> {
  const store = await cookies();
  const existing = store.get(session.cookieName)?.value;
  const hasAuth = Boolean(store.get(AUTH_COOKIE_NAME)?.value);
  const loginIdInCookie = store.get(AUTH_LOGIN_ID_COOKIE_NAME)?.value?.trim();
  const accounts = await getDashboardLoginAccounts();
  const matched = loginIdInCookie ? accounts.find((acc) => acc.loginId === loginIdInCookie) : null;
  const canonicalLoginId = getCanonicalLoginIdForAccount(matched ?? (await getDashboardLoginConfig()));
  const scope = buildSessionScope({
    loginId: matched?.loginId ?? loginIdInCookie ?? null,
    canonicalLoginId,
  });

  if (existing) {
    if (hasAuth && existing !== scope.userId) {
      return { ...scope, setCookie: true };
    }
    return { ...scope, userId: existing, setCookie: false };
  }

  if (hasAuth) {
    return { ...scope, setCookie: true };
  }

  const anonymousUserId = crypto.randomUUID();
  return {
    ...buildSessionScope({ loginId: null, canonicalLoginId: anonymousUserId }),
    userId: anonymousUserId,
    userIds: [anonymousUserId],
    setCookie: true,
  };
}

export { sessionCookieOptions };
