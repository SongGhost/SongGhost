import { describe, expect, it } from "vitest";
import {
  buildSavedStation,
  clampFmFrequency,
  DEFAULT_SAVED_STATION_ACCENT,
  DEFAULT_SAVED_STATION_FREQUENCY,
  isSavedStationId,
  savedStationId,
  slugifyStationName,
} from "../saved-stations";

const track = (youtubeId: string, title: string, artist: string) => ({
  youtubeId,
  title,
  artist,
});

const draft = (overrides: Partial<Parameters<typeof buildSavedStation>[0]> = {}) => ({
  name: "Late Night Drive",
  personaId: "wolfman" as const,
  frequency: 101.5,
  accentColor: DEFAULT_SAVED_STATION_ACCENT,
  tracks: [track("aaa", "Hotel California", "Eagles")],
  ...overrides,
});

describe("slugifyStationName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyStationName("Late Night Drive")).toBe("late-night-drive");
  });

  it("strips punctuation and edge hyphens", () => {
    expect(slugifyStationName("  90s Rave!! (Deep Cuts) ")).toBe("90s-rave-deep-cuts");
  });

  it("falls back when nothing survives normalization", () => {
    expect(slugifyStationName("!!!")).toBe("mix");
  });
});

describe("savedStationId", () => {
  it("uses the saved-station prefix", () => {
    expect(savedStationId("Late Night Drive")).toBe("saved-station-late-night-drive");
  });

  it("round-trips through isSavedStationId", () => {
    expect(isSavedStationId(savedStationId("My Mix"))).toBe(true);
    expect(isSavedStationId("70s-classic-rock")).toBe(false);
    expect(isSavedStationId("ai-curator-1234")).toBe(false);
  });
});

describe("clampFmFrequency", () => {
  it("keeps in-band values at one decimal", () => {
    expect(clampFmFrequency(101.55)).toBe(101.6);
    expect(clampFmFrequency(88.1)).toBe(88.1);
  });

  it("clamps out-of-band values to the dial", () => {
    expect(clampFmFrequency(12)).toBe(87.5);
    expect(clampFmFrequency(9999)).toBe(108);
  });

  it("falls back on non-finite input", () => {
    expect(clampFmFrequency(Number.NaN)).toBe(DEFAULT_SAVED_STATION_FREQUENCY);
  });
});

describe("buildSavedStation", () => {
  it("derives a prefixed id from the name", () => {
    expect(buildSavedStation(draft()).id).toBe("saved-station-late-night-drive");
  });

  it("keeps the queue order as seed tracks", () => {
    const tracks = [
      track("a", "One", "Artist A"),
      track("b", "Two", "Artist B"),
      track("c", "Three", "Artist C"),
    ];

    expect(buildSavedStation(draft({ tracks })).tracks.map((t) => t.title)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("drops tracks with no playable source", () => {
    const tracks = [
      track("a", "Playable", "Artist A"),
      { youtubeId: "", title: "Unplayable", artist: "Artist B" },
    ];

    expect(buildSavedStation(draft({ tracks })).tracks).toHaveLength(1);
  });

  it("carries the chosen persona, frequency, and accent", () => {
    const station = buildSavedStation(
      draft({ personaId: "chill_maya", frequency: 92.3, accentColor: "#FF00AA" }),
    );

    expect(station.defaultPersonaId).toBe("chill_maya");
    expect(station.frequency).toBe(92.3);
    expect(station.accentColor).toBe("#FF00AA");
  });

  it("gives the same id when re-saving under the same name so updates replace", () => {
    const first = buildSavedStation(draft());
    const second = buildSavedStation(draft({ tracks: [track("z", "New", "Artist Z")] }));

    expect(second.id).toBe(first.id);
  });
});
