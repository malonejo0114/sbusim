import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const UpdatePromptTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2000),
});

export async function PATCH(req: Request, context: RouteContext) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const json = await req.json().catch(() => null);
  const parsed = UpdatePromptTemplateSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);
    const { id } = await context.params;

    const updated = await prisma.promptTemplate.updateMany({
      where: { id, userId },
      data: {
        name: parsed.data.name,
        prompt: parsed.data.prompt,
      },
    });

    if (updated.count === 0) {
      return withCookie(NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 }));
    }

    const template = await prisma.promptTemplate.findFirst({
      where: { id, userId },
    });

    if (!template) {
      return withCookie(NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 }));
    }

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

export async function DELETE(_req: Request, context: RouteContext) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const { id } = await context.params;

    const deleted = await prisma.promptTemplate.deleteMany({
      where: { id, userId },
    });
    if (deleted.count === 0) {
      return withCookie(NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 }));
    }

    return withCookie(NextResponse.json({ ok: true }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
