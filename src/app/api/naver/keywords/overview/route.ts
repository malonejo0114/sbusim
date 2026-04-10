import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { fetchNaverKeywordOverview } from "@/server/naver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    keywords: z.array(z.string().trim().min(1)).min(1).max(5).optional(),
    keyword: z.string().trim().min(1).optional(),
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

    const result = await fetchNaverKeywordOverview(keywords);
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
      .slice(0, 5);
    const keyword = url.searchParams.get("keyword")?.trim();
    const input = keywords?.length ? keywords : keyword ? [keyword] : [];
    if (input.length === 0) {
      return withCookie(NextResponse.json({ error: "keywords is required" }, { status: 400 }), userId, setCookie);
    }

    const result = await fetchNaverKeywordOverview(input);
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
