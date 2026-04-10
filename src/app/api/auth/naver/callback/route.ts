import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { encryptString } from "@/server/crypto";
import { requireEnv } from "@/server/env";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

type NaverTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type NaverProfileResponse = {
  resultcode?: string;
  message?: string;
  response?: {
    id?: string;
    email?: string;
    nickname?: string;
    name?: string;
  };
};

function toPublicInfraError(details: string) {
  const d = details.toLowerCase();
  if (d.includes("5432") || d.includes("postgres") || d.includes("database") || d.includes("prisma")) {
    return "DB 연결 실패: Postgres를 실행하세요 (docker compose up -d)";
  }
  if (d.includes("naver")) {
    return "네이버 OAuth callback 처리 실패";
  }
  return "OAuth callback failed";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return NextResponse.json(
      { error: `네이버 OAuth 에러: ${oauthError}${oauthErrorDescription ? ` (${oauthErrorDescription})` : ""}` },
      { status: 400 }
    );
  }
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const cookieState = (await cookies()).get("sbusim_naver_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  try {
    const { userId, setCookie } = await ensureSessionUserId();
    await upsertUserById(userId);

    const clientId = requireEnv("NAVER_CLIENT_ID");
    const clientSecret = requireEnv("NAVER_CLIENT_SECRET");
    const tokenUrl = new URL("https://nid.naver.com/oauth2.0/token");
    tokenUrl.searchParams.set("grant_type", "authorization_code");
    tokenUrl.searchParams.set("client_id", clientId);
    tokenUrl.searchParams.set("client_secret", clientSecret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("state", state);

    const tokenRes = await fetch(tokenUrl, {
      method: "GET",
      cache: "no-store",
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as NaverTokenResponse;
    const accessToken = tokenJson.access_token?.trim();
    if (!tokenRes.ok || !accessToken) {
      throw new Error(
        tokenJson.error_description?.trim() || tokenJson.error?.trim() || `Naver token exchange failed (HTTP ${tokenRes.status})`
      );
    }

    const profileRes = await fetch("https://openapi.naver.com/v1/nid/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
    const profileJson = (await profileRes.json().catch(() => ({}))) as NaverProfileResponse;
    if (!profileRes.ok || !profileJson.response) {
      throw new Error(
        profileJson.message?.trim() || `Naver profile fetch failed (HTTP ${profileRes.status})`
      );
    }

    const naverUserId = profileJson.response.id?.trim();
    if (!naverUserId) {
      throw new Error("Naver user id not found in profile response");
    }

    const expiresInRaw = tokenJson.expires_in;
    const expiresIn =
      typeof expiresInRaw === "number"
        ? expiresInRaw
        : Number.isFinite(Number(expiresInRaw))
          ? Number(expiresInRaw)
          : 60 * 60;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    const accessTokenEncrypted = encryptString(accessToken);
    const refreshTokenEncrypted = tokenJson.refresh_token?.trim()
      ? encryptString(tokenJson.refresh_token.trim())
      : null;
    const naverEmail = profileJson.response.email?.trim() || null;
    const naverNickname = profileJson.response.nickname?.trim() || null;
    const label = naverNickname || naverEmail || naverUserId;

    const existing = await prisma.naverAccount.findFirst({
      where: { userId, naverUserId },
      select: { id: true },
    });
    if (existing) {
      await prisma.naverAccount.update({
        where: { id: existing.id },
        data: {
          label,
          naverEmail,
          naverNickname,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiresAt,
        },
      });
    } else {
      await prisma.naverAccount.create({
        data: {
          userId,
          label,
          naverUserId,
          naverEmail,
          naverNickname,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiresAt,
        },
      });
    }

    const res = NextResponse.redirect(new URL("/tools/naver-keywords", origin));
    res.cookies.set("sbusim_naver_oauth_state", "", { path: "/", maxAge: 0 });
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("Naver OAuth callback failed:", err);
    const details = err instanceof Error ? err.message : String(err);
    const error = toPublicInfraError(details);
    return NextResponse.json(
      process.env.NODE_ENV === "production" ? { error } : { error, details },
      { status: 500 }
    );
  }
}
