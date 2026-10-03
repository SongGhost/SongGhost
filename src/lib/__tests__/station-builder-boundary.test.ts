import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * This station-builder pass must not land in the New DJ writer, the Classic
 * break, or the Artist Radio launch handoff.
 */
const UNTOUCHED = [
  "src/lib/artist-radio-handoff.ts",
  "src/lib/dj-intro.ts",
  "src/lib/dj/wordsEngine/playNewBreak.ts",
  "src/lib/dj/wordsEngine/handleRequest.ts",
  "src/lib/dj/wordsEngine/prompt.ts",
  "src/lib/dj/wordsEngine/synthesize.ts",
  "src/components/AudioPlayer.tsx",
  "src/hooks/useStationQueue.ts",
  "src/app/api/generate-script/route.ts",
];

const MARKERS = [
  "keepSameFeelNeighbors",
  "previousTitles",
  "CURATE_TRACK_CAP",
  "buildCurateUserContent",
  "realGenreOrEraTags",
  "MIXED_RADIO_SIMILAR_PAGE",
];

describe("New break, Classic, and Artist Radio handoff stay untouched", () => {
  it("does not pull the wider neighborhood or the AI list into those files", () => {
    for (const file of UNTOUCHED) {
      const source = readFileSync(path.resolve(file), "utf8");
      for (const marker of MARKERS) {
        expect(source, `${file} contains ${marker}`).not.toContain(marker);
      }
    }
  });

  it("leaves the Artist Radio launch handoff off the similar-artist picker", () => {
    const handoff = readFileSync(path.resolve("src/lib/artist-radio-handoff.ts"), "utf8");
    expect(handoff).not.toContain("fetchSimilarArtists");
    expect(handoff).not.toContain("curate-playlist");
    expect(handoff).not.toContain("artist-tag-filter");
  });
});