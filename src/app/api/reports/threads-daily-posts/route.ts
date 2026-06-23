import { NextResponse } from "next/server";
import { session, upsertUserById } from "@/server/session";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { buildThreadsDailyReport, createThreadsDailyReportWorkbookBuffer } from "@/server/threadsDailyReport";

function filenameFor(dateKst: string) {
  return `sbusim-threads-posts-${dateKst}.xlsx`;
}

export async function GET(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(userId);
    const url = new URL(req.url);
    const dateKst = url.searchParams.get("date")?.trim() || undefined;
    const report = await buildThreadsDailyReport({ userId, dateKst });
    const workbook = createThreadsDailyReportWorkbookBuffer({
      dateKst: report.dateKst,
      rows: report.rows,
      errors: report.errors,
    });

    return withCookie(
      new NextResponse(new Uint8Array(workbook), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filenameFor(report.dateKst)}"`,
          "Cache-Control": "no-store",
        },
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withCookie(NextResponse.json({ error: message }, { status: 500 }));
  }
}
