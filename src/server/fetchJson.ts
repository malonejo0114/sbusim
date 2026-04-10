import { ProxyAgent } from "undici";

export class HttpError extends Error {
  status: number;
  url: string;
  bodyText?: string;

  constructor(args: { status: number; url: string; message: string; bodyText?: string }) {
    super(args.message);
    this.status = args.status;
    this.url = args.url;
    this.bodyText = args.bodyText;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function redactUrl(rawUrl: string) {
  try {
    const u = new URL(rawUrl);
    for (const key of ["access_token", "client_secret", "code", "key", "api_key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "REDACTED");
    }
    return u.toString();
  } catch {
    return rawUrl
      .replace(/access_token=[^&]+/gi, "access_token=REDACTED")
      .replace(/client_secret=[^&]+/gi, "client_secret=REDACTED")
      .replace(/code=[^&]+/gi, "code=REDACTED")
      .replace(/key=[^&]+/gi, "key=REDACTED")
      .replace(/api_key=[^&]+/gi, "api_key=REDACTED");
  }
}

function shouldRetry(status?: number) {
  if (!status) return true; // network error / timeout
  return status === 429 || (status >= 500 && status <= 599);
}

const proxyAgents = new Map<string, ProxyAgent>();

function getProxyAgent(proxyUrl?: string) {
  if (!proxyUrl) return undefined;
  const key = proxyUrl.trim();
  if (!key) return undefined;

  const existing = proxyAgents.get(key);
  if (existing) return existing;

  const agent = new ProxyAgent(key);
  proxyAgents.set(key, agent);
  return agent;
}

export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  opts?: { timeoutMs?: number; retries?: number; backoffMs?: number; proxyUrl?: string }
): Promise<{ status: number; json: T; text: string }> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const retries = opts?.retries ?? 3;
  const backoffMs = opts?.backoffMs ?? 400;
  const proxyAgent = getProxyAgent(opts?.proxyUrl);

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        ...(proxyAgent ? ({ dispatcher: proxyAgent } as Record<string, unknown>) : {}),
      });
      const text = await res.text();

      let json: T;
      try {
        json = text ? (JSON.parse(text) as T) : (undefined as T);
      } catch {
        // Not JSON; surface as error below.
        json = undefined as T;
      }

      if (!res.ok) {
        const safeUrl = redactUrl(url);
        const err = new HttpError({
          status: res.status,
          url: safeUrl,
          message: `HTTP ${res.status} for ${safeUrl}`,
          bodyText: text,
        });
        if (!shouldRetry(res.status) || attempt === retries) throw err;
        lastErr = err;
      } else {
        return { status: res.status, json, text };
      }
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : undefined;
      if (!shouldRetry(status) || attempt === retries) throw err;
    } finally {
      clearTimeout(timeout);
    }

    const jitter = Math.floor(Math.random() * 150);
    const delay = backoffMs * 2 ** attempt + jitter;
    await sleep(delay);
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
