import { access, readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getUploadFilePath, guessUploadContentType, isSafeUploadFileName } from "@/server/uploadAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileResponseHeaders(fileName: string, size: number, modifiedAt: Date) {
  return {
    "content-type": guessUploadContentType(fileName),
    "content-length": String(size),
    "cache-control": "public, max-age=31536000, immutable",
    "last-modified": modifiedAt.toUTCString(),
    "content-disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
    "x-content-type-options": "nosniff",
  };
}

async function resolveFile(fileName: string) {
  if (!isSafeUploadFileName(fileName)) {
    return null;
  }

  const filePath = getUploadFilePath(fileName);
  await access(filePath);
  const meta = await stat(filePath);
  if (!meta.isFile()) {
    return null;
  }

  return {
    filePath,
    size: meta.size,
    modifiedAt: meta.mtime,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ fileName: string }> }) {
  try {
    const { fileName } = await ctx.params;
    const resolved = await resolveFile(fileName);
    if (!resolved) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await readFile(resolved.filePath);
    return new NextResponse(body, {
      status: 200,
      headers: fileResponseHeaders(fileName, resolved.size, resolved.modifiedAt),
    });
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "File read failed" }, { status: 500 });
  }
}

export async function HEAD(_req: Request, ctx: { params: Promise<{ fileName: string }> }) {
  try {
    const { fileName } = await ctx.params;
    const resolved = await resolveFile(fileName);
    if (!resolved) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(null, {
      status: 200,
      headers: fileResponseHeaders(fileName, resolved.size, resolved.modifiedAt),
    });
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "ENOENT") {
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(null, { status: 500 });
  }
}
