import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import {
  DEFAULT_AI_PROMPT_CONFIG,
  getAiPromptConfig,
  resetAiPromptConfig,
  upsertAiPromptConfig,
} from "@/server/aiPromptSettings";

const PatchSchema = z
  .object({
    dailyTopicInfoGuide: z.string().trim().max(5000).optional(),
    dailyTopicCtaGuide: z.string().trim().max(5000).optional(),
    dailyTopicTopicGuide: z.string().trim().max(5000).optional(),
    dailyTopicCommonRules: z.string().trim().max(5000).optional(),
    issuePackCommonRules: z.string().trim().max(5000).optional(),
  })
  .strict();

function withSessionCookie(res: NextResponse, userId: string, setCookie: boolean) {
  if (setCookie) {
    res.cookies.set(session.cookieName, userId, sessionCookieOptions());
  }
  return res;
}

export async function GET() {
  const { userId, setCookie } = await ensureSessionUserId();
  try {
    await upsertUserById(userId);
    const settings = await getAiPromptConfig(userId);
    return withSessionCookie(
      NextResponse.json({
        ok: true,
        settings,
        defaults: DEFAULT_AI_PROMPT_CONFIG,
      }),
      userId,
      setCookie
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withSessionCookie(NextResponse.json({ error: message }, { status: 500 }), userId, setCookie);
  }
}

export async function PATCH(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  try {
    await upsertUserById(userId);

    const body = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return withSessionCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }), userId, setCookie);
    }

    const settings = await upsertAiPromptConfig(userId, parsed.data);
    return withSessionCookie(NextResponse.json({ ok: true, settings }), userId, setCookie);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withSessionCookie(NextResponse.json({ error: message }, { status: 500 }), userId, setCookie);
  }
}

export async function DELETE() {
  const { userId, setCookie } = await ensureSessionUserId();
  try {
    await upsertUserById(userId);
    const settings = await resetAiPromptConfig(userId);
    return withSessionCookie(NextResponse.json({ ok: true, settings }), userId, setCookie);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withSessionCookie(NextResponse.json({ error: message }, { status: 500 }), userId, setCookie);
  }
}
