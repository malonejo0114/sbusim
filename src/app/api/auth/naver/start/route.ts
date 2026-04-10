import { NextResponse } from "next/server";
import { requireEnv } from "@/server/env";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session } from "@/server/session";

function getRequestOrigin(req: Request) {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : url.origin;
}

export async function GET(req: Request) {
  try {
    const { userId, setCookie } = await ensureSessionUserId();
    const clientId = requireEnv("NAVER_CLIENT_ID");
    const origin = getRequestOrigin(req);
    const redirectUri = `${origin}/api/auth/naver/callback`;

    const state = crypto.randomUUID();
    const url = new URL("https://nid.naver.com/oauth2.0/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);

    const res = NextResponse.redirect(url);
    res.cookies.set("sbusim_naver_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "네이버 OAuth 시작 실패. NAVER_CLIENT_ID/NAVER_CLIENT_SECRET/리디렉션 URI 설정을 확인하세요.",
        details,
      },
      { status: 400 }
    );
  }
}
