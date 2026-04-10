import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
  ".heic",
  ".heif",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".avi",
  ".mkv",
]);

type PublicMediaKind = "image" | "video";
type DetectedImageFormat = "png" | "jpeg" | "gif" | "webp";

export function isPrivateOrLocalHostname(hostname: string) {
  const lower = hostname.trim().toLowerCase();
  if (!lower) return true;
  if (lower === "localhost" || lower === "::1" || lower === "127.0.0.1" || lower.endsWith(".local")) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(lower)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(lower)) return true;
  return false;
}

export function isPublicMediaUrl(urlText: string) {
  try {
    const url = new URL(urlText);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (isPrivateOrLocalHostname(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function detectImageFormat(bytes: Uint8Array): DetectedImageFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x39 || bytes[4] === 0x37) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

function extForDetectedImage(format: DetectedImageFormat) {
  return format === "jpeg" ? ".jpg" : `.${format}`;
}

function mimeForDetectedImage(format: DetectedImageFormat) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

async function cancelBodyQuietly(res: Response) {
  try {
    await res.body?.cancel();
  } catch {}
}

export async function normalizeUploadedMedia(args: {
  bytes: Buffer;
  fileName: string;
  mimeType?: string | null;
  maxBytes?: number;
}): Promise<{
  bytes: Buffer;
  ext: string;
  mimeType: string | null;
  kind: PublicMediaKind | "other";
  width?: number;
  height?: number;
  normalized: boolean;
}> {
  const inputExt = path.extname(args.fileName).toLowerCase();
  const mimeType = args.mimeType?.trim().toLowerCase() || null;
  const detectedImage = detectImageFormat(args.bytes);
  const imageLike = Boolean(detectedImage) || Boolean(mimeType?.startsWith("image/")) || IMAGE_EXTENSIONS.has(inputExt);

  if (!imageLike) {
    const kind: PublicMediaKind | "other" =
      mimeType?.startsWith("video/") || VIDEO_EXTENSIONS.has(inputExt) ? "video" : "other";
    return {
      bytes: args.bytes,
      ext: inputExt || ".bin",
      mimeType,
      kind,
      normalized: false,
    };
  }

  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(args.bytes);
  } catch {
    throw new Error("업로드한 이미지 파일을 해석할 수 없습니다. PNG/JPEG처럼 일반적인 이미지 파일인지 확인하세요.");
  }

  const width = Math.round(image.width);
  const height = Math.round(image.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("업로드한 이미지의 가로/세로 크기를 확인할 수 없습니다.");
  }

  if (detectedImage === "png" || detectedImage === "jpeg") {
    return {
      bytes: args.bytes,
      ext: extForDetectedImage(detectedImage),
      mimeType: mimeForDetectedImage(detectedImage),
      kind: "image",
      width,
      height,
      normalized: false,
    };
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const normalizedBytes = canvas.toBuffer("image/png");
  if (args.maxBytes && normalizedBytes.length > args.maxBytes) {
    throw new Error("업로드한 이미지를 안전한 PNG로 변환했더니 용량이 너무 커졌습니다. 더 작은 PNG/JPEG 파일로 다시 시도하세요.");
  }

  return {
    bytes: normalizedBytes,
    ext: ".png",
    mimeType: "image/png",
    kind: "image",
    width,
    height,
    normalized: true,
  };
}

export async function assertPublicMediaUrlReachable(args: {
  url: string;
  kind: PublicMediaKind;
  timeoutMs?: number;
}) {
  if (!isPublicMediaUrl(args.url)) {
    throw new Error("미디어 URL은 외부에서 접근 가능한 공개 http(s) 주소여야 합니다.");
  }

  const expectedPrefix = args.kind === "image" ? "image/" : "video/";
  const timeoutMs = args.timeoutMs ?? 10_000;

  const request = async (method: "HEAD" | "GET") => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(args.url, {
        method,
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      const contentType = res.headers.get("content-type")?.trim().toLowerCase() || null;
      const contentLengthHeader = res.headers.get("content-length");
      const contentLength =
        contentLengthHeader && Number.isFinite(Number(contentLengthHeader)) ? Number(contentLengthHeader) : null;
      return {
        ok: res.ok,
        status: res.status,
        contentType,
        contentLength,
        response: res,
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  let probe = await request("HEAD").catch(() => null);
  if (!probe || !probe.ok || !probe.contentType) {
    if (probe) await cancelBodyQuietly(probe.response);
    probe = await request("GET");
  }

  try {
    if (!probe.ok) {
      throw new Error(`미디어 공개 URL 확인 실패 (HTTP ${probe.status})`);
    }
    if (!probe.contentType || !probe.contentType.startsWith(expectedPrefix)) {
      throw new Error(
        `${args.kind === "image" ? "이미지" : "영상"} 공개 URL의 Content-Type이 올바르지 않습니다. 현재 값: ${probe.contentType ?? "unknown"}`
      );
    }
    if (probe.contentLength !== null && probe.contentLength <= 0) {
      throw new Error("미디어 공개 URL의 파일 크기가 0으로 보입니다.");
    }
  } finally {
    await cancelBodyQuietly(probe.response);
  }
}
