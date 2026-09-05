import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchLastFmSimilarArtistsScored,
  fetchLastFmTopTracks,
  isLastFmConfigured,
} from "@/lib/catalog/lastfm";
import {
  lookupITunesSongById,
  lookupITunesTrack,
} from "@/lib/itunes";
import { getSpotifyAppToken } from "@/lib/spotify/app-auth";
import { GET } from "../route";

vi.mock("@/lib/catalog/lastfm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog/lastfm")>();
  return {
    ...actual,
    isLastFmConfigured: vi.fn(() => true),
    fetchLastFmTopTracks: vi.fn(),
    fetchLastFmSimilarArtistsScored: vi.fn(),
  };
});

vi.mock("@/lib/itunes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/itunes")>();
  return {
    ...actual,
    lookupITunesTrack: vi.fn(),
    lookupITunesSongById: vi.fn(),
  };
});

vi.mock("@/lib/spotify/app-auth", () => ({
  getSpotifyAppToken: vi.fn(),
}));

vi.mock("@/lib/youtube-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube-search")>();
  let nextId = 1;
  const ids = new Map<string, string>();
  return {
    ...actual,
    resolveTrackVideoId: vi.fn(async (artist: string, title: string) => {
      const key = `${artist}::${title}`;
      const existing = ids.get(key);
      if (existing) return existing;
      const id = `yt${String(nextId++).padStart(9, "0")}`;
      ids.set(key, id);
      return id;
    }),
  };
});

let nextItunesId = 1;
const itunesIds = new Map<string, number>();

function catalogId(artist: string, title: string): number {
  const key = `${artist}::${title}`;
  const existing = itunesIds.get(key);
  if (existing) return existing;
  const id = nextItunesId++;
  itunesIds.set(key, id);
  return id;
}

function hitsFor(artist: string, count: number, playcount = 5000) {
  return Array.from({ length: count }, (_, i) => ({
    title: `${artist} Hit ${i + 1}`,
    playcount: playcount - i * 50,
  }));
}

const SIMILAR_PASSING = [
  { name: "Keane", match: 0.91 },
  { name: "Coldplay", match: 0.8 },
  { name: "Death Cab for Cutie", match: 0.7 },
  { name: "Modest Mouse", match: 0.65 },
  { name: "Interpol", match: 0.6 },
  { name: "The Killers", match: 0.55 },
  { name: "Arcade Fire", match: 0.52 },
  { name: "Vampire Weekend", match: 0.5 },
  { name: "Bon Iver", match: 0.48 },
  { name: "The Strokes", match: 0.45 },
  { name: "Radiohead", match: 0.42 },
  { name: "Thin Catalog Act", match: 0.41 },
] as const;

const LOOSE_MATCHES = [
  { name: "Travis Scott", match: 0.12 },
  { name: "Travis Tritt", match: 0.08 },
] as const;

describe("GET /api/song-radio", () => {
  beforeEach(() => {
    nextItunesId = 1;
    itunesIds.clear();
    vi.mocked(isLastFmConfigured).mockReturnValue(true);
    vi.mocked(getSpotifyAppToken).mockResolvedValue(null);
    vi.mocked(lookupITunesSongById).mockResolvedValue(null);
    vi.mocked(lookupITunesTrack).mockImplementation(async (artist, title) => ({
      title,
      artist,
      previewUrl: `https://audio.example/${catalogId(artist, title)}.m4a`,
      durationMs: 210000,
      trackId: catalogId(artist, title),
    }));

    vi.mocked(fetchLastFmSimilarArtistsScored).mockResolvedValue([
      ...SIMILAR_PASSING,
      ...LOOSE_MATCHES,
    ]);

    vi.mocked(fetchLastFmTopTracks).mockImplementation(async (artist) => {
      if (artist === "Snow Patrol") {
        return [
          { title: "Chasing Cars", playcount: 9000 },
          { title: "Run", playcount: 7000 },
          { title: "Open Your Eyes", playcount: 5000 },
          { title: "Signal Fire", playcount: 4000 },
          { title: "Called Out in the Dark", playcount: 3000 },
          { title: "Shut Your Eyes", playcount: 2500 },
        ];
      }
      if (artist === "Thin Catalog Act") {
        return hitsFor(artist, 3);
      }
      return hitsFor(artist, 6);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("anchors the seed artist, caps similar acts, drops loose matches, and targets 25 tracks", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/song-radio?title=Chasing%20Cars&artist=Snow%20Patrol",
      ),
    );
    const data = (await res.json()) as {
      tracks: { title: string; artist: string }[];
    };

    expect(res.status).toBe(200);
    expect(data.tracks[0]).toMatchObject({
      title: "Chasing Cars",
      artist: "Snow Patrol",
    });

    const seedCount = data.tracks.filter((t) => t.artist === "Snow Patrol").length;
    expect(seedCount).toBeGreaterThanOrEqual(4);
    expect(seedCount).toBeLessThanOrEqual(6);
    expect(seedCount).toBe(6);

    const counts = new Map<string, number>();
    for (const track of data.tracks) {
      counts.set(track.artist, (counts.get(track.artist) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
      if (name === "Snow Patrol") continue;
      expect(count, `${name} exceeded similar-artist cap`).toBeLessThanOrEqual(3);
    }

    const thinCount = counts.get("Thin Catalog Act") ?? 0;
    expect(thinCount).toBeLessThanOrEqual(1);

    expect(data.tracks.some((t) => /travis scott/i.test(t.artist))).toBe(false);
    expect(data.tracks.some((t) => /travis tritt/i.test(t.artist))).toBe(false);

    expect(data.tracks.length).toBe(25);
    expect(data.tracks.length).toBeLessThanOrEqual(25);
  });

  it("returns 404 when the similar pool is empty and only the seed artist is present", async () => {
    vi.mocked(fetchLastFmSimilarArtistsScored).mockResolvedValue([]);

    const res = await GET(
      new Request(
        "http://localhost/api/song-radio?title=Chasing%20Cars&artist=Unknown Act",
      ),
    );
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/Could not expand Song Radio/);
  });
});
