function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; retries?: number; backoffMs?: number }
) {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const retries = opts?.retries ?? 3;
  const backoffMs = opts?.backoffMs ?? 500;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (res.ok) return res;

      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${url} ${body}`);
      }

      lastError = new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      const jitter = Math.floor(Math.random() * 100);
      await sleep(backoffMs * 2 ** attempt + jitter);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJsonWithRetry<T>(
  url: string,
  init?: RequestInit,
  opts?: { timeoutMs?: number; retries?: number; backoffMs?: number }
): Promise<T> {
  const res = await fetchWithRetry(url, init, opts);
  const text = await res.text();
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 400)}`);
  }
}
