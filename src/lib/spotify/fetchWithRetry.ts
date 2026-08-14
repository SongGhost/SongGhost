/**
 * Shared Spotify Web API GET retry helper.
 *
 * Intermittent 502/503/504 Bad Gateway responses from `api.spotify.com`
 * (and reverse proxies) are retried with exponential backoff.
 *
 * HTTP 429 opens a process-wide circuit breaker. Subsequent REST calls
 * fail-fast with a synthetic 429 (no network) until the Retry-After window
 * elapses. 429s are never retried.
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

/** Backoff when `Retry-After` is missing or unparsable. */
export const DEFAULT_RETRY_AFTER_SECONDS = 30;

/** Cap a pathological Retry-After so a bad header cannot pin the circuit open. */
const MAX_RETRY_AFTER_SECONDS = 300;

/**
 * Epoch ms when the global 429 window ends. `0` = circuit closed.
 * Module-level so Search, recommendations, and other GETs share one breaker.
 */
let spotifyRateLimitResetTime = 0;

export function isSpotifyCircuitOpen(): boolean {
  return Date.now() < spotifyRateLimitResetTime;
}

/**
 * Open (or extend) the 429 circuit. Never shortens an already-open window.
 */
export function tripSpotifyRateLimit(retryAfterMs: number): void {
  const until = Date.now() + Math.max(0, retryAfterMs);
  if (until > spotifyRateLimitResetTime) {
    spotifyRateLimitResetTime = until;
  }
}

export function resetSpotifyCircuitBreakerForTests(): void {
  spotifyRateLimitResetTime = 0;
}

function remainingRetryAfterSeconds(): number {
  return Math.max(1, Math.ceil((spotifyRateLimitResetTime - Date.now()) / 1000));
}

function synthetic429Response(): Response {
  return new Response(null, {
    status: 429,
    statusText: "Too Many Requests",
    headers: { "Retry-After": String(remainingRetryAfterSeconds()) },
  });
}

/**
 * Parse Spotify's `Retry-After` as delta-seconds or HTTP-date.
 * Falls back to {@link DEFAULT_RETRY_AFTER_SECONDS}.
 */
export function parseRetryAfterMs(header: string | null): number {
  const raw = header?.trim() ?? "";
  if (!raw) return DEFAULT_RETRY_AFTER_SECONDS * 1000;

  if (/^\d+$/.test(raw)) {
    const seconds = Number.parseInt(raw, 10);
    const clamped = Math.min(
      MAX_RETRY_AFTER_SECONDS,
      Math.max(1, Number.isFinite(seconds) ? seconds : DEFAULT_RETRY_AFTER_SECONDS),
    );
    return clamped * 1000;
  }

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    const deltaMs = dateMs - Date.now();
    if (deltaMs > 0) {
      return Math.min(MAX_RETRY_AFTER_SECONDS * 1000, deltaMs);
    }
  }

  return DEFAULT_RETRY_AFTER_SECONDS * 1000;
}

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
 * Single Spotify REST attempt with 429 circuit-breaker gating.
 * Used by {@link fetchSpotifyGetWithRetry}; 429s trip the breaker and are
 * never retried at this layer.
 */
export async function spotifyApiFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isSpotifyCircuitOpen()) {
    return synthetic429Response();
  }

  const response = await fetch(input, init);
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    tripSpotifyRateLimit(retryAfterMs);
    console.warn("[spotify/fetchWithRetry] 429 — circuit open", {
      url: String(input),
      retryAfterMs,
    });
  }
  return response;
}

/**
 * `fetch` wrapper for Spotify GETs with up to 3 attempts and exponential backoff.
 * Non-retryable HTTP statuses (including 429) and non-network successes are
 * returned as-is. While the 429 circuit is open, returns a synthetic 429
 * without hitting the network.
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
      const response = await spotifyApiFetch(input, {
        ...init,
        method: init?.method ?? "GET",
        signal,
      });
      lastResponse = response;

      if (response.status === 429) {
        return response;
      }

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
