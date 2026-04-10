import { NextResponse } from "next/server";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import {
  CardNewsProjectWriteSchema,
  createCardNewsProject,
  listCardNewsProjects,
} from "@/server/cardNews/projectStore";

export async function GET() {
  const { userId, setCookie } = await ensureSessionUserId();

  try {
    await upsertUserById(userId);
    const projects = await listCardNewsProjects(userId);
    const res = NextResponse.json({ projects });
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
  const parsed = CardNewsProjectWriteSchema.safeParse(json);
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }));
  }

  try {
    await upsertUserById(userId);
    const project = await createCardNewsProject(userId, parsed.data);
    return withCookie(NextResponse.json({ project }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
