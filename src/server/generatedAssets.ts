import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { getUploadDir, getUploadPublicUrl } from "@/server/uploadAssets";

function sanitizeAssetBaseName(value: string) {
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

export async function writeGeneratedAsset(args: {
  baseUrl: string;
  baseName: string;
  ext: string;
  bytes: Buffer;
}) {
  const uploadDir = getUploadDir();
  await mkdir(uploadDir, { recursive: true });

  const safeBaseName = sanitizeAssetBaseName(args.baseName) || `asset-${Date.now()}`;
  const ext = args.ext.startsWith(".") ? args.ext : `.${args.ext}`;
  const fileName = await resolveUniqueFileName(uploadDir, safeBaseName, ext);
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, args.bytes);

  return {
    fileName,
    filePath,
    url: getUploadPublicUrl(args.baseUrl, fileName),
    bytes: args.bytes.length,
  };
}
