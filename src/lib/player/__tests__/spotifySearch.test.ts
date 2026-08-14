import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetSpotifyCircuitBreakerForTests,
} from "@/lib/spotify/fetchWithRetry";
import {
  SEARCH_CONCURRENCY,
  SEARCH_URI_CACHE_LIMIT,
  resetSpotifyUriSearchCacheForTests,
  searchSpotifyTrackUri,
} from "@/lib/player/spotifyRemote";

function jsonSearchResponse(uri: string | null, status = 200): Response {
  const items = uri ? [{ uri, id: uri.replace("spotify:track:", "") }] : [];
  return new Response(JSON.stringify({ tracks: { items } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("searchSpotifyTrackUri", () => {
  beforeEach(() => {
    resetSpotifyUriSearchCacheForTests();
    resetSpotifyCircuitBreakerForTests();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    resetSpotifyUriSearchCacheForTests();
    resetSpotifyCircuitBreakerForTests();
    vi.unstubAllGlobals();
  });

  it(`caps parallel Search GETs at ${SEARCH_CONCURRENCY}`, async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal("fetch", async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;
      return jsonSearchResponse(null);
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        searchSpotifyTrackUri("token", `Song ${i}`, "Artist"),
      ),
    );

    expect(maxInFlight).toBeLessThanOrEqual(SEARCH_CONCURRENCY);
  });

  it("negatively caches 429s so identical queries do not re-fetch", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    });

    const first = await searchSpotifyTrackUri("token", "Heart of Gold", "Neil Young");
    const second = await searchSpotifyTrackUri("token", "Heart of Gold", "Neil Young");
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetches).toBe(1);
  });

  it(`evicts the oldest URI cache entry after ${SEARCH_URI_CACHE_LIMIT}`, async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      fetches += 1;
      const url = String(input);
      const match = /track:([^&]+)/.exec(decodeURIComponent(url));
      const title = match?.[1] ?? `n${fetches}`;
      return jsonSearchResponse(`spotify:track:${title.replace(/\W/g, "x").padEnd(22, "0").slice(0, 22)}`);
    });

    for (let i = 0; i < SEARCH_URI_CACHE_LIMIT; i += 1) {
      await searchSpotifyTrackUri("token", `Title ${i}`, "Artist");
    }
    expect(fetches).toBe(SEARCH_URI_CACHE_LIMIT);

    await searchSpotifyTrackUri("token", `Title ${SEARCH_URI_CACHE_LIMIT}`, "Artist");
    expect(fetches).toBe(SEARCH_URI_CACHE_LIMIT + 1);

    await searchSpotifyTrackUri("token", "Title 0", "Artist");
    expect(fetches).toBe(SEARCH_URI_CACHE_LIMIT + 2);
  });
});
