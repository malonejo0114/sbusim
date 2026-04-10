import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "차트/뉴스 자동 생성 기능은 현재 비활성화되었습니다." }, { status: 410 });
}
