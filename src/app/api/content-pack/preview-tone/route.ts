import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { generateDailyTopicPost, generateIssueBriefingAndPosts } from "@/server/topicGenerator";
import { getAiPromptConfig } from "@/server/aiPromptSettings";

type AiProviderInput = "auto" | "gemini" | "perplexity";

const PreviewToneSchema = z.object({
  accountId: z.string().trim().min(1),
  issuePrompt: z.string().trim().min(1).max(500),
  topic: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  promptHint: z.string().trim().max(2000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  ctaText: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  infoRatioPercent: z.coerce.number().int().min(0).max(100).optional(),
  ctaRatioPercent: z.coerce.number().int().min(0).max(100).optional(),
  researchAiProvider: z.enum(["auto", "gemini", "perplexity"]).optional().default("perplexity"),
  researchAiModel: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  writingAiProvider: z.enum(["auto", "gemini", "perplexity"]).optional().default("gemini"),
  writingAiModel: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function resolvePreviewTypes(infoRatioPercent?: number, ctaRatioPercent?: number): Array<"INFO" | "CTA"> {
  const info = clampInt(infoRatioPercent ?? 70, 0, 100);
  const cta = clampInt(ctaRatioPercent ?? Math.max(0, 100 - info), 0, 100);
  if (cta <= 0) return ["INFO", "INFO"];
  if (info <= 0) return ["CTA", "INFO"];
  return cta >= info ? ["CTA", "INFO"] : ["INFO", "CTA"];
}

const PREVIEW_FOCUS_TOPICS = ["핵심 시황 정리", "실전 대응 포인트"];

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const promptConfig = await getAiPromptConfig(userId);
    const body = await req.json().catch(() => null);
    const parsed = PreviewToneSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
    }

    const account = await prisma.threadsAccount.findFirst({
      where: {
        id: parsed.data.accountId,
        userId,
      },
      select: {
        id: true,
        label: true,
        threadsUsername: true,
        threadsUserId: true,
      },
    });
    if (!account) {
      return withCookie(NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 }));
    }

    const briefingGenerated = await generateIssueBriefingAndPosts({
      issuePrompt: parsed.data.issuePrompt,
      templatePrompt: "워딩 검토용 브리핑. 핵심 이슈를 4~6문장으로 간단히.",
      extraPrompt: "최신성 위주, 단정적 허위 금지, 핵심 사실 위주 요약.",
      count: 1,
      promptConfig,
      aiProvider: parsed.data.researchAiProvider as AiProviderInput,
      aiModel: parsed.data.researchAiModel,
      usageUserId: userId,
    });

    const contentTypes = resolvePreviewTypes(parsed.data.infoRatioPercent, parsed.data.ctaRatioPercent);
    const baseTopic = parsed.data.topic?.trim() || parsed.data.issuePrompt;

    const samples = [];
    for (let i = 0; i < 2; i += 1) {
      const contentType = contentTypes[i] ?? "INFO";
      const focus = PREVIEW_FOCUS_TOPICS[i] ?? PREVIEW_FOCUS_TOPICS[0];
      const generated = await generateDailyTopicPost({
        topic: `${baseTopic} / ${focus}`,
        contentType,
        promptConfig,
        promptHint: [
          parsed.data.promptHint ?? "",
          `워딩 검토 샘플 ${i + 1}번`,
          `브리핑 참고:\n${briefingGenerated.briefing}`,
        ]
          .filter(Boolean)
          .join("\n"),
        ctaText: contentType === "CTA" ? parsed.data.ctaText : undefined,
        aiProvider: parsed.data.writingAiProvider as AiProviderInput,
        aiModel: parsed.data.writingAiModel,
        usageUserId: userId,
      });

      samples.push({
        index: i + 1,
        contentType,
        focusTopic: focus,
        text: generated.text,
        ai: generated.ai,
      });
    }

    const writingAi = samples[0]?.ai ?? briefingGenerated.ai;
    const accountName = account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;

    return withCookie(
      NextResponse.json({
        ok: true,
        result: {
          accountId: account.id,
          accountName,
          issuePrompt: parsed.data.issuePrompt,
          briefing: briefingGenerated.briefing,
          briefingAi: briefingGenerated.ai,
          writingAi,
          samples,
        },
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
