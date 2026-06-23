import { NextResponse } from "next/server";
import { session, upsertUserById } from "@/server/session";
import { ensureSessionScope, sessionCookieOptions } from "@/server/sessionRequest";
import { buildThreadsDailyReport, createThreadsDailyReportWorkbookBuffer } from "@/server/threadsDailyReport";

function filenameFor(dateKst: string) {
  return `sbusim-threads-posts-${dateKst}.xlsx`;
}

export async function GET(req: Request) {
  const scope = await ensureSessionScope();
  const withCookie = (res: NextResponse) => {
    if (scope.setCookie) res.cookies.set(session.cookieName, scope.userId, sessionCookieOptions());
    return res;
  };

  try {
    await upsertUserById(scope.userId);
    const url = new URL(req.url);
    const dateKst = url.searchParams.get("date")?.trim() || undefined;
    const report = await buildThreadsDailyReport({ userId: scope.userId, userIds: scope.userIds, dateKst });
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
