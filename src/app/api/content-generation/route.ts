import { NextResponse } from "next/server";
import { z } from "zod";
import { generateIssueBriefingAndPosts } from "@/server/topicGenerator";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { getAiPromptConfig } from "@/server/aiPromptSettings";

const GenerateSchema = z.object({
  issuePrompt: z.string().trim().min(1).max(500),
  templatePrompt: z.string().trim().max(2000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  extraPrompt: z.string().trim().max(2000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  count: z.coerce.number().int().min(1).max(10),
  aiProvider: z.enum(["auto", "gemini", "perplexity"]).optional().default("auto"),
  aiModel: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const json = await req.json().catch(() => null);
  const parsed = GenerateSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);
    const promptConfig = await getAiPromptConfig(userId);

    const generated = await generateIssueBriefingAndPosts({
      issuePrompt: parsed.data.issuePrompt,
      templatePrompt: parsed.data.templatePrompt,
      extraPrompt: parsed.data.extraPrompt,
      count: parsed.data.count,
      promptConfig,
      aiProvider: parsed.data.aiProvider,
      aiModel: parsed.data.aiModel,
      usageUserId: userId,
    });

    return withCookie(
      NextResponse.json({
        briefing: generated.briefing,
        posts: generated.posts,
        ai: generated.ai,
      })
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
