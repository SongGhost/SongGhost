import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationTrack } from "@/data/stations";
import { finalizeStationCatalog, orderCatalog, shuffle } from "../catalog-builder";

vi.mock("@/lib/catalog/musicbrainz", () => ({
  enrichTracksWithMusicBrainz: vi.fn(async (tracks: StationTrack[]) => tracks),
}));

function track(
  overrides: Partial<StationTrack> & Pick<StationTrack, "title" | "artist">,
): StationTrack {
  return {
    youtubeId: overrides.youtubeId ?? `yt-${overrides.title.replace(/\s+/g, "-").toLowerCase()}`,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("finalizeStationCatalog", () => {
  it("drops off-era tracks under a decade lock", async () => {
    const tracks = [
      track({ title: "Take On Me", artist: "a-ha", releaseYear: 1985 }),
      track({ title: "Wonderwall", artist: "Oasis", releaseYear: 1995 }),
    ];

    const result = await finalizeStationCatalog(tracks, {
      eraLock: "80s",
      allowExplicit: "allow",
    });

    expect(result.map((t) => t.title)).toEqual(["Take On Me"]);
  });

  it("drops tribute/karaoke junk titles", async () => {
    const tracks = [
      track({ title: "Purple Haze", artist: "Jimi Hendrix", releaseYear: 1967 }),
      track({ title: "Purple Haze Tribute", artist: "Studio Band", releaseYear: 1967 }),
      track({ title: "Haze Karaoke", artist: "Jimi Hendrix", releaseYear: 1967 }),
    ];

    const result = await finalizeStationCatalog(tracks, {
      eraLock: "all",
      allowExplicit: "allow",
    });

    expect(result.map((t) => t.title)).toEqual(["Purple Haze"]);
  });

  it("drops confirmed-explicit tracks when Clean Mode is on", async () => {
    const tracks = [
      track({ title: "Clean Cut", artist: "Act A", explicit: false }),
      track({ title: "Explicit Cut", artist: "Act B", explicit: true }),
    ];

    const clean = await finalizeStationCatalog(tracks, {
      eraLock: "all",
      allowExplicit: false,
    });
    const allowed = await finalizeStationCatalog(tracks, {
      eraLock: "all",
      allowExplicit: "allow",
    });

    expect(clean.map((t) => t.title)).toEqual(["Clean Cut"]);
    expect(allowed.map((t) => t.title).sort()).toEqual(["Clean Cut", "Explicit Cut"]);
  });

  it("caps each artist at 2 tracks", async () => {
    const tracks = [
      track({ title: "One", artist: "Nas" }),
      track({ title: "Two", artist: "Nas" }),
      track({ title: "Three", artist: "Nas" }),
      track({ title: "Juicy", artist: "The Notorious B.I.G." }),
    ];

    const result = await finalizeStationCatalog(tracks, {
      eraLock: "all",
      allowExplicit: "allow",
    });

    const nasCount = result.filter((t) => t.artist === "Nas").length;
    expect(nasCount).toBe(2);
    expect(result.some((t) => t.artist === "The Notorious B.I.G.")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("keeps a stable order when the RNG is pinned", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    const tracks = [
      track({ title: "Alpha", artist: "Act A" }),
      track({ title: "Bravo", artist: "Act B" }),
      track({ title: "Charlie", artist: "Act C" }),
    ];

    const first = await finalizeStationCatalog(tracks, {
      eraLock: "all",
      allowExplicit: "allow",
    });
    const second = await finalizeStationCatalog(tracks, {
      eraLock: "all",
      allowExplicit: "allow",
    });

    expect(first.map((t) => t.title)).toEqual(second.map((t) => t.title));
  });
});

describe("orderCatalog / shuffle", () => {
  it("shuffles deterministically when Math.random is pinned", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(shuffle(["a", "b", "c"])).toEqual(["b", "c", "a"]);
    expect(shuffle(["a", "b", "c"])).toEqual(["b", "c", "a"]);
  });

  it("returns a stable catalog order for the same ranked input when RNG is pinned", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.3);
    const tracks = [
      track({ title: "Alpha", artist: "Act A" }),
      track({ title: "Bravo", artist: "Act B" }),
      track({ title: "Charlie", artist: "Act C" }),
      track({ title: "Delta", artist: "Act D" }),
    ];

    expect(orderCatalog(tracks).map((t) => t.title)).toEqual(
      orderCatalog(tracks).map((t) => t.title),
    );
  });
});
