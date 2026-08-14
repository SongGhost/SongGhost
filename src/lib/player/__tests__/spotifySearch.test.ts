import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetSpotifyCircuitBreakerForTests,
} from "@/lib/spotify/fetchWithRetry";
import {
  SEARCH_CONCURRENCY,
  SEARCH_URI_CACHE_LIMIT,
  resetSpotifyUriSearchCacheForTests,
  sanitizeSpotifySearchArtist,
  sanitizeSpotifySearchTitle,
  searchSpotifyTrackUri,
} from "@/lib/player/spotifyRemote";

function jsonSearchResponse(uri: string | null, status = 200): Response {
  const items = uri ? [{ uri, id: uri.replace("spotify:track:", "") }] : [];
  return new Response(JSON.stringify({ tracks: { items } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function searchQueryFromInput(input: string | URL | Request): string {
  const url = new URL(String(input));
  return url.searchParams.get("q") ?? "";
}

describe("sanitizeSpotifySearchTitle", () => {
  it("strips quotes, years, and resolution tags from Doors-style YouTube titles", () => {
    expect(
      sanitizeSpotifySearchTitle(`"People Are Strange" 1967 1080P Jim Morrison`),
    ).toBe("People Are Strange Jim Morrison");
  });

  it("strips quotes and exclusive-performance parens from Greta Van Fleet titles", () => {
    expect(
      sanitizeSpotifySearchTitle(
        `Greta Van Fleet "Flower Power" (EXCLUSIVE Performance!)`,
      ),
    ).toBe("Greta Van Fleet Flower Power");
  });

  it("strips curly quotes, lyric-video parens, and trailing dashes", () => {
    expect(
      sanitizeSpotifySearchTitle(`“Foxey Lady” (Lyric Video) - `),
    ).toBe("Foxey Lady");
  });
});

describe("sanitizeSpotifySearchArtist", () => {
  it("ignores Audacy so search can fall back to track-only matching", () => {
    expect(sanitizeSpotifySearchArtist("Audacy")).toBe("");
  });

  it("ignores other aggregator / label channel names", () => {
    expect(sanitizeSpotifySearchArtist("Audio Video Musica")).toBe("");
    expect(sanitizeSpotifySearchArtist("Atlantic Records")).toBe("");
    expect(sanitizeSpotifySearchArtist("Queen Official")).toBe("");
    expect(sanitizeSpotifySearchArtist("VEVO")).toBe("");
  });

  it("keeps real artist names", () => {
    expect(sanitizeSpotifySearchArtist("Jim Morrison")).toBe("Jim Morrison");
    expect(sanitizeSpotifySearchArtist("Neil Young - Topic")).toBe("Neil Young");
  });
});

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
      return jsonSearchResponse("spotify:track:cap0000000000000000001");
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

  it("quotes track and artist fields on the primary query", async () => {
    let q = "";
    vi.stubGlobal("fetch", async (input: string | URL) => {
      q = searchQueryFromInput(input);
      return jsonSearchResponse("spotify:track:hit00000000000000000001");
    });

    await searchSpotifyTrackUri("token", "Heart of Gold", "Neil Young");
    expect(q).toBe('track:"Heart of Gold" artist:"Neil Young"');
  });

  it("omits ignored channel artists and sanitizes YouTube junk in the primary query", async () => {
    let q = "";
    vi.stubGlobal("fetch", async (input: string | URL) => {
      q = searchQueryFromInput(input);
      return jsonSearchResponse("spotify:track:hit00000000000000000002");
    });

    await searchSpotifyTrackUri(
      "token",
      `Greta Van Fleet "Flower Power" (EXCLUSIVE Performance!)`,
      "Audacy",
    );
    expect(q).toBe('track:"Greta Van Fleet Flower Power"');
  });

  it("issues one un-fielded fallback after a non-OK primary (400)", async () => {
    const queries: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const q = searchQueryFromInput(input);
      queries.push(q);
      if (q.startsWith("track:")) {
        return new Response(null, { status: 400 });
      }
      return jsonSearchResponse("spotify:track:abc123abc123abc123abc1");
    });

    const uri = await searchSpotifyTrackUri("token", "Heart of Gold", "Neil Young");
    expect(uri).toBe("spotify:track:abc123abc123abc123abc1");
    expect(queries).toEqual([
      'track:"Heart of Gold" artist:"Neil Young"',
      "Heart of Gold Neil Young",
    ]);
    expect(warn.mock.calls.some((call) =>
      String(call[0]).includes("Search primary failed") && call[1] === 400,
    )).toBe(true);
    warn.mockRestore();
  });

  it("issues one un-fielded fallback after an empty primary result", async () => {
    const queries: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const q = searchQueryFromInput(input);
      queries.push(q);
      if (q.startsWith("track:")) {
        return jsonSearchResponse(null);
      }
      return jsonSearchResponse("spotify:track:abc123abc123abc123abc2");
    });

    const uri = await searchSpotifyTrackUri(
      "token",
      `"People Are Strange" 1967 1080P Jim Morrison`,
      "Jim Morrison",
    );
    expect(uri).toBe("spotify:track:abc123abc123abc123abc2");
    expect(queries).toEqual([
      'track:"People Are Strange Jim Morrison" artist:"Jim Morrison"',
      "People Are Strange Jim Morrison Jim Morrison",
    ]);
    expect(warn.mock.calls.some((call) =>
      String(call[0]).includes("Search primary empty"),
    )).toBe(true);
    warn.mockRestore();
  });

  it("does not run the plain-query fallback on HTTP 429", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    });

    await searchSpotifyTrackUri("token", "Heart of Gold", "Neil Young");
    expect(fetches).toBe(1);
  });
});
