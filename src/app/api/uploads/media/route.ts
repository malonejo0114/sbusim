import { NextResponse } from "next/server";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { ensureSessionUserId, sessionCookieOptions } from "@/server/sessionRequest";
import { session } from "@/server/session";
import { getUploadDir, getUploadPublicUrl } from "@/server/uploadAssets";
import { assertPublicMediaUrlReachable, normalizeUploadedMedia } from "@/server/publicMedia";
import { resolvePublicBaseUrl } from "@/server/publicBaseUrl";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB MVP guardrail
export const runtime = "nodejs";

function extensionFrom(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (!ext) return ".bin";
  return ext;
}

function sanitizeSeoBaseName(value: string) {
  const base = path.parse(value).name.trim().toLowerCase();
  const normalized = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return normalized.slice(0, 96);
}

async function resolveUniqueFileName(uploadDir: string, baseName: string, ext: string) {
  let candidate = `${baseName}${ext}`;
  let suffix = 1;
  while (true) {
    try {
      await access(path.join(uploadDir, candidate));
      candidate = `${baseName}-${suffix}${ext}`;
      suffix += 1;
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : undefined;
      if (code === "ENOENT") return candidate;
      throw err;
    }
    if (suffix > 1_000) {
      return candidate;
    }
  }
}

export async function POST(req: Request) {
  const { userId, setCookie } = await ensureSessionUserId();
  const withCookie = (res: NextResponse) => {
    if (setCookie) res.cookies.set(session.cookieName, userId, sessionCookieOptions());
    return res;
  };

  try {
    const form = await req.formData();
    const file = form.get("file");
    const seoFileName = form.get("seoFileName");
    if (!(file instanceof File)) {
      return withCookie(NextResponse.json({ error: "file is required" }, { status: 400 }));
    }
    if (seoFileName !== null && typeof seoFileName !== "string") {
      return withCookie(NextResponse.json({ error: "seoFileName must be a string" }, { status: 400 }));
    }

    if (file.size <= 0) {
      return withCookie(NextResponse.json({ error: "Empty file" }, { status: 400 }));
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return withCookie(
        NextResponse.json(
          { error: `파일이 너무 큽니다. 현재 업로드 제한은 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB 입니다.` },
          { status: 400 }
        )
      );
    }

    const normalized = await normalizeUploadedMedia({
      bytes: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type || null,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    const ext = normalized.ext || extensionFrom(file.name);
    const requestExt = seoFileName ? path.extname(seoFileName).toLowerCase() : "";
    if (requestExt && normalized.kind !== "image" && requestExt !== ext) {
      return withCookie(
        NextResponse.json({ error: "seoFileName 확장자는 업로드 파일 확장자와 같아야 합니다." }, { status: 400 })
      );
    }

    const baseFromSeo = seoFileName ? sanitizeSeoBaseName(seoFileName) : "";
    const baseFromUpload = sanitizeSeoBaseName(file.name);
    const baseName = baseFromSeo || baseFromUpload || `image-${Date.now()}`;
    const safeBase = baseName.length > 0 ? baseName : `image-${Date.now()}`;
    const uploadDir = getUploadDir();
    await mkdir(uploadDir, { recursive: true });
    const fileName = await resolveUniqueFileName(uploadDir, safeBase, ext);
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, normalized.bytes);

    const publicBaseUrl = resolvePublicBaseUrl(req);
    const url = getUploadPublicUrl(publicBaseUrl, fileName);
    if (normalized.kind === "image" || normalized.kind === "video") {
      await assertPublicMediaUrlReachable({ url, kind: normalized.kind });
    }
    return withCookie(
      NextResponse.json({
        url,
        fileName,
        bytes: normalized.bytes.length,
        mimeType: normalized.mimeType,
      })
    );
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    const status =
      details.includes("APP_BASE_URL") ||
      details.includes("공개 주소") ||
      details.includes("업로드한 이미지") ||
      details.includes("미디어 URL은") ||
      details.includes("미디어 공개 URL") ||
      details.includes("Content-Type")
        ? 400
        : 500;
    return withCookie(NextResponse.json({ error: details }, { status }));
  }
}
