import { createHmac } from "node:crypto";
import { fetchJsonWithRetry, HttpError } from "@/server/fetchJson";
import { optionalEnv, requireEnv } from "@/server/env";

export type SearchAdAuthConfig = {
  baseUrl: string;
  accessKey: string;
  secretKey: string;
  customerId: string;
};

function firstEnv(...names: string[]) {
  for (const name of names) {
    const value = optionalEnv(name);
    if (value) return value;
  }
  return undefined;
}

export function getSearchAdConfig(): SearchAdAuthConfig {
  const baseUrl = optionalEnv("NAVER_SEARCHAD_API_BASE_URL")?.trim() || "https://api.searchad.naver.com";
  const accessKey =
    firstEnv("NAVER_SEARCHAD_API_KEY", "NAVER_AD_ACCESS", "NAVER_SEARCHAD_ACCESS_LICENSE") ??
    requireEnv("NAVER_SEARCHAD_API_KEY");
  const secretKey =
    firstEnv("NAVER_SEARCHAD_API_SECRET", "NAVER_AD_SECRET", "NAVER_SEARCHAD_SECRET_KEY") ??
    requireEnv("NAVER_SEARCHAD_API_SECRET");
  const customerId =
    firstEnv("NAVER_SEARCHAD_CUSTOMER_ID", "NAVER_AD_CUSTOMER", "NAVER_SEARCHAD_CUSTOMER") ??
    requireEnv("NAVER_SEARCHAD_CUSTOMER_ID");

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    accessKey,
    secretKey,
    customerId,
  };
}

export function buildSearchAdSignature(args: {
  secretKey: string;
  timestamp: string;
  method: string;
  requestUri: string;
}) {
  const message = `${args.timestamp}.${args.method.toUpperCase()}.${args.requestUri}`;
  return createHmac("sha256", args.secretKey).update(message).digest("base64");
}

export function buildSearchAdHeaders(args: {
  config: SearchAdAuthConfig;
  method: string;
  requestUri: string;
}) {
  const timestamp = String(Date.now());
  const signature = buildSearchAdSignature({
    secretKey: args.config.secretKey,
    timestamp,
    method: args.method,
    requestUri: args.requestUri,
  });

  return {
    "X-Timestamp": timestamp,
    "X-API-KEY": args.config.accessKey,
    "X-Customer": args.config.customerId,
    "X-Signature": signature,
  };
}

export function buildSearchAdUrl(baseUrl: string, requestUri: string, query?: Record<string, string | number | undefined>) {
  const url = new URL(baseUrl.replace(/\/+$/, "") + requestUri);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function searchAdRequestJson<T>(args: {
  method: "GET" | "POST";
  requestUri: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}) {
  const config = getSearchAdConfig();
  const url = buildSearchAdUrl(config.baseUrl, args.requestUri, args.query);
  const headers = buildSearchAdHeaders({ config, method: args.method, requestUri: args.requestUri });
  const init: RequestInit = {
    method: args.method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (args.body !== undefined) {
    init.body = JSON.stringify(args.body);
  }

  const result = await fetchJsonWithRetry<T>(url.toString(), init, {
    timeoutMs: args.timeoutMs,
    retries: args.retries,
  }).catch((err) => {
    if (err instanceof HttpError) {
      throw new Error(
        `SearchAd API 요청 실패 (HTTP ${err.status})${err.bodyText ? `: ${err.bodyText}` : ""}`
      );
    }
    throw err;
  });

  return result.json;
}
