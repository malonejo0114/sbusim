import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_HASH_PREFIX = "scrypt";
const PASSWORD_HASH_KEYLEN = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64");
  const hash = scryptSync(password, salt, PASSWORD_HASH_KEYLEN).toString("base64");
  return `${PASSWORD_HASH_PREFIX}:${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [prefix, salt, expectedBase64] = encoded.split(":");
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !expectedBase64) return false;

  const expected = Buffer.from(expectedBase64, "base64");
  const actual = scryptSync(password, salt, expected.length);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
