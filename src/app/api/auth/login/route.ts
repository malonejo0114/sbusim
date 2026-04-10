import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AUTH_COOKIE_NAME,
  AUTH_LOGIN_ID_COOKIE_NAME,
  authCookieOptions,
  getCanonicalLoginIdForAccount,
  getDashboardLoginAccounts,
  verifyDashboardLoginPassword,
} from "@/server/auth";
import { session, sessionCookieOptions, upsertUserById, userIdFromLoginId } from "@/server/session";

const LoginSchema = z.object({
  loginId: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "아이디/비밀번호를 확인해주세요." }, { status: 400 });
  }

  try {
    const accounts = await getDashboardLoginAccounts();
    const matched = accounts.find((acc) => acc.loginId === parsed.data.loginId);
    if (!matched || !(await verifyDashboardLoginPassword(matched, parsed.data.password))) {
      return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    const canonicalUserId = userIdFromLoginId(getCanonicalLoginIdForAccount(matched));
    await upsertUserById(canonicalUserId);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE_NAME, crypto.randomUUID(), authCookieOptions());
    res.cookies.set(AUTH_LOGIN_ID_COOKIE_NAME, matched.loginId, authCookieOptions());
    res.cookies.set(session.cookieName, canonicalUserId, sessionCookieOptions());
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "로그인 설정이 올바르지 않습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
