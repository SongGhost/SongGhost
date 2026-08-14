import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  fetchSpotifyGetWithRetry,
  isSpotifyCircuitOpen,
  parseRetryAfterMs,
  resetSpotifyCircuitBreakerForTests,
} from "@/lib/spotify/fetchWithRetry";

describe("fetchSpotifyGetWithRetry 429 circuit breaker", () => {
  beforeEach(() => {
    resetSpotifyCircuitBreakerForTests();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    resetSpotifyCircuitBreakerForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("parses Retry-After delta-seconds and falls back to 30s", () => {
    expect(parseRetryAfterMs("45")).toBe(45_000);
    expect(parseRetryAfterMs(null)).toBe(DEFAULT_RETRY_AFTER_SECONDS * 1000);
    expect(parseRetryAfterMs("nope")).toBe(DEFAULT_RETRY_AFTER_SECONDS * 1000);
  });

  it("trips the circuit on 429 and does not retry", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    });

    const response = await fetchSpotifyGetWithRetry("https://api.spotify.com/v1/search");
    expect(response.status).toBe(429);
    expect(fetches).toBe(1);
    expect(isSpotifyCircuitOpen()).toBe(true);
  });

  it("fail-fasts with a synthetic 429 while the circuit is open", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    });

    await fetchSpotifyGetWithRetry("https://api.spotify.com/v1/search");
    const second = await fetchSpotifyGetWithRetry("https://api.spotify.com/v1/me");
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
    expect(fetches).toBe(1);
  });

  it("still retries 502/503/504", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      if (fetches < 3) {
        return new Response(null, { status: 502 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const response = await fetchSpotifyGetWithRetry(
      "https://api.spotify.com/v1/search",
      undefined,
      { baseDelayMs: 50 },
    );
    expect(response.ok).toBe(true);
    expect(fetches).toBe(3);
    expect(isSpotifyCircuitOpen()).toBe(false);
  });
});
