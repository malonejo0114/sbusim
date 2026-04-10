import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST() {
  return NextResponse.json({
    url: "https://threads.net",
    confirmation_code: crypto.randomUUID(),
  });
}

