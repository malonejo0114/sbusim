import { fetchJsonWithRetry, HttpError } from "@/server/fetchJson";
import { optionalEnv, requireEnv } from "@/server/env";

type TokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type PostEngagement = {
  viewsCount: number;
  likesCount: number;
  repliesCount: number;
  repostsCount: number;
  quotesCount: number;
  raw: unknown;
};

type GraphErrorShape = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
    is_transient?: boolean;
  };
};

function graphBaseUrl() {
  const base = optionalEnv("THREADS_GRAPH_BASE_URL") ?? "https://graph.threads.net";
  return base.replace(/\/+$/, "");
}

function toUrl(path: string, params?: Record<string, string | undefined>) {
  const url = new URL(graphBaseUrl() + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  return url;
}

function parseMaybeGraphErrorBody(bodyText?: string) {
  if (!bodyText) return undefined;
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

function graphErrorSummary(bodyText?: string) {
  const parsed = parseMaybeGraphErrorBody(bodyText);
  if (!parsed || typeof parsed === "string") {
    return { summary: typeof parsed === "string" ? parsed : undefined, code: undefined as number | undefined };
  }

  const graph = parsed as GraphErrorShape;
  const e = graph.error;
  if (!e) {
    return { summary: JSON.stringify(parsed), code: undefined as number | undefined };
  }

  const parts = [
    e.message,
    e.error_user_title ? `[${e.error_user_title}]` : undefined,
    e.error_user_msg,
    e.code !== undefined ? `(code:${e.code})` : undefined,
    e.error_subcode !== undefined ? `(subcode:${e.error_subcode})` : undefined,
  ].filter(Boolean);

  return {
    summary: parts.join(" "),
    code: e.code,
    subcode: e.error_subcode,
    fbtraceId: e.fbtrace_id,
  };
}

function isApiAccessBlocked(detail: ReturnType<typeof graphErrorSummary>) {
  const summary = (detail.summary ?? "").toLowerCase();
  return detail.code === 200 || summary.includes("api access blocked");
}

function blockedMessage(actionLabel: string, detail: ReturnType<typeof graphErrorSummary>) {
  const trace = detail.fbtraceId ? ` [trace:${detail.fbtraceId}]` : "";
  return `Threads API 접근이 차단되어 ${actionLabel}할 수 없습니다. Meta 앱 상태/권한/테스터 수락을 확인 후 계정을 다시 연결하세요.${trace}`;
}

function permissionMessage(permission: string, detail: ReturnType<typeof graphErrorSummary>, context?: string) {
  const trace = detail.fbtraceId ? ` [trace:${detail.fbtraceId}]` : "";
  const suffix = context ? ` ${context}` : "";
  return `Threads 권한이 없습니다. ${permission} 권한을 추가한 뒤 계정을 다시 연결하세요.${suffix}${trace}`;
}

function summarizeMediaUrl(raw?: string) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return raw;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

function readMetricValue(item: Record<string, unknown>) {
  const direct = toInt(item?.value);
  if (direct > 0) return direct;

  const totalValue = item?.total_value;
  if (totalValue && typeof totalValue === "object") {
    const total = toInt((totalValue as Record<string, unknown>)?.value);
    if (total > 0) return total;
  }

  const values = Array.isArray(item?.values) ? (item.values as Array<Record<string, unknown>>) : [];
  for (let idx = values.length - 1; idx >= 0; idx -= 1) {
    const parsed = toInt(values[idx]?.value);
    if (parsed > 0) return parsed;
  }

  return 0;
}

export async function exchangeCodeForShortLivedToken(args: {
  code: string;
  redirectUri: string;
  proxyUrl?: string;
}): Promise<{ accessToken: string; expiresInSeconds?: number }> {
  const clientId = requireEnv("THREADS_APP_ID");
  const clientSecret = requireEnv("THREADS_APP_SECRET");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
    code: args.code,
  });

  const { json, text } = await fetchJsonWithRetry<TokenResponse>(
    toUrl("/oauth/access_token").toString(),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    { proxyUrl: args.proxyUrl }
  );

  if (!json?.access_token) {
    throw new Error(`Unexpected token response: ${text}`);
  }

  return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
}

export async function exchangeShortLivedForLongLivedToken(args: {
  shortLivedAccessToken: string;
  proxyUrl?: string;
}): Promise<{ accessToken: string; expiresInSeconds?: number }> {
  const clientSecret = requireEnv("THREADS_APP_SECRET");

  const url = toUrl("/access_token", {
    grant_type: "th_exchange_token",
    client_secret: clientSecret,
    access_token: args.shortLivedAccessToken,
  });

  const { json, text } = await fetchJsonWithRetry<TokenResponse>(
    url.toString(),
    { method: "GET" },
    { proxyUrl: args.proxyUrl }
  );
  if (!json?.access_token) {
    throw new Error(`Unexpected long-lived token response: ${text}`);
  }

  return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
}

export async function refreshLongLivedToken(args: {
  accessToken: string;
  proxyUrl?: string;
}): Promise<{ accessToken: string; expiresInSeconds?: number }> {
  const url = toUrl("/refresh_access_token", {
    grant_type: "th_refresh_token",
    access_token: args.accessToken,
  });

  const { json, text } = await fetchJsonWithRetry<TokenResponse>(
    url.toString(),
    { method: "GET" },
    { proxyUrl: args.proxyUrl }
  );
  if (!json?.access_token) {
    throw new Error(`Unexpected refresh token response: ${text}`);
  }

  return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
}

export async function getThreadsMe(args: {
  accessToken: string;
  proxyUrl?: string;
}): Promise<{ id?: string; username?: string }> {
  const url = toUrl("/me", {
    fields: "id,username",
    access_token: args.accessToken,
  });

  try {
    const { json } = await fetchJsonWithRetry<{ id?: string; username?: string }>(
      url.toString(),
      { method: "GET" },
      { proxyUrl: args.proxyUrl }
    );
    return json ?? {};
  } catch (err) {
    // Not strictly required for publishing; treat as best-effort.
    if (err instanceof HttpError) {
      const details = parseMaybeGraphErrorBody(err.bodyText);
      console.warn("Threads /me lookup failed:", err.status, details);
      return {};
    }
    console.warn("Threads /me lookup failed:", err);
    return {};
  }
}

export async function getUserFollowersCount(args: {
  accessToken: string;
  threadsUserId: string;
  proxyUrl?: string;
}): Promise<{ followersCount: number; raw: unknown }> {
  const url = toUrl(`/${encodeURIComponent(args.threadsUserId)}/threads_insights`, {
    access_token: args.accessToken,
    metric: "followers_count",
    period: "day",
  });

  try {
    const { json } = await fetchJsonWithRetry<Record<string, unknown>>(
      url.toString(),
      { method: "GET" },
      { proxyUrl: args.proxyUrl }
    );
    const data = Array.isArray(json?.data) ? (json.data as Array<Record<string, unknown>>) : [];
    const followersMetric =
      data.find((item) => {
        const name = typeof item?.name === "string" ? item.name : "";
        return name === "followers_count" || name === "follower_count";
      }) ?? data[0];
    const followersCount = followersMetric ? readMetricValue(followersMetric) : 0;
    return { followersCount, raw: json };
  } catch (err) {
    if (err instanceof HttpError) {
      const detail = graphErrorSummary(err.bodyText);
      if (isApiAccessBlocked(detail)) {
        throw new Error(blockedMessage("팔로워 지표 조회", detail));
      }
      if (detail.code === 10) {
        throw new Error("Threads 팔로워 인사이트 권한이 없습니다. threads_manage_insights 권한을 확인하세요.");
      }
      throw new Error(
        `Threads 팔로워 지표 조회 실패 (HTTP ${err.status})${detail.summary ? `: ${detail.summary}` : ""}${
          detail.fbtraceId ? ` [trace:${detail.fbtraceId}]` : ""
        }`
      );
    }
    throw err;
  }
}

export async function createContainer(args: {
  accessToken: string;
  mediaType: "TEXT" | "IMAGE" | "VIDEO";
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  replyToId?: string;
  proxyUrl?: string;
}): Promise<{ creationId: string }> {
  const url = toUrl("/me/threads", {
    access_token: args.accessToken,
    media_type: args.mediaType,
    text: args.text,
    image_url: args.imageUrl,
    video_url: args.videoUrl,
    reply_to_id: args.replyToId,
  });

  let json: { id?: string } | undefined;
  let text = "";
  try {
    const result = await fetchJsonWithRetry<{ id?: string }>(
      url.toString(),
      { method: "POST" },
      { proxyUrl: args.proxyUrl }
    );
    json = result.json;
    text = result.text;
  } catch (err) {
    if (err instanceof HttpError) {
      const detail = graphErrorSummary(err.bodyText);
      if (isApiAccessBlocked(detail)) {
        throw new Error(blockedMessage("게시물 생성", detail));
      }
      if (detail.code === 10) {
        if (args.replyToId) {
          throw new Error(
            permissionMessage(
              "threads_manage_replies",
              detail,
              "댓글/답글 발행에는 Reply Management 권한이 필요합니다."
            )
          );
        }
        throw new Error(permissionMessage("threads_content_publish", detail));
      }
      if (args.mediaType === "IMAGE" || args.mediaType === "VIDEO") {
        const mediaLabel = args.mediaType === "IMAGE" ? "이미지" : "영상";
        const mediaUrl = summarizeMediaUrl(args.mediaType === "IMAGE" ? args.imageUrl : args.videoUrl);
        const trace = detail.fbtraceId ? ` [trace:${detail.fbtraceId}]` : "";
        throw new Error(
          `Threads ${mediaLabel} container create failed (HTTP ${err.status})${
            detail.summary ? `: ${detail.summary}` : ""
          }${mediaUrl ? ` [media:${mediaUrl}]` : ""} 공개 URL, Content-Type, 외부 접근 가능 여부를 확인하세요.${trace}`
        );
      }
      throw new Error(
        `Threads container create failed (HTTP ${err.status})${detail.summary ? `: ${detail.summary}` : ""}${
          detail.fbtraceId ? ` [trace:${detail.fbtraceId}]` : ""
        }`
      );
    }
    throw err;
  }

  if (!json?.id) {
    throw new Error(`Unexpected container response: ${text}`);
  }
  return { creationId: json.id };
}

export async function publishContainer(args: {
  accessToken: string;
  creationId: string;
  proxyUrl?: string;
}): Promise<{ id: string }> {
  const maxAttempts = 5;
  let lastDetail: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = toUrl("/me/threads_publish", {
      access_token: args.accessToken,
      creation_id: args.creationId,
    });

    try {
      const { json, text } = await fetchJsonWithRetry<{ id?: string }>(
        url.toString(),
        { method: "POST" },
        { proxyUrl: args.proxyUrl }
      );

      if (!json?.id) {
        throw new Error(`Unexpected publish response: ${text}`);
      }
      return { id: json.id };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;

      const detail = graphErrorSummary(err.bodyText);
      if (isApiAccessBlocked(detail)) {
        throw new Error(blockedMessage("게시물 발행", detail));
      }
      if (detail.code === 10) {
        throw new Error(permissionMessage("threads_content_publish", detail));
      }
      lastDetail = detail.summary;

      const message = (detail.summary ?? "").toLowerCase();
      const isNotReady =
        err.status === 400 &&
        (message.includes("not ready") ||
          message.includes("processing") ||
          message.includes("does not exist") ||
          message.includes("media") ||
          (detail.code === 24 && detail.subcode === 4279009) ||
          detail.subcode === 2207027);

      if (isNotReady && attempt < maxAttempts) {
        await sleep(900 * attempt);
        continue;
      }

      throw new Error(
        `Threads publish failed (HTTP ${err.status})${detail.summary ? `: ${detail.summary}` : ""}`
      );
    }
  }

  if (lastDetail) {
    throw new Error(`Threads publish failed after retries: ${lastDetail}`);
  }
  throw new Error("Threads publish failed after retries");
}

export async function getPostEngagement(args: {
  accessToken: string;
  postId: string;
  proxyUrl?: string;
}): Promise<PostEngagement> {
  const insightUrl = toUrl(`/${encodeURIComponent(args.postId)}/insights`, {
    access_token: args.accessToken,
    metric: "views,likes,replies,reposts,quotes",
  });

  try {
    const { json } = await fetchJsonWithRetry<Record<string, unknown>>(
      insightUrl.toString(),
      { method: "GET" },
      { proxyUrl: args.proxyUrl }
    );

    const data = Array.isArray(json?.data) ? (json.data as Array<Record<string, unknown>>) : [];
    const metricMap = new Map<string, number>();
    for (const item of data) {
      const name = typeof item?.name === "string" ? item.name : "";
      const directValue = toInt(item?.value);
      if (directValue > 0) {
        metricMap.set(name, directValue);
        continue;
      }

      const values = Array.isArray(item?.values) ? (item.values as Array<Record<string, unknown>>) : [];
      if (values.length > 0) {
        metricMap.set(name, toInt(values[0]?.value));
      } else {
        metricMap.set(name, 0);
      }
    }
    return {
      viewsCount: metricMap.get("views") ?? 0,
      likesCount: metricMap.get("likes") ?? 0,
      repliesCount: metricMap.get("replies") ?? 0,
      repostsCount: metricMap.get("reposts") ?? 0,
      quotesCount: metricMap.get("quotes") ?? 0,
      raw: json,
    };
  } catch (err) {
    if (err instanceof HttpError) {
      const detail = graphErrorSummary(err.bodyText);
      if (isApiAccessBlocked(detail)) {
        throw new Error(blockedMessage("인사이트 조회", detail));
      }
      // code 10 is the typical "permission denied" response.
      if (detail.code === 10) {
        throw new Error(
          `Threads 인사이트 권한이 없습니다. threads_manage_insights 권한 추가 후 계정을 다시 연결하세요.`
        );
      }
      if (detail.code === 100 && detail.subcode === 33) {
        throw new Error(
          `Threads 인사이트 조회 대상 게시물을 찾을 수 없습니다 (삭제/비공개/권한 범위 외).${
            detail.fbtraceId ? ` [trace:${detail.fbtraceId}]` : ""
          }`
        );
      }
      throw new Error(
        `Threads insights 조회 실패 (HTTP ${err.status})${detail.summary ? `: ${detail.summary}` : ""}${
          detail.fbtraceId ? ` [trace:${detail.fbtraceId}]` : ""
        }`
      );
    }
    throw err;
  }
}
