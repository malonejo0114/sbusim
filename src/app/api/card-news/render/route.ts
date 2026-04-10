import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session } from "@/server/session";
import { isPublicMediaUrl } from "@/server/publicMedia";
import { renderCardNewsHtml } from "@/server/cardNews/renderHtml";
import { renderCardNewsPng } from "@/server/cardNews/renderPng";
import { CARD_NEWS_TEMPLATE_KEYS, CARD_NEWS_TEMPLATES } from "@/server/cardNews/templates";
import { resolvePublicBaseUrl } from "@/server/publicBaseUrl";
import { writeGeneratedAsset } from "@/server/generatedAssets";

export const runtime = "nodejs";

const CardNewsSlideSchema = z.object({
  pageLabel: z.string().trim().max(30).optional(),
  eyebrow: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(120),
  accentTitle: z.string().trim().max(120).optional(),
  subtitle: z.string().trim().max(160).optional(),
  body: z.string().trim().max(1500).optional(),
  quote: z.string().trim().max(240).optional(),
  footer: z.string().trim().max(180).optional(),
  stats: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        value: z.string().trim().min(1).max(40),
        tone: z.enum(["accent", "info", "danger", "muted"]).optional(),
      })
    )
    .max(6)
    .optional(),
});

const CardNewsRenderSchema = z.object({
  brand: z.string().trim().max(40).optional(),
  templateKey: z.enum(CARD_NEWS_TEMPLATE_KEYS).optional(),
  backgroundImageUrl: z.string().trim().url().optional().nullable(),
  output: z.enum(["html", "png"]).default("html"),
  slides: z.array(CardNewsSlideSchema).min(1).max(10),
});

function toPublicRenderError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (message.includes("배경 이미지를 불러오지 못했습니다")) {
    return message;
  }

  if (lower.includes("unsupported image") || lower.includes("decode") || lower.includes("invalid image")) {
    return "배경 이미지 형식을 읽지 못했습니다. PNG 또는 JPG 이미지로 다시 시도해주세요.";
  }

  if (lower.includes("enoent") || lower.includes("eacces") || lower.includes("write")) {
    return "생성된 PNG 저장에 실패했습니다. 잠시 후 다시 시도해주세요.";
  }

  return "카드뉴스 렌더 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

export async function GET() {
  const { userId, setCookie } = await ensureSessionUserId();
  const res = NextResponse.json({
    templates: CARD_NEWS_TEMPLATES,
    defaults: {
      brand: "FORTUNE INSIGHT",
      templateKey: CARD_NEWS_TEMPLATES[0]?.key,
      slideLimit: 10,
      output: "html-frames",
    },
  });
  if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
  return res;
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    const body = await req.json().catch(() => null);
    const parsed = CardNewsRenderSchema.safeParse(body);
    if (!parsed.success) {
      return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
    }

    const { backgroundImageUrl, output, ...renderInput } = parsed.data;
    if (backgroundImageUrl && !isPublicMediaUrl(backgroundImageUrl)) {
      return withCookie(
        NextResponse.json({ error: "배경 이미지는 외부에서 접근 가능한 공개 http(s) 주소여야 합니다." }, { status: 400 })
      );
    }

    if (output === "png") {
      const rendered = await renderCardNewsPng({
        ...renderInput,
        backgroundImageUrl,
      });
      const publicBaseUrl = resolvePublicBaseUrl(req);
      const frames = await Promise.all(
        rendered.frames.map(async (frame) => {
          const slide = renderInput.slides[frame.index];
          const saved = await writeGeneratedAsset({
            baseUrl: publicBaseUrl,
            baseName: `card-news-${renderInput.templateKey ?? "fortune-cover"}-${frame.index + 1}-${slide?.title ?? "slide"}`,
            ext: ".png",
            bytes: frame.buffer,
          });
          return {
            index: frame.index,
            width: frame.width,
            height: frame.height,
            fileName: saved.fileName,
            url: saved.url,
            bytes: saved.bytes,
          };
        })
      );

      return withCookie(
        NextResponse.json({
          brand: rendered.brand,
          template: rendered.template,
          output: "png",
          frames,
        })
      );
    }

    const rendered = renderCardNewsHtml({
      ...renderInput,
      backgroundImageUrl,
    });
    return withCookie(
      NextResponse.json({
        ...rendered,
        output: "html",
      })
    );
  } catch (err) {
    console.error("POST /api/card-news/render failed:", err);
    return withCookie(NextResponse.json({ error: toPublicRenderError(err) }, { status: 500 }));
  }
}
