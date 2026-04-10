import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron/auth";

export async function GET(req: Request) {
  const blocked = verifyCronRequest(req);
  if (blocked) return blocked;
  return NextResponse.json({ error: "차트/뉴스 자동 생성 기능은 현재 비활성화되었습니다." }, { status: 410 });
}
