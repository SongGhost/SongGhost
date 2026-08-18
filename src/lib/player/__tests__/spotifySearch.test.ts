import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetSpotifyCircuitBreakerForTests,
} from "@/lib/spotify/fetchWithRetry";
import {
  SEARCH_CONCURRENCY,
  SEARCH_EMPTY_TTL_MS,
  SEARCH_URI_CACHE_LIMIT,
  resetSpotifyUriSearchCacheForTests,
  sanitizeSpotifySearchArtist,
  sanitizeSpotifySearchTitle,
  searchSpotifyTrackUri,
} from "@/lib/audio/legacy/spotifyRemote";

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

  it("strips featuring credits (ft. / feat. / featuring) and trailing featured artists", () => {
    expect(
      sanitizeSpotifySearchTitle("Wait In The Truck ft. Lainey Wilson"),
    ).toBe("Wait In The Truck");
    expect(
      sanitizeSpotifySearchTitle("In My Feelings (feat. Drake)"),
    ).toBe("In My Feelings");
    expect(
      sanitizeSpotifySearchTitle("Song Title (Featuring Someone)"),
    ).toBe("Song Title");
    expect(
      sanitizeSpotifySearchTitle("Artist - Song ft. Lainey Wilson..."),
    ).toBe("Song");
  });

  it("strips 8-digit date stamps", () => {
    expect(sanitizeSpotifySearchTitle("Song Title 19880110")).toBe("Song Title");
    expect(
      sanitizeSpotifySearchTitle("Wait In The Truck ft. Lainey Wilson 19880110"),
    ).toBe("Wait In The Truck");
  });

  it("strips generic parentheticals like (With Intro) while keeping structural tags", () => {
    expect(sanitizeSpotifySearchTitle("Song Name (With Intro)")).toBe("Song Name");
    expect(sanitizeSpotifySearchTitle("Song Name (pt. 1)")).toBe("Song Name (pt. 1)");
    expect(sanitizeSpotifySearchTitle("Song Name (part 2)")).toBe("Song Name (part 2)");
    expect(sanitizeSpotifySearchTitle("Song Name (Radio Edit)")).toBe(
      "Song Name (Radio Edit)",
    );
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

  it("strips featuring phrases and isolates the primary artist", () => {
    expect(sanitizeSpotifySearchArtist("Hardy ft. Lainey Wilson")).toBe("Hardy");
    expect(sanitizeSpotifySearchArtist("Drake feat. Rihanna")).toBe("Drake");
    expect(sanitizeSpotifySearchArtist("Artist featuring Other")).toBe("Artist");
    expect(sanitizeSpotifySearchArtist("Beyoncé & Jay-Z")).toBe("Beyoncé");
    expect(sanitizeSpotifySearchArtist("Artist, Other")).toBe("Artist");
    expect(
      sanitizeSpotifySearchArtist("Hardy, Lainey Wilson & Someone"),
    ).toBe("Hardy");
    expect(sanitizeSpotifySearchArtist("weezer and Best Coast")).toBe("weezer");
    expect(sanitizeSpotifySearchArtist("Weezer AND Best Coast")).toBe("Weezer");
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

  it("strips featuring credits and date stamps from the primary query", async () => {
    let q = "";
    vi.stubGlobal("fetch", async (input: string | URL) => {
      q = searchQueryFromInput(input);
      return jsonSearchResponse("spotify:track:hit00000000000000000003");
    });

    await searchSpotifyTrackUri(
      "token",
      "Wait In The Truck ft. Lainey Wilson 19880110",
      "Hardy feat. Lainey Wilson",
    );
    expect(q).toBe('track:"Wait In The Truck" artist:"Hardy"');
  });

  it("falls back to title-only after empty fielded and un-fielded queries", async () => {
    const queries: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const q = searchQueryFromInput(input);
      queries.push(q);
      if (q.startsWith("track:") || q.endsWith("Neil Young")) {
        return jsonSearchResponse(null);
      }
      return jsonSearchResponse("spotify:track:titleonly000000000001");
    });

    const uri = await searchSpotifyTrackUri("token", "Heart of Gold", "Neil Young");
    expect(uri).toBe("spotify:track:titleonly000000000001");
    expect(queries).toEqual([
      'track:"Heart of Gold" artist:"Neil Young"',
      "Heart of Gold Neil Young",
      "Heart of Gold",
    ]);
    expect(warn.mock.calls.some((call) =>
      String(call[0]).includes("Search fallback empty"),
    )).toBe(true);
    expect(warn.mock.calls.some((call) =>
      String(call[0]).includes("Search title-only empty"),
    )).toBe(false);
    warn.mockRestore();
  });

  it("does not run title-only fallback when the un-fielded query is HTTP 429", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      fetches += 1;
      const q = searchQueryFromInput(input);
      if (q.startsWith("track:")) {
        return jsonSearchResponse(null);
      }
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    });

    const uri = await searchSpotifyTrackUri("token", "Heart of Gold", "Neil Young");
    expect(uri).toBeNull();
    expect(fetches).toBe(2);
  });

  it("expires empty catalog misses so a sanitizer update can retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return jsonSearchResponse(null);
    });

    try {
      const first = await searchSpotifyTrackUri("token", "Missing Song", "Nobody");
      const cached = await searchSpotifyTrackUri("token", "Missing Song", "Nobody");
      expect(first).toBeNull();
      expect(cached).toBeNull();
      expect(fetches).toBe(3);

      vi.setSystemTime(new Date(Date.now() + SEARCH_EMPTY_TTL_MS + 1));
      await searchSpotifyTrackUri("token", "Missing Song", "Nobody");
      expect(fetches).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
