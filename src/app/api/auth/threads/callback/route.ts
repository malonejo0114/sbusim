import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { encryptString } from "@/server/crypto";
import { exchangeCodeForShortLivedToken, exchangeShortLivedForLongLivedToken, getThreadsMe } from "@/server/threadsApi";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

function getRequestOrigin(req: Request) {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : url.origin;
}

function toPublicInfraError(details: string) {
  const d = details.toLowerCase();
  if (d.includes("5432") || d.includes("postgres") || d.includes("database") || d.includes("prisma")) {
    return "DB 연결 실패: Postgres를 실행하세요 (docker compose up -d)";
  }
  return "OAuth callback failed";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const cookieState = (await cookies()).get("sbusim_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  const origin = getRequestOrigin(req);
  const redirectUri = `${origin}/api/auth/threads/callback`;

  try {
    const { userId, setCookie } = await ensureSessionUserId();
    await upsertUserById(userId);

    const shortLived = await exchangeCodeForShortLivedToken({ code, redirectUri });
    const longLived = await exchangeShortLivedForLongLivedToken({
      shortLivedAccessToken: shortLived.accessToken,
    });

    const now = Date.now();
    const expiresIn = longLived.expiresInSeconds ?? 60 * 60 * 24 * 30; // fallback 30d
    const tokenExpiresAt = new Date(now + expiresIn * 1000);
    const accessTokenEncrypted = encryptString(longLived.accessToken);

    const me = await getThreadsMe({ accessToken: longLived.accessToken });

    const existing =
      me.id
        ? await prisma.threadsAccount.findFirst({
            where: { userId, threadsUserId: me.id },
          })
        : null;

    if (existing) {
      await prisma.threadsAccount.update({
        where: { id: existing.id },
        data: {
          threadsUsername: me.username ?? existing.threadsUsername,
          accessTokenEncrypted,
          tokenExpiresAt,
        },
      });
    } else {
      await prisma.threadsAccount.create({
        data: {
          userId,
          label: me.username ?? me.id ?? "새 Threads 계정",
          threadsUserId: me.id ?? null,
          threadsUsername: me.username ?? null,
          accessTokenEncrypted,
          tokenExpiresAt,
        },
      });
    }

    const res = NextResponse.redirect(new URL("/dashboard", origin));
    res.cookies.set("sbusim_oauth_state", "", { path: "/", maxAge: 0 });
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("Threads OAuth callback failed:", err);
    const details = err instanceof Error ? err.message : String(err);
    const error = toPublicInfraError(details);
    return NextResponse.json(
      process.env.NODE_ENV === "production" ? { error } : { error, details },
      { status: 500 }
    );
  }
}
