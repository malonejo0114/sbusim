import path from "node:path";

const MIME_TYPE_BY_EXT: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
};

export function getUploadDir() {
  return path.join(process.cwd(), "public", "uploads");
}

export function isSafeUploadFileName(fileName: string) {
  return (
    fileName.length > 0 &&
    fileName === path.basename(fileName) &&
    !fileName.includes("\0") &&
    !fileName.includes("..")
  );
}

export function getUploadFilePath(fileName: string) {
  return path.join(getUploadDir(), fileName);
}

export function getUploadPublicPath(fileName: string) {
  return `/uploads/${encodeURIComponent(fileName)}`;
}

export function getUploadPublicUrl(baseUrl: string, fileName: string) {
  return `${baseUrl.replace(/\/+$/, "")}${getUploadPublicPath(fileName)}`;
}

export function guessUploadContentType(fileName: string, fallback = "application/octet-stream") {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_TYPE_BY_EXT[ext] ?? fallback;
}
