import { describe, expect, it } from "vitest";
import { getStationById } from "@/data/stations";
import { resolveGenreSceneLabel } from "@/lib/station-genre-profiles";
import type { Station } from "@/data/stations";

function stubStation(overrides: Partial<Station> = {}): Station {
  return {
    id: "adhoc",
    name: "Untitled Mix",
    frequency: 0,
    category: "genres",
    defaultPersonaId: "warm-companion",
    accentColor: "#000000",
    youtubeVideoId: "",
    tracks: [],
    description: "",
    ...overrides,
  };
}

describe("resolveGenreSceneLabel", () => {
  it("uses the authored catalog scene for a profiled station", () => {
    const station = getStationById("country-gold");
    expect(station).toBeDefined();
    expect(resolveGenreSceneLabel(station!)).toBe("classic country");
  });

  it("derives a scene from description when the station has no authored profile", () => {
    const station = getStationById("britpop-invasion");
    expect(station).toBeDefined();
    expect(resolveGenreSceneLabel(station!)).toBe("Britpop");
  });

  it("prefers explicit seed genres over profile terms", () => {
    const station = getStationById("country-gold")!;
    expect(
      resolveGenreSceneLabel({ ...station, seedGenres: ["Honky Tonk", "Outlaw"] }),
    ).toBe("Honky Tonk / Outlaw");
  });

  it("omits vernacular when nothing resolvable (fail open)", () => {
    expect(resolveGenreSceneLabel(stubStation())).toBeUndefined();
  });
});
