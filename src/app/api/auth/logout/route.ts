import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_LOGIN_ID_COOKIE_NAME } from "@/server/auth";

function getRequestOrigin(req: Request) {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : url.origin;
}

function clearAuthCookie(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(AUTH_LOGIN_ID_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("sbusim_uid", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function POST() {
  return clearAuthCookie(NextResponse.json({ ok: true }));
}

export async function GET(req: Request) {
  const origin = getRequestOrigin(req);
  return clearAuthCookie(NextResponse.redirect(new URL("/login", origin)));
}
