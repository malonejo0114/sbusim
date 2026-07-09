import { NextResponse } from "next/server";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";

import { requireLocalApiKey } from "@/server/localApiAuth";
import { assertPublicMediaUrlReachable, normalizeUploadedMedia } from "@/server/publicMedia";
import { resolvePublicBaseUrl } from "@/server/publicBaseUrl";
import { getUploadDir, getUploadPublicUrl } from "@/server/uploadAssets";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB MVP guardrail

export const runtime = "nodejs";
export const maxDuration = 60;

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

type UploadInput = {
  bytes: Buffer;
  fileName: string;
  mimeType: string | null;
};

async function readMultipartUpload(req: Request): Promise<UploadInput> {
  const form = await req.formData();
  const file = form.get("file");
  const fileNameOverride = form.get("fileName");

  if (!(file instanceof File)) {
    throw new Error("file 필드는 필수입니다.");
  }
  if (fileNameOverride !== null && typeof fileNameOverride !== "string") {
    throw new Error("fileName은 문자열이어야 합니다.");
  }
  if (file.size <= 0) {
    throw new Error("빈 파일은 업로드할 수 없습니다.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`파일이 너무 큽니다. 현재 업로드 제한은 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB 입니다.`);
  }

  const fileName = fileNameOverride?.trim() || file.name;
  if (!fileName.trim()) {
    throw new Error("fileName을 확인할 수 없습니다.");
  }

  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName,
    mimeType: file.type || null,
  };
}

async function readJsonUpload(req: Request): Promise<UploadInput> {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    throw new Error("JSON 본문이 필요합니다.");
  }

  const { fileName, dataBase64 } = body as { fileName?: unknown; dataBase64?: unknown };
  if (typeof fileName !== "string" || fileName.trim().length === 0) {
    throw new Error("fileName은 필수 문자열입니다.");
  }
  if (typeof dataBase64 !== "string" || dataBase64.trim().length === 0) {
    throw new Error("dataBase64는 필수 문자열입니다.");
  }

  const parsed = parseBase64Payload(dataBase64);
  if (parsed.base64.length === 0) {
    throw new Error("빈 파일은 업로드할 수 없습니다.");
  }

  const bytes = Buffer.from(parsed.base64, "base64");
  if (bytes.length <= 0) {
    throw new Error("빈 파일은 업로드할 수 없습니다.");
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(`파일이 너무 큽니다. 현재 업로드 제한은 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB 입니다.`);
  }

  return {
    bytes,
    fileName: fileName.trim(),
    mimeType: parsed.mimeType,
  };
}

function parseBase64Payload(value: string) {
  const trimmed = value.trim();
  const dataUrlMatch = /^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(trimmed);
  const base64 = (dataUrlMatch ? dataUrlMatch[2] : trimmed).replace(/\s+/g, "");
  const mimeType = dataUrlMatch?.[1]?.trim().toLowerCase() || null;
  if (!/^[a-z0-9+/]*={0,2}$/i.test(base64) || base64.length % 4 === 1) {
    throw new Error("dataBase64 형식이 올바르지 않습니다.");
  }
  return { base64, mimeType };
}

async function readUploadInput(req: Request) {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    return readMultipartUpload(req);
  }
  if (contentType.includes("application/json")) {
    return readJsonUpload(req);
  }
  throw new Error("Content-Type은 multipart/form-data 또는 application/json이어야 합니다.");
}

function isValidationError(message: string) {
  return (
    message.includes("APP_BASE_URL") ||
    message.includes("공개 주소") ||
    message.includes("업로드한 이미지") ||
    message.includes("미디어 URL은") ||
    message.includes("미디어 공개 URL") ||
    message.includes("Content-Type") ||
    message.includes("Content-Type이") ||
    message.includes("파일") ||
    message.includes("file") ||
    message.includes("fileName") ||
    message.includes("dataBase64") ||
    message.includes("JSON 본문") ||
    message.includes("이미지") ||
    message.includes("영상")
  );
}

export async function POST(req: Request) {
  const authError = requireLocalApiKey(req);
  if (authError) return authError;

  try {
    const input = await readUploadInput(req);
    const normalized = await normalizeUploadedMedia({
      bytes: input.bytes,
      fileName: input.fileName,
      mimeType: input.mimeType,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    if (normalized.kind !== "image" && normalized.kind !== "video") {
      return NextResponse.json({ error: "이미지 또는 영상 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const ext = normalized.ext || extensionFrom(input.fileName);
    const baseFromUpload = sanitizeSeoBaseName(input.fileName);
    const baseName = baseFromUpload || `image-${Date.now()}`;
    const safeBase = baseName.length > 0 ? baseName : `image-${Date.now()}`;
    const uploadDir = getUploadDir();
    await mkdir(uploadDir, { recursive: true });
    const fileName = await resolveUniqueFileName(uploadDir, safeBase, ext);
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, normalized.bytes);

    const publicBaseUrl = resolvePublicBaseUrl(req);
    const url = getUploadPublicUrl(publicBaseUrl, fileName);
    await assertPublicMediaUrlReachable({ url, kind: normalized.kind });

    return NextResponse.json({
      ok: true,
      url,
      fileName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isValidationError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("Local upload failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "서버 에러가 발생했습니다." }, { status: 500 });
  }
}
