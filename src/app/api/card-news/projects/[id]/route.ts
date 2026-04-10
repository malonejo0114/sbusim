import { NextResponse } from "next/server";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import {
  CardNewsProjectWriteSchema,
  deleteCardNewsProject,
  getCardNewsProject,
  updateCardNewsProject,
} from "@/server/cardNews/projectStore";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const { id } = await context.params;
    const project = await getCardNewsProject(id, userId);
    if (!project) {
      return withCookie(NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }));
    }
    return withCookie(NextResponse.json({ project }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  const json = await req.json().catch(() => null);
  const parsed = CardNewsProjectWriteSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);
    const { id } = await context.params;
    const project = await updateCardNewsProject(id, userId, parsed.data);
    if (!project) {
      return withCookie(NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }));
    }
    return withCookie(NextResponse.json({ project }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
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
    const deleted = await deleteCardNewsProject(id, userId);
    if (deleted.count === 0) {
      return withCookie(NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }));
    }
    return withCookie(NextResponse.json({ ok: true }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
