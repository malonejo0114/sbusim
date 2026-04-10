import { cookies } from "next/headers";
import { session, sessionCookieOptions, userIdFromLoginId } from "@/server/session";
import {
  AUTH_COOKIE_NAME,
  AUTH_LOGIN_ID_COOKIE_NAME,
  getCanonicalLoginIdForAccount,
  getDashboardLoginAccounts,
  getDashboardLoginConfig,
} from "@/server/auth";

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

export { sessionCookieOptions };
