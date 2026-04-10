import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { fetchNaverKeywordBids } from "@/server/naver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    keywords: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
    keyword: z.string().trim().min(1).optional(),
    positions: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional(),
  })
  .strict();

function withCookie(res: NextResponse, userId: string, setCookie: boolean) {
  if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
  return res;
}

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  try {
    await upsertUserById(userId);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }), userId, setCookie);
    }

    const keywords = parsed.data.keywords ?? (parsed.data.keyword ? [parsed.data.keyword] : []);
    if (keywords.length === 0) {
      return withCookie(NextResponse.json({ error: "keywords is required" }, { status: 400 }), userId, setCookie);
    }

    const result = await fetchNaverKeywordBids({
      keywords,
      positions: parsed.data.positions ?? [1, 2, 3, 4, 5],
    });

    return withCookie(NextResponse.json({ ok: true, ...result }), userId, setCookie);
  } catch (err) {
    const message = toErrorMessage(err);
    return withCookie(
      NextResponse.json(
        process.env.NODE_ENV === "production" ? { error: message } : { error: message, details: message },
        { status: 400 }
      ),
      userId,
      setCookie
    );
  }
}

export async function GET(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  try {
    await upsertUserById(userId);

    const url = new URL(req.url);
    const keywords = url
      .searchParams.get("keywords")
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
    const keyword = url.searchParams.get("keyword")?.trim();
    const positions = url
      .searchParams.get("positions")
      ?.split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item >= 1 && item <= 5);
    const input = keywords?.length ? keywords : keyword ? [keyword] : [];
    if (input.length === 0) {
      return withCookie(NextResponse.json({ error: "keywords is required" }, { status: 400 }), userId, setCookie);
    }

    const result = await fetchNaverKeywordBids({
      keywords: input,
      positions: positions?.length ? positions : [1, 2, 3, 4, 5],
    });

    return withCookie(NextResponse.json({ ok: true, ...result }), userId, setCookie);
  } catch (err) {
    const message = toErrorMessage(err);
    return withCookie(
      NextResponse.json(
        process.env.NODE_ENV === "production" ? { error: message } : { error: message, details: message },
        { status: 400 }
      ),
      userId,
      setCookie
    );
  }
}
