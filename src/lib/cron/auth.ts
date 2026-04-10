import { NextResponse } from "next/server";
import { requireEnv } from "@/server/env";

export function verifyCronRequest(req: Request) {
  const expected = requireEnv("CRON_SECRET");
  const incoming = req.headers.get("x-cron-secret");
  if (!incoming || incoming !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function parseIncludeSources(req: Request) {
  const url = new URL(req.url);
  const v = url.searchParams.get("includeSources");
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return undefined;
}
