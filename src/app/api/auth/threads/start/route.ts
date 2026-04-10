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
    const clientId = requireEnv("THREADS_APP_ID");
    const origin = getRequestOrigin(req);
    const redirectUri = `${origin}/api/auth/threads/callback`;

    const state = crypto.randomUUID();

    const url = new URL("https://threads.net/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set(
      "scope",
      [
        "threads_basic",
        "threads_content_publish",
        "threads_manage_replies",
        "threads_read_replies",
        "threads_manage_insights",
      ].join(",")
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);

    const res = NextResponse.redirect(url);
    res.cookies.set("sbusim_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10, // 10 minutes
    });
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error:
          "Threads OAuth 시작 실패. THREADS_APP_ID/THREADS_APP_SECRET/Redirect URI(Threads 앱 설정) 등을 확인하세요.",
        details: msg,
      },
      { status: 400 }
    );
  }
}
