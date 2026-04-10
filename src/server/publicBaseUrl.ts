import { optionalEnv } from "@/server/env";
import { isPrivateOrLocalHostname } from "@/server/publicMedia";

export function getRequestOrigin(req: Request) {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  return host ? `${protocol}://${host}` : url.origin;
}

export function resolvePublicBaseUrl(req: Request) {
  const fromEnv = optionalEnv("APP_BASE_URL")?.trim();
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : getRequestOrigin(req);
  const url = new URL(raw);

  if (isPrivateOrLocalHostname(url.hostname)) {
    throw new Error(
      "이미지/영상 예약 발행에는 외부에서 접근 가능한 공개 주소가 필요합니다. .env 의 APP_BASE_URL을 실제 공개 도메인으로 설정하세요."
    );
  }

  return raw.replace(/\/+$/, "");
}
