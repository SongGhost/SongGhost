import { describe, expect, it, vi } from "vitest";
import type { Station } from "@/data/stations";
import {
  blueprintToStation,
  blueprintsToStations,
  erasToGenerateDecades,
  fallbackInspiredBlueprints,
  fetchInspiredStations,
  generateBodyFromBlueprint,
  inspiredStationId,
  isInspiredStationId,
  normalizeInspiredBlueprints,
  normalizeInspiredHex,
  seedFromLaunchedStation,
  shouldShowInspiredPill,
  clampInspiredUnit,
  INSPIRED_STATION_COUNT,
} from "../inspired-stations";

describe("inspired station helpers", () => {
  it("clamps 0–100 and rejects junk numbers", () => {
    expect(clampInspiredUnit(140, 50)).toBe(100);
    expect(clampInspiredUnit(-8, 50)).toBe(0);
    expect(clampInspiredUnit(33.6, 50)).toBe(34);
    expect(clampInspiredUnit("hot", 55)).toBe(55);
  });

  it("normalizes hex colors", () => {
    expect(normalizeInspiredHex("#ABC", "#000000")).toBe("#aabbcc");
    expect(normalizeInspiredHex("#C4882A", "#000000")).toBe("#c4882a");
    expect(normalizeInspiredHex("red", "#2992cf")).toBe("#2992cf");
  });

  it("ids inspired stations from the inspired- prefix", () => {
    expect(isInspiredStationId("inspired-90s-boom-bap-0")).toBe(true);
    expect(isInspiredStationId("ai-curator-1")).toBe(false);
    expect(inspiredStationId("90s Boom Bap", 0)).toBe("inspired-90s-boom-bap-0");
  });

  it("shows the Inspired pill only when a set exists or is loading", () => {
    expect(shouldShowInspiredPill([], false)).toBe(false);
    expect(shouldShowInspiredPill([], true)).toBe(true);
    expect(shouldShowInspiredPill([{ id: "inspired-a-0" }], false)).toBe(true);
  });

  it("maps eras onto tuner decades", () => {
    expect(erasToGenerateDecades(["90s", "Modern", "2020s", "50s", "all"])).toEqual([
      "90s",
      "Modern",
    ]);
    expect(erasToGenerateDecades([])).toEqual([]);
  });
});

describe("normalizeInspiredBlueprints", () => {
  it("returns exactly 5, dedupes names, and clamps numbers", () => {
    const normalized = normalizeInspiredBlueprints(
      {
        stations: [
          {
            name: "Night Drive",
            description: "One",
            seedGenres: ["Synthwave", "Outrun"],
            energyLevel: 999,
            catalogDepth: -20,
            accentColor: "#fff",
          },
          {
            name: "Night Drive",
            description: "Two",
            seedGenres: ["Synthpop"],
            energyLevel: 10,
            catalogDepth: 10,
          },
        ],
      },
      { seedGenres: ["Synthwave"] },
    );
    expect(normalized).toHaveLength(INSPIRED_STATION_COUNT);
    expect(normalized[0]?.name).toBe("Night Drive");
    expect(normalized[1]?.name).toBe("Night Drive 2");
    expect(normalized[0]?.energyLevel).toBe(100);
    expect(normalized[0]?.catalogDepth).toBe(0);
    expect(new Set(normalized.map((row) => row.name.toLowerCase())).size).toBe(5);
  });

  it("pads hip-hop seeds with the named fallbacks", () => {
    const normalized = normalizeInspiredBlueprints([], { seedGenres: ["Hip-Hop"] });
    expect(normalized.map((row) => row.name)).toEqual([
      "90s Boom Bap",
      "Trap Heavy",
      "Conscious Rhymes",
      "West Coast G-Funk",
      "Lo-Fi Hip-Hop",
    ]);
  });

  it("maps blueprints to Station-shaped objects with empty tracks", () => {
    const stations = blueprintsToStations(fallbackInspiredBlueprints({ seedGenres: ["Jazz"] }));
    expect(stations).toHaveLength(5);
    expect(stations[0]?.tracks).toEqual([]);
    expect(stations[0]?.youtubeVideoId).toBe("");
    expect(stations[0]?.frequency).toBe(0);
    expect(stations[0]?.category).toBe("genres");
    expect(stations[0]?.id.startsWith("inspired-")).toBe(true);
    const body = generateBodyFromBlueprint(stations[0]!);
    expect(body.genres.length).toBeGreaterThan(0);
    expect(body.energy).toBeGreaterThanOrEqual(0);
  });
});

describe("seedFromLaunchedStation", () => {
  it("copies seed fields from the just-launched station", () => {
    expect(
      seedFromLaunchedStation(
        {
          name: "Artist Radio: Nas",
          seedArtists: ["Nas"],
          seedGenres: ["Hip-Hop"],
        },
        { seedArtists: ["Nas"] },
      ),
    ).toEqual({
      seedGenres: ["Hip-Hop"],
      seedArtists: ["Nas"],
      seedStationName: "Artist Radio: Nas",
    });
  });
});

describe("fetchInspiredStations", () => {
  it("maps the endpoint payload and a second call replaces the prior set", async () => {
    const first = [
      {
        name: "Set A One",
        description: "a",
        seedGenres: ["Rock", "Indie"],
        eras: ["90s"],
        energyLevel: 40,
        catalogDepth: 40,
        accentColor: "#C4882A",
      },
      {
        name: "Set A Two",
        description: "a",
        seedGenres: ["Rock", "Alt"],
        eras: [],
        energyLevel: 50,
        catalogDepth: 50,
        accentColor: "#2992cf",
      },
      {
        name: "Set A Three",
        description: "a",
        seedGenres: ["Rock", "Punk"],
        eras: ["80s"],
        energyLevel: 60,
        catalogDepth: 60,
        accentColor: "#E07A3D",
      },
      {
        name: "Set A Four",
        description: "a",
        seedGenres: ["Rock", "Grunge"],
        eras: ["90s"],
        energyLevel: 70,
        catalogDepth: 30,
        accentColor: "#5B8FA8",
      },
      {
        name: "Set A Five",
        description: "a",
        seedGenres: ["Rock", "Shoegaze"],
        eras: ["Modern"],
        energyLevel: 80,
        catalogDepth: 20,
        accentColor: "#D4A017",
      },
    ];
    const second = first.map((row, i) => ({ ...row, name: `Set B ${i + 1}` }));

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ stations: first }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ stations: second }),
      });

    const a = await fetchInspiredStations({ seedGenres: ["Rock"] }, fetchImpl as unknown as typeof fetch);
    const b = await fetchInspiredStations({ seedGenres: ["Jazz"] }, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(a.map((s) => s.name)).toEqual(first.map((row) => row.name));
    expect(b.map((s) => s.name)).toEqual(second.map((row) => row.name));
    expect(a[0]?.id).not.toBe(b[0]?.id);
  });

  it("carries seedTrack artwork onto coverUrl from the API payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        stations: [
          {
            name: "90s Boom Bap",
            description: "Dusty drums",
            seedGenres: ["Boom Bap", "Hip-Hop"],
            eras: ["90s"],
            energyLevel: 60,
            catalogDepth: 40,
            accentColor: "#C4882A",
            seedTrack: {
              title: "N.Y. State of Mind",
              artist: "Nas",
              artworkUrl: "https://example.com/nas.jpg",
            },
          },
          {
            name: "Trap Heavy",
            description: "808s",
            seedGenres: ["Trap", "Hip-Hop"],
            eras: ["Modern"],
            energyLevel: 85,
            catalogDepth: 25,
            accentColor: "#2992cf",
          },
          {
            name: "Conscious Rhymes",
            description: "Lyrical",
            seedGenres: ["Conscious Hip-Hop", "Rap"],
            eras: ["90s"],
            energyLevel: 50,
            catalogDepth: 70,
            accentColor: "#E07A3D",
          },
          {
            name: "West Coast G-Funk",
            description: "Talkbox",
            seedGenres: ["G-Funk", "West Coast"],
            eras: ["90s"],
            energyLevel: 55,
            catalogDepth: 45,
            accentColor: "#5B8FA8",
          },
          {
            name: "Lo-Fi Hip-Hop",
            description: "Head-nod",
            seedGenres: ["Lo-Fi Hip-Hop", "Chillhop"],
            eras: [],
            energyLevel: 30,
            catalogDepth: 75,
            accentColor: "#D4A017",
          },
        ],
      }),
    });

    const stations = await fetchInspiredStations(
      { seedGenres: ["Hip-Hop"] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(stations[0]?.coverUrl).toBe("https://example.com/nas.jpg");
    expect(stations[0]?.seedTrack?.title).toBe("N.Y. State of Mind");
    expect(stations[1]?.coverUrl).toBeUndefined();
  });

  it("falls back locally when the request fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const stations = await fetchInspiredStations(
      { seedGenres: ["Hip-Hop"] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(stations).toHaveLength(5);
    expect(stations[0]?.name).toBe("90s Boom Bap");
  });
});

describe("blueprintToStation", () => {
  it("keeps Station required fields even without a persona from the model", () => {
    const station: Station = blueprintToStation(
      {
        name: "Soft Focus",
        description: "Hazy dream pop",
        seedGenres: ["Dream Pop", "Shoegaze"],
        eras: ["90s"],
        energyLevel: 22,
        catalogDepth: 66,
        accentColor: "#5B8FA8",
      },
      2,
    );
    expect(station.id).toBe("inspired-soft-focus-2");
    expect(station.defaultPersonaId).toBeTruthy();
    expect(station.tracks).toEqual([]);
    expect(station.coverUrl).toBeUndefined();
  });

  it("sets coverUrl from seedTrack.artworkUrl when present", () => {
    const station = blueprintToStation(
      {
        name: "90s Boom Bap",
        description: "Dusty drums",
        seedGenres: ["Boom Bap", "Hip-Hop"],
        eras: ["90s"],
        energyLevel: 60,
        catalogDepth: 40,
        accentColor: "#C4882A",
        seedTrack: {
          title: "N.Y. State of Mind",
          artist: "Nas",
          artworkUrl: "https://example.com/nas.jpg",
        },
      },
      0,
    );
    expect(station.coverUrl).toBe("https://example.com/nas.jpg");
    expect(station.seedTrack?.title).toBe("N.Y. State of Mind");
  });

  it("omits coverUrl when seedTrack has no artwork", () => {
    const station = blueprintToStation(
      {
        name: "Trap Heavy",
        description: "808s",
        seedGenres: ["Trap", "Hip-Hop"],
        eras: ["Modern"],
        energyLevel: 85,
        catalogDepth: 25,
        accentColor: "#2992cf",
        seedTrack: { title: "Mask Off", artist: "Future" },
      },
      1,
    );
    expect(station.coverUrl).toBeUndefined();
  });
});
