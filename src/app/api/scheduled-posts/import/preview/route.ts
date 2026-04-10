import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session, upsertUserById } from "@/server/session";
import { parseExcelForScheduledPosts } from "@/server/scheduledImport";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const runtime = "nodejs";
const MIN_FUTURE_BUFFER_MS = 60 * 1000;

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createSeededRng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIntBetween(rng: () => number, min: number, max: number) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

function isTooOld(date: Date) {
  return date.getTime() < Date.now() + MIN_FUTURE_BUFFER_MS;
}

function autoAssignSchedules<T extends { rowNumber: number; threadsAccountId: string; scheduledAtIso: string | null }>(
  items: T[],
  opts: {
    startAt: Date;
    minGapMinutes: number;
    maxGapMinutes: number;
  }
) {
  const minGap = clampInt(opts.minGapMinutes, 1, 24 * 60);
  const maxGap = clampInt(opts.maxGapMinutes, minGap, 24 * 60);
  const byAccount = new Map<string, number[]>();

  for (let i = 0; i < items.length; i += 1) {
    const accountId = items[i].threadsAccountId;
    const list = byAccount.get(accountId) ?? [];
    list.push(i);
    byAccount.set(accountId, list);
  }

  const assigned = new Array<string>(items.length);
  let accountIndex = 0;
  for (const [accountId, indices] of byAccount) {
    indices.sort((a, b) => items[a].rowNumber - items[b].rowNumber);
    const rng = createSeededRng(`${accountId}:${opts.startAt.toISOString()}`);
    let cursor = new Date(opts.startAt.getTime() + accountIndex * 2 * 60 * 1000);

    for (const idx of indices) {
      assigned[idx] = cursor.toISOString();
      const gap = randomIntBetween(rng, minGap, maxGap);
      cursor = new Date(cursor.getTime() + gap * 60 * 1000);
    }
    accountIndex += 1;
  }

  return assigned;
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);

    const form = await req.formData();
    const file = form.get("file");
    const timeMode = (form.get("timeMode")?.toString().trim().toLowerCase() ?? "sheet") === "auto" ? "auto" : "sheet";
    const startAtRaw = form.get("startAtIso")?.toString().trim() ?? "";
    const minGapRaw = Number(form.get("minGapMinutes")?.toString() ?? "45");
    const maxGapRaw = Number(form.get("maxGapMinutes")?.toString() ?? "90");
    if (!(file instanceof File)) {
      return withCookie(NextResponse.json({ error: "file is required" }, { status: 400 }));
    }
    if (file.size <= 0) {
      return withCookie(NextResponse.json({ error: "엑셀 파일이 비어 있습니다." }, { status: 400 }));
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return withCookie(
        NextResponse.json({ error: `파일이 너무 큽니다. 최대 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` }, { status: 400 })
      );
    }

    const accounts = await prisma.threadsAccount.findMany({
      where: { userId },
      select: { id: true, label: true, threadsUsername: true, threadsUserId: true },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (accounts.length === 0) {
      return withCookie(NextResponse.json({ error: "연결된 Threads 계정이 없습니다." }, { status: 400 }));
    }

    const parsed = parseExcelForScheduledPosts(Buffer.from(await file.arrayBuffer()), accounts, {
      allowEmptyScheduledAt: timeMode === "auto",
    });

    let items = parsed.items;
    let validItems = parsed.validItems;
    if (timeMode === "auto") {
      const startAt = new Date(startAtRaw);
      if (Number.isNaN(startAt.getTime())) {
        return withCookie(NextResponse.json({ error: "자동 배정 시작 시각이 올바르지 않습니다." }, { status: 400 }));
      }
      if (isTooOld(startAt)) {
        return withCookie(
          NextResponse.json({ error: "자동 배정 시작 시각은 현재 시각보다 최소 1분 이후여야 합니다." }, { status: 400 })
        );
      }
      const minGap = clampInt(minGapRaw, 1, 24 * 60);
      const maxGap = clampInt(maxGapRaw, minGap, 24 * 60);
      const assigned = autoAssignSchedules(validItems, {
        startAt,
        minGapMinutes: minGap,
        maxGapMinutes: maxGap,
      });

      const key = (rowNumber: number, accountId: string) => `${rowNumber}:${accountId}`;
      const assignedMap = new Map<string, string>();
      validItems = validItems.map((item, idx) => {
        const scheduledAtIso = assigned[idx] ?? item.scheduledAtIso ?? null;
        if (scheduledAtIso) assignedMap.set(key(item.rowNumber, item.threadsAccountId), scheduledAtIso);
        return {
          ...item,
          scheduledAtIso,
        };
      });
      items = items.map((item) => {
        if (!item.accountId || item.errors.length > 0) return item;
        const assignedIso = assignedMap.get(key(item.rowNumber, item.accountId));
        if (!assignedIso) return item;
        return {
          ...item,
          scheduledAtIso: assignedIso,
          errors:
            assignedIso && isTooOld(new Date(assignedIso))
              ? [...item.errors, "자동 배정 결과가 현재보다 과거입니다. 시작 시각을 다시 확인하세요."]
              : item.errors,
        };
      });
    }

    return withCookie(
      NextResponse.json({
        preview: {
          sheetName: parsed.sheetName,
          totalRows: parsed.totalRows,
          validRows: parsed.validRows,
          invalidRows: parsed.invalidRows,
          byAccount: parsed.byAccount,
          items,
          validItems,
          timeMode,
        },
      })
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error }, { status: 500 }));
  }
}
