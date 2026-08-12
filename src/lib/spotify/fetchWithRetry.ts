/**
 * Shared Spotify Web API GET retry helper.
 *
 * Intermittent 502/503/504 Bad Gateway responses from `api.spotify.com`
 * (and reverse proxies) are retried with exponential backoff.
 */

export type SpotifyFetchRetryOptions = {
  /** Maximum attempts including the first try (default 3). */
  maxAttempts?: number;
  /** Initial delay in ms before the first retry (default 250). */
  baseDelayMs?: number;
  /** Abort signal forwarded to each attempt. */
  signal?: AbortSignal;
};

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * `fetch` wrapper for Spotify GETs with up to 3 attempts and exponential backoff.
 * Non-retryable HTTP statuses and non-network successes are returned as-is.
 */
export async function fetchSpotifyGetWithRetry(
  input: string | URL,
  init?: RequestInit,
  options?: SpotifyFetchRetryOptions,
): Promise<Response> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 250);
  const signal = options?.signal ?? init?.signal ?? undefined;

  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const response = await fetch(input, {
        ...init,
        method: init?.method ?? "GET",
        signal,
      });
      lastResponse = response;

      if (response.ok || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }

      if (attempt >= maxAttempts) return response;

      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[spotify/fetchWithRetry] ${response.status} on attempt ${attempt}/${maxAttempts}; retrying in ${delay}ms`,
        { url: String(input) },
      );
      await sleep(delay, signal ?? undefined);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt >= maxAttempts) throw error;

      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[spotify/fetchWithRetry] network error on attempt ${attempt}/${maxAttempts}; retrying in ${delay}ms`,
        error,
      );
      await sleep(delay, signal ?? undefined);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error
    ? lastError
    : new Error("Spotify GET failed after retries");
}
