import crypto from "node:crypto";
import { requireEnv } from "@/server/env";

function getKey(): Buffer {
  const raw = requireEnv("ENCRYPTION_KEY").trim();

  // Allow hex (64 chars) or base64 (recommended).
  const key =
    /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use: openssl rand -base64 32`
    );
  }
  return key;
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // v1:<iv_b64>:<tag_b64>:<cipher_b64>
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

export function decryptString(payload: string): string {
  const key = getKey();
  const [v, ivB64, tagB64, ctB64] = payload.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

