import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

const CreatePromptTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2000),
});

export async function GET() {
  const { userId, setCookie } = await ensureSessionUserId();

  try {
    await upsertUserById(userId);
    const templates = await prisma.promptTemplate.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }],
    });

    const res = NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        prompt: t.prompt,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const res = NextResponse.json({ error }, { status: 500 });
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  }
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const json = await req.json().catch(() => null);
  const parsed = CreatePromptTemplateSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);

    const template = await prisma.promptTemplate.create({
      data: {
        userId,
        name: parsed.data.name,
        prompt: parsed.data.prompt,
      },
    });

    return withCookie(
      NextResponse.json({
        template: {
          id: template.id,
          name: template.name,
          prompt: template.prompt,
          createdAt: template.createdAt.toISOString(),
          updatedAt: template.updatedAt.toISOString(),
        },
      })
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.includes("PromptTemplate_userId_name_key")
      ? "같은 이름의 템플릿이 이미 있습니다."
      : raw;
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
