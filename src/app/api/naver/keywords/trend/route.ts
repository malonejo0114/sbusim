import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { fetchNaverTrend } from "@/server/naver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    keywords: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
    groups: z
      .array(
        z.object({
          groupName: z.string().trim().min(1).optional(),
          keywords: z.array(z.string().trim().min(1)).min(1).max(20),
        })
      )
      .min(1)
      .max(5)
      .optional(),
    startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    timeUnit: z.enum(["date", "week", "month"]),
    device: z.enum(["pc", "mo"]).optional(),
    gender: z.enum(["m", "f"]).optional(),
    ages: z.array(z.string().trim().min(1)).min(1).max(11).optional(),
  })
  .strict();

function withCookie(res: NextResponse, userId: string, setCookie: boolean) {
  if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
  return res;
}

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function buildGroups(input: z.infer<typeof BodySchema>) {
  if (input.groups && input.groups.length > 0) {
    return input.groups.map((group, index) => ({
      groupName: group.groupName?.trim() || `group-${index + 1}`,
      keywords: group.keywords,
    }));
  }
  const keywords = input.keywords ?? [];
  return keywords.map((keyword, index) => ({
    groupName: keyword || `group-${index + 1}`,
    keywords: [keyword],
  }));
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  try {
    await upsertUserById(userId);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }), userId, setCookie);
    }

    const payload = parsed.data;
    const groups = buildGroups(payload);
    if (groups.length === 0) {
      return withCookie(NextResponse.json({ error: "keywords is required" }, { status: 400 }), userId, setCookie);
    }

    const result = await fetchNaverTrend({
      groups,
      startDate: payload.startDate,
      endDate: payload.endDate,
      timeUnit: payload.timeUnit,
      device: payload.device,
      gender: payload.gender,
      ages: payload.ages,
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
    const keywordParams = url.searchParams.get("keywords")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    const groupsJson = url.searchParams.get("groups");
    const payload: z.infer<typeof BodySchema> = {
      startDate: url.searchParams.get("startDate") ?? "",
      endDate: url.searchParams.get("endDate") ?? "",
      timeUnit: (url.searchParams.get("timeUnit") ?? "week") as "date" | "week" | "month",
      device: (url.searchParams.get("device") ?? undefined) as "pc" | "mo" | undefined,
      gender: (url.searchParams.get("gender") ?? undefined) as "m" | "f" | undefined,
      ages: url.searchParams.get("ages")?.split(",").map((item) => item.trim()).filter(Boolean),
      keywords: keywordParams.length ? keywordParams : undefined,
      groups: undefined,
    };

    if (groupsJson) {
      try {
        payload.groups = JSON.parse(groupsJson) as Array<{ groupName?: string; keywords: string[] }>;
      } catch {
        return withCookie(NextResponse.json({ error: "groups must be valid JSON" }, { status: 400 }), userId, setCookie);
      }
    }

    const parsed = BodySchema.safeParse(payload);
    if (!parsed.success) {
      return withCookie(NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }), userId, setCookie);
    }

    const result = await fetchNaverTrend({
      groups: buildGroups(parsed.data),
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      timeUnit: parsed.data.timeUnit,
      device: parsed.data.device,
      gender: parsed.data.gender,
      ages: parsed.data.ages,
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
