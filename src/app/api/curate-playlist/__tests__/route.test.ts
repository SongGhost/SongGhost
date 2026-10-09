import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearNeighborhoodPools } from "@/lib/mix-neighbors";
import { POST } from "../route";

vi.mock("@/lib/youtube-search", () => {
  let videoSeq = 0;
  return {
    resolveTrackVideoId: vi.fn(async () => {
      videoSeq += 1;
      const id = `v${String(videoSeq).padStart(10, "0")}`;
      return id.slice(0, 11);
    }),
  };
});

vi.mock("@/lib/catalog/lastfm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog/lastfm")>("@/lib/catalog/lastfm");
  return {
    ...actual,
    isLastFmConfigured: () => true,
    fetchLastFmSimilarArtistsScored: vi.fn(async () => []),
    fetchLastFmTopTracks: vi.fn(async (artist: string) => [
      { title: `${artist} One`, playcount: 100 },
      { title: `${artist} Two`, playcount: 80 },
      { title: "Missing Song", playcount: 60 },
    ]),
  };
});

vi.mock("@/lib/itunes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/itunes")>("@/lib/itunes");
  return {
    ...actual,
    searchITunesSongs: vi.fn(async (term: string) => [
      {
        artist: term,
        title: "Kept Song",
        primaryGenreName: "Alternative",
        releaseYear: 2010,
        durationMs: 200_000,
        trackId: 11,
      },
    ]),
    searchSongsByArtistStrict: vi.fn(async (artist: string) => [
      { artist, title: `${artist} One`, durationMs: 200_000, trackId: 1 },
    ]),
    lookupITunesTrack: vi.fn(async (artist: string, title: string) => {
      if (/missing/i.test(title)) return null;
      return { artist, title, durationMs: 200_000, trackId: 21 };
    }),
    lookupITunesSongById: vi.fn(async () => null),
  };
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/curate-playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ARTISTS = [
  "Bon Iver",
  "Radiohead",
  "Phoebe Bridgers",
  "Sufjan Stevens",
  "Interpol",
  "The War on Drugs",
  "Big Thief",
  "Fleet Foxes",
  "Sharon Van Etten",
  "Grizzly Bear",
  "Local Natives",
  "The Walkmen",
];

describe("POST /api/curate-playlist", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    clearNeighborhoodPools();
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: ARTISTS.join("\n") } }],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    clearNeighborhoodPools();
  });

  it("builds a scene with gpt-4o and drops a song iTunes cannot find", async () => {
    const res = await POST(jsonRequest({ prompt: "90s Atlanta hip-hop" }));
    const data = (await res.json()) as {
      tracks: { title: string; artist: string }[];
      description: string;
    };

    expect(res.status).toBe(200);
    expect(data.tracks.length).toBeGreaterThan(0);
    expect(data.tracks.length).toBeLessThan(50);
    expect(data.tracks.some((track) => track.title === "Missing Song")).toBe(false);
    expect(data.description.toLowerCase()).toContain("fewer than 50");

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as {
      model: string;
      temperature: number;
      messages: { content: string }[];
    };
    expect(body.model).toBe("gpt-4o");
    expect(body.temperature).toBe(0.4);
    expect(body.messages[0].content).toContain("Timbre and vocal (25%)");
    expect(body.messages[0].content).not.toContain("up to 25");
  });

  it("uses the artist neighborhood for a named artist and still returns a short list", async () => {
    const res = await POST(jsonRequest({ prompt: "artists like The National" }));
    const data = (await res.json()) as { tracks: { title: string; artist: string }[]; name: string };

    expect(res.status).toBe(200);
    expect(data.tracks.length).toBeGreaterThan(0);
    expect(data.tracks.some((track) => track.title === "Missing Song")).toBe(false);
    expect(data.name).toContain("The National");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as { model: string; messages: { content: string }[] };
    expect(body.model).toBe("gpt-4o");
    expect(body.messages[0].content).not.toContain("up to 25");
  });
});
