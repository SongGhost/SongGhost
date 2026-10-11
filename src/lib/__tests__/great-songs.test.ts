import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HIT_POOL_SIZE, pickGreatTitles, placeOneDeepCut, splitHitPool } from "@/lib/great-songs";
import type { LastFmTopTrack } from "@/lib/catalog/lastfm";

function counted(titles: readonly string[], top = 1000): LastFmTopTrack[] {
  return titles.map((title, index) => ({
    title,
    playcount: top - index * 40,
  }));
}

const KNOWN = [
  "Terrible Love",
  "Bloodbuzz Ohio",
  "Fake Empire",
  "Mr. November",
  "About Today",
  "I Need My Girl",
  "England",
  "Don't Swallow the Cap",
  "This Is the Last Time",
  "Apartment Story",
  "Slow Show",
  "Secret Meeting",
];

describe("hit pool", () => {
  const tracks = counted(KNOWN);

  it("draws the first title from the top 8, can differ, and still allows the #1 song", () => {
    const hits = splitHitPool(tracks).hits.map((track) => track.title);
    expect(hits).toHaveLength(HIT_POOL_SIZE);
    expect(hits[0]).toBe("Terrible Love");
    expect(hits).not.toContain("This Is the Last Time");

    const ledByNumberOne = pickGreatTitles(tracks, 1, { rng: () => 0.999 });
    const ledByAnother = pickGreatTitles(tracks, 1, { rng: () => 0 });
    expect(hits).toContain(ledByNumberOne.chosen[0]);
    expect(hits).toContain(ledByAnother.chosen[0]);
    expect(ledByNumberOne.chosen[0]).toBe("Terrible Love");
    expect(ledByAnother.chosen[0]).not.toBe("Terrible Love");

    const full = pickGreatTitles(tracks, HIT_POOL_SIZE, { rng: () => 0 });
    expect(full.chosen).toContain("Terrible Love");
    expect(full.chosen.every((title) => hits.includes(title))).toBe(true);
    expect(full.chosen).not.toContain("This Is the Last Time");
  });

  it("gives a 3-song artist at most one deep cut, and not as their first song", () => {
    const hits = splitHitPool(tracks).hits.map((track) => track.title);
    const deep = splitHitPool(tracks).deep.map((track) => track.title);
    expect(deep.length).toBeGreaterThan(0);
    const picked = pickGreatTitles(tracks, 3, { rng: () => 0.999 });
    const hour = placeOneDeepCut(
      picked.chosen.map((title) => ({ artist: "The National", title })),
      new Map([["The National", deep]]),
      () => 0,
    );
    const outside = hour.filter((song) => !hits.includes(song.title));
    expect(hour[0]?.title).toBeTruthy();
    expect(hits).toContain(hour[0]?.title);
    expect(outside.length).toBeLessThanOrEqual(1);
    expect(outside.length).toBe(1);
    expect(outside[0]?.title).not.toBe(hour[0]?.title);
  });

  it("never gives the deep cut to an artist who appears once", () => {
    const deep = splitHitPool(tracks).deep.map((track) => track.title);
    const hour = placeOneDeepCut(
      [
        { artist: "The National", title: "Terrible Love" },
        { artist: "Once", title: "Known Song" },
        { artist: "The National", title: "Bloodbuzz Ohio" },
        { artist: "The National", title: "Fake Empire" },
      ],
      new Map([
        ["The National", deep],
        ["Once", ["Secret Track"]],
      ]),
      () => 0,
    );
    expect(hour.find((song) => song.artist === "Once")?.title).toBe("Known Song");
    expect(hour.some((song) => song.title === "Secret Track")).toBe(false);
    const deepCuts = hour.filter((song) => deep.includes(song.title));
    expect(deepCuts).toHaveLength(1);
    expect(deepCuts[0]?.artist).toBe("The National");
    expect(hour[0]?.title).toBe("Terrible Love");
  });

  it("drops bonus, live, and remix titles even when they lead the play counts", () => {
    const noisy: LastFmTopTrack[] = [
      { title: "High Violet (bonus track version)", playcount: 9000 },
      { title: "Terrible Love (Live)", playcount: 8000 },
      { title: "Bloodbuzz Ohio (Remix)", playcount: 7000 },
      ...counted(KNOWN, 1000),
    ];
    const picked = pickGreatTitles(noisy, 8, { rng: () => 0.999 });
    expect(picked.chosen).not.toContain("High Violet (bonus track version)");
    expect(picked.chosen).not.toContain("Terrible Love (Live)");
    expect(picked.chosen).not.toContain("Bloodbuzz Ohio (Remix)");
    expect(picked.chosen[0]).toBe("Terrible Love");
  });
});

describe("search stack", () => {
  it("lifts the search section above the sticky chip row and under the header", () => {
    const page = readFileSync(path.resolve("src/app/page.tsx"), "utf8");
    const browser = readFileSync(path.resolve("src/components/studio/StationBrowser.tsx"), "utf8");
    const header = readFileSync(path.resolve("src/components/ControlDeck.tsx"), "utf8");
    const search = page.match(/<section className="relative z-(\d+) mt-2 mb-4">/);
    const chips = [...browser.matchAll(/sticky top-\[calc\(env\(safe-area-inset-top\)\+2\.75rem\)\] z-(\d+)/g)];
    const headerZ = header.match(/sticky top-0 z-(\d+)/);
    expect(search?.[1]).toBeTruthy();
    expect(chips.length).toBeGreaterThan(0);
    expect(headerZ?.[1]).toBeTruthy();
    const searchZ = Number(search?.[1]);
    for (const chip of chips) {
      expect(searchZ).toBeGreaterThan(Number(chip[1]));
    }
    expect(searchZ).toBeLessThan(Number(headerZ?.[1]));
  });
});
