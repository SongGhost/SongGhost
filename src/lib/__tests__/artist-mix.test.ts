import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildArtistMixOpening, finalizeArtistRadioTracks } from "@/lib/artist-radio";
import {
  clearMixNeighborMemory,
  formatMixNeighborParam,
  mergeMixNeighbors,
  mixOpensOnSeed,
  openOnPlayableSeed,
  parseMixNeighborParam,
  pinSeedArtistFirst,
  recallMixNeighbors,
  rememberMixNeighbors,
  selectFreshNeighbors,
} from "@/lib/artist-mix";
import type { Ranked } from "@/lib/track-shuffle";
import type { StationTrack } from "@/data/stations";

function track(artist: string, title: string, extra?: Partial<StationTrack>): StationTrack {
  return {
    artist,
    title,
    youtubeId: title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 11) || "abcdefghijk",
    ...extra,
  };
}

function ranked(
  artist: string,
  title: string,
  extra?: Partial<StationTrack> & { rank?: number; isPrimaryArtist?: boolean },
): Ranked<StationTrack> {
  const rank = extra?.rank ?? 0;
  const isPrimaryArtist = extra?.isPrimaryArtist ?? true;
  const row = track(artist, title, extra);
  return { item: row, rank, tier: 1, isPrimaryArtist };
}

const canPlay = (row: StationTrack) => Boolean(row.youtubeId?.trim());

describe("Artist Mix opener", () => {
  it("opens on the seed when a neighbor is listed first", () => {
    const ordered = pinSeedArtistFirst(
      [
        track("Love Battery", "Between the Eyes"),
        track("Nirvana", "Drain You"),
        track("Mudhoney", "Touch Me I'm Sick"),
      ],
      "Nirvana",
    );

    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(ordered.map((row) => row.artist)).toEqual([
      "Nirvana",
      "Love Battery",
      "Mudhoney",
    ]);
    expect(mixOpensOnSeed(ordered, "Nirvana")).toBe(true);
  });

  it("does not let a neighbor preview take the opening slot", () => {
    const ordered = finalizeArtistRadioTracks(
      [
        track("Nirvana", "Smells Like Teen Spirit"),
        track("Love Battery", "Between the Eyes", { previewUrl: "https://preview.example/lb" }),
      ],
      "Nirvana",
    );

    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(ordered[0]?.title).toBe("Smells Like Teen Spirit");
  });

  it("fails if queue[0] is not the seed when a neighbor is shuffled first", () => {
    const shuffled = openOnPlayableSeed(
      [
        track("Stone Temple Pilots", "Plush", { previewUrl: "https://preview.example/plush" }),
        track("Nirvana", "Drain You", { youtubeId: "" }),
        track("Nirvana", "Smells Like Teen Spirit", { youtubeId: "nirvana11111" }),
      ],
      "Nirvana",
      canPlay,
    );

    expect(shuffled[0]?.artist).toBe("Nirvana");
    expect(shuffled[0]?.title).toBe("Smells Like Teen Spirit");
    expect(shuffled.map((row) => row.title)).toEqual(["Smells Like Teen Spirit", "Plush"]);
  });

  it("does not let shuffle, preview, or first-playable open on a neighbor", () => {
    const ordered = buildArtistMixOpening(
      [
        ranked("Nirvana", "Drain You", { youtubeId: "", rank: 0 }),
        ranked("Nirvana", "Smells Like Teen Spirit", { youtubeId: "nirvana11111", rank: 9 }),
      ],
      [
        ranked("Stone Temple Pilots", "Plush", {
          previewUrl: "https://preview.example/plush",
          youtubeId: "plush1111111",
          rank: 0,
          isPrimaryArtist: false,
        }),
      ],
      "Nirvana",
      { rng: () => 0.99, isPlayable: canPlay },
    );

    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(ordered[0]?.title).not.toBe("Plush");
    expect(ordered.findIndex((row) => row.title === "Plush")).toBeGreaterThan(0);
  });

  it("returns no queue when the only playable track is a neighbor", () => {
    const ordered = buildArtistMixOpening(
      [ranked("Nirvana", "Drain You", { youtubeId: "", rank: 0 })],
      [
        ranked("Stone Temple Pilots", "Plush", {
          previewUrl: "https://preview.example/plush",
          youtubeId: "plush1111111",
          rank: 0,
          isPrimaryArtist: false,
        }),
      ],
      "Nirvana",
      { rng: () => 0, isPlayable: canPlay },
    );

    expect(ordered).toEqual([]);
    expect(ordered[0]?.artist).not.toBe("Stone Temple Pilots");
  });

  it("plays a short mix of the seed when no neighbors came back", () => {
    const ordered = pinSeedArtistFirst([track("Nirvana", "Drain You")], "Nirvana");

    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(mixOpensOnSeed(ordered, "Nirvana")).toBe(true);
  });
});

describe("Artist Mix replay", () => {
  it("asks for a new neighbor slice instead of reshuffling the last one", () => {
    clearMixNeighborMemory();
    const page = Array.from({ length: 12 }, (_, index) => `Neighbor ${index + 1}`);
    const first = selectFreshNeighbors(page, []);
    rememberMixNeighbors("Nirvana", first);

    const params = new URLSearchParams({ artist: "Nirvana", mode: "mixed" });
    const previous = mergeMixNeighbors(recallMixNeighbors("Nirvana"), []);
    const encoded = formatMixNeighborParam(previous);
    expect(encoded).not.toBe("");
    params.set("excludeNeighbors", encoded);

    const second = selectFreshNeighbors(page, parseMixNeighborParam(params.get("excludeNeighbors")));
    const shuffledFirst = [...first].reverse();

    expect(first).toHaveLength(8);
    expect(second).toEqual(["Neighbor 9", "Neighbor 10", "Neighbor 11", "Neighbor 12"]);
    expect(new Set(second)).not.toEqual(new Set(first));
    expect(second).not.toEqual(shuffledFirst);
    expect(second.every((name) => page.includes(name))).toBe(true);
  });

  it("replays the short list when no other same-feel neighbor is left", () => {
    expect(selectFreshNeighbors(["Keane"], ["Keane"])).toEqual(["Keane"]);
  });

  it("does not refuse a thin mix in the artist-radio route", () => {
    const route = readFileSync(path.resolve("src/app/api/artist-radio/route.ts"), "utf8");
    expect(route).not.toContain("Could not expand");
    expect(route).not.toContain("Could not find similar artists");
    expect(route).not.toContain("uniquePrimaryArtists");
    expect(route).toContain("selectFreshNeighbors");
    expect(route).toContain("fetchSimilarArtists(matchedArtist)");

    const queue = readFileSync(path.resolve("src/hooks/useStationQueue.ts"), "utf8");
    const mixStart = queue.indexOf("if (hasNeighbor)");
    const mixEnd = queue.indexOf("if (!seedName)", mixStart);
    const mixBody = queue.slice(mixStart, mixEnd);
    expect(mixBody).toContain("openOnPlayableSeed");
    expect(mixBody).toContain("keepOrder: true");
    expect(mixBody).not.toContain("rotateStarter");
    const curatorStart = queue.indexOf("if (isCuratorStation(stationIdRef.current))");
    const curatorBody = queue.slice(curatorStart, curatorStart + 400);
    expect(curatorBody).not.toContain("shuffle(");
  });
});
