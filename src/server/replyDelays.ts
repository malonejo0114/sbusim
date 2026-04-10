import { MediaType } from "@prisma/client";
import { optionalEnv } from "@/server/env";

function parseDelaySeconds(name: string, fallback: number) {
  const raw = Number(optionalEnv(name) ?? String(fallback));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(60 * 60, Math.floor(raw)));
}

export function defaultCommentDelaySeconds(mediaType: MediaType) {
  if (mediaType === MediaType.IMAGE || mediaType === MediaType.VIDEO) {
    return parseDelaySeconds("MEDIA_REPLY_DELAY_SECONDS", 180);
  }
  return parseDelaySeconds("TEXT_REPLY_DELAY_SECONDS", 0);
}

export function blockedCommentRetryDelayMs(commentDelaySeconds: number) {
  const retryDelaySeconds = parseDelaySeconds("COMMENT_BLOCKED_RETRY_DELAY_SECONDS", 600);
  return Math.max(commentDelaySeconds, retryDelaySeconds) * 1000;
}

export function isCommentActionBlockedError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("행동이 차단") ||
    (lower.includes("code:1") && lower.includes("subcode:2207051")) ||
    lower.includes("activity restricted")
  );
}
