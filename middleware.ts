import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = "sbusim_auth";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/threads/deauthorize",
  "/api/auth/threads/data-deletion",
]);
const PUBLIC_API_PREFIXES = ["/api/cron/"];

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isAuthed = Boolean(req.cookies.get(AUTH_COOKIE)?.value);
  if (isAuthed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.has(pathname) || PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin") || pathname.startsWith("/tools")) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/tools/:path*", "/api/:path*"],
};
