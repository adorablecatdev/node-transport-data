const RETRY_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "node-transport-data/0.1 (+https://github.com/local)",
          Accept: "application/json",
        },
      });
      if (res.ok) return (await res.json()) as T;
      if (!RETRY_STATUSES.has(res.status)) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 500 * 2 ** (attempt - 1);
      console.warn(`[http] attempt ${attempt} failed for ${url}; retrying in ${backoff}ms`);
      await delay(backoff);
    }
  }
  throw lastError;
}

export async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "node-transport-data/0.1 (+https://github.com/local)",
          Accept: "text/csv, text/plain, */*",
        },
      });
      if (res.ok) return await res.text();
      if (!RETRY_STATUSES.has(res.status)) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 500 * 2 ** (attempt - 1);
      console.warn(`[http] attempt ${attempt} failed for ${url}; retrying in ${backoff}ms`);
      await delay(backoff);
    }
  }
  throw lastError;
}
