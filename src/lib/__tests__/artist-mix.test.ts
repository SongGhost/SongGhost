import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { finalizeArtistRadioTracks } from "@/lib/artist-radio";
import {
  clearMixNeighborMemory,
  formatMixNeighborParam,
  mergeMixNeighbors,
  mixOpensOnSeed,
  parseMixNeighborParam,
  pinSeedArtistFirst,
  recallMixNeighbors,
  rememberMixNeighbors,
  selectFreshNeighbors,
} from "@/lib/artist-mix";
import type { StationTrack } from "@/data/stations";

function track(artist: string, title: string, extra?: Partial<StationTrack>): StationTrack {
  return {
    artist,
    title,
    youtubeId: title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 11) || "abcdefghijk",
    ...extra,
  };
}

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
    const mixStart = queue.indexOf("const pinned = seedName ? pinSeedArtistFirst");
    const mixBody = queue.slice(mixStart, mixStart + 700);
    expect(mixBody).toContain("keepOrder: true");
    const curatorStart = queue.indexOf("if (isCuratorStation(stationIdRef.current))");
    const curatorBody = queue.slice(curatorStart, curatorStart + 400);
    expect(curatorBody).not.toContain("shuffle(");
  });
});
