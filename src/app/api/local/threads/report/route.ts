import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { isLocalApiValidationMessage, requireLocalApiKey } from "@/server/localApiAuth";
import { syncScheduledPostInsightsById } from "@/server/insights";
import { findLocalInsightSyncTargets, queryLocalThreadsPosts } from "@/server/localThreadsPosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type ReportBody = {
  date?: unknown;
  owners?: unknown;
  accounts?: unknown;
  format?: unknown;
  includeThreadUrl?: unknown;
  syncInsights?: unknown;
};

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function validateDate(date: unknown) {
  if (typeof date !== "string" || !date.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    throw new Error("date는 YYYY-MM-DD 형식이어야 합니다.");
  }
  return date.trim();
}

function validateStringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field}는 문자열 배열이어야 합니다.`);
  }
  const normalized = value.map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function validateBoolean(value: unknown, field: string, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${field}는 boolean이어야 합니다.`);
  return value;
}

function validateFormat(value: unknown) {
  if (value === undefined) return "xlsx";
  if (value === "xlsx" || value === "json") return value;
  throw new Error("format은 xlsx 또는 json이어야 합니다.");
}

async function readBody(req: Request): Promise<ReportBody> {
  try {
    return (await req.json()) as ReportBody;
  } catch {
    throw new Error("JSON 본문을 해석하지 못했습니다.");
  }
}

async function syncInsightsForDate(args: { date: string; owners?: string[]; accounts?: string[] }) {
  const targets = await findLocalInsightSyncTargets(args);
  for (let index = 0; index < targets.length; index += 4) {
    const chunk = targets.slice(index, index + 4);
    await Promise.all(
      chunk.map(async (target) => {
        try {
          await syncScheduledPostInsightsById(target.id);
        } catch (err) {
          console.error("Local Threads report insight sync failed", {
            postId: target.id,
            message: errorMessage(err),
          });
        }
      })
    );
  }
}

function createWorkbookBuffer(args: {
  dateKst: string;
  includeThreadUrl: boolean;
  posts: Awaited<ReturnType<typeof queryLocalThreadsPosts>>["posts"];
}) {
  const header = [
    "소유자",
    "계정",
    "핸들",
    "구분",
    "상태",
    "기준시각(KST)",
    "예약시각(KST)",
    "발행시각(KST)",
    "미디어",
    "본문",
    "타래/댓글",
    "원격ID",
    "스레드 링크",
    "조회",
    "좋아요",
    "답글",
    "리포스트",
    "인용",
    "오류",
    "미디어URL",
  ];

  const rows = [
    header,
    ...args.posts.map((post) => [
      post.owner,
      post.accountName,
      post.threadsUsername ?? "",
      post.source,
      post.status,
      post.publishedAtKst ?? post.scheduledAtKst ?? "",
      post.scheduledAtKst ?? "",
      post.publishedAtKst ?? "",
      post.mediaType,
      post.text,
      post.replies.map((reply) => `${reply.orderIndex}) ${reply.text}`).join("\n"),
      post.remotePostId ?? "",
      args.includeThreadUrl ? post.threadUrl ?? "" : "",
      post.viewsCount,
      post.likesCount,
      post.repliesCount,
      post.repostsCount,
      post.quotesCount,
      post.lastError ?? "",
      post.mediaUrl ?? "",
    ]),
  ];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 12 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    { wch: 48 },
    { wch: 36 },
    { wch: 28 },
    { wch: 44 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 36 },
    { wch: 44 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, args.dateKst);

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
}

export async function POST(req: Request) {
  const denied = requireLocalApiKey(req);
  if (denied) return denied;

  try {
    const body = await readBody(req);
    const date = validateDate(body.date);
    const owners = validateStringArray(body.owners, "owners");
    const accounts = validateStringArray(body.accounts, "accounts");
    const format = validateFormat(body.format);
    const includeThreadUrl = validateBoolean(body.includeThreadUrl, "includeThreadUrl", true);
    const shouldSyncInsights = validateBoolean(body.syncInsights, "syncInsights", false);

    if (shouldSyncInsights) await syncInsightsForDate({ date, owners, accounts });

    const result = await queryLocalThreadsPosts({ date, owners, accounts });
    if (format === "json") return NextResponse.json(result);

    const workbook = createWorkbookBuffer({
      dateKst: result.dateKst,
      includeThreadUrl,
      posts: result.posts,
    });

    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="sbusim-threads-posts-${result.dateKst}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = errorMessage(err);
    if (isLocalApiValidationMessage(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Local Threads report API failed", { message });
    return NextResponse.json({ error: "서버 에러가 발생했습니다." }, { status: 500 });
  }
}
