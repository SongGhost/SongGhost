import { describe, expect, it } from "vitest";
import type { AlbumContext } from "@/types/station";
import {
  buildStationShareUrl,
  decodeBase64UrlJson,
  deserializeStationPreset,
  encodeBase64UrlJson,
  fromCompactStationPreset,
  MAX_PRESET_TOKEN_LENGTH,
  readPresetTokenFromSearch,
  serializeStationPreset,
  STATION_PRESET_PARAM,
  stripPresetFromUrl,
  summarizeShareableStation,
  toCompactStationPreset,
} from "../serializer";

const rumours: AlbumContext = {
  albumTitle: "Rumours",
  artist: "Fleetwood Mac",
  releaseYear: 1977,
  recordingStudio: "Record Plant, Sausalito",
  producer: "Fleetwood Mac, Ken Caillat, Richard Dashut",
  label: "Warner Bros.",
  personnel: [
    { name: "Lindsey Buckingham", role: "guitar, vocals" },
    { name: "Stevie Nicks", role: "vocals" },
  ],
  trackList: [
    { position: 1, title: "Second Hand News", side: "A", note: "Opener" },
    { position: 2, title: "Dreams", side: "A" },
    { position: 3, title: "Never Going Back Again", side: "A" },
  ],
};

describe("base64url JSON codec", () => {
  it("round-trips unicode payloads", () => {
    const payload = { vibe: "neon rain — late night", n: "夜のドライブ" };
    expect(decodeBase64UrlJson(encodeBase64UrlJson(payload))).toEqual(payload);
  });

  it("rejects corrupt tokens", () => {
    expect(decodeBase64UrlJson("%%%not-base64%%%")).toBeNull();
    expect(decodeBase64UrlJson("")).toBeNull();
  });
});

describe("station preset serialize / deserialize", () => {
  it("round-trips vibe, era, host, chatter, mode, album, and voice tuning", () => {
    const token = serializeStationPreset({
      stationId: "90s-alt",
      name: "Night Shift",
      frequency: 104.5,
      hostPersonaId: "kira-nova",
      chatterPacing: "talkative",
      eraLock: "90s",
      vibePrompt: "neon rain",
      mode: "album_deep_dive",
      albumContext: rumours,
      voiceProfile: {
        energy: "high",
        accent: "nyc",
        snark: "medium",
        pacing: "rapid",
      },
    });

    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");

    const decoded = deserializeStationPreset(token);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    expect(decoded.stationId).toBe("90s-alt");
    expect(decoded.config.name).toBe("Night Shift");
    expect(decoded.config.frequency).toBe(104.5);
    expect(decoded.config.hostPersonaId).toBe("kira-nova");
    expect(decoded.config.chatterPacing).toBe("talkative");
    expect(decoded.config.eraLock).toBe("90s");
    expect(decoded.config.vibePrompt).toBe("neon rain");
    expect(decoded.config.mode).toBe("album_deep_dive");
    expect(decoded.config.albumContext?.albumTitle).toBe("Rumours");
    expect(decoded.config.albumContext?.trackList).toHaveLength(3);
    expect(decoded.config.voiceProfile).toEqual({
      energy: "high",
      accent: "nyc",
      snark: "medium",
      pacing: "rapid",
    });
  });

  it("keeps a bare station id short and hydrates schema defaults", () => {
    const token = serializeStationPreset({ stationId: "90s-alt" });
    expect(token.length).toBeLessThan(40);
    const decoded = deserializeStationPreset(token);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.config).toEqual({
      stationId: "90s-alt",
      mode: "standard",
      albumContext: null,
    });
    expect(decoded.config.voiceProfile).toBeUndefined();
  });

  it("rejects unsupported or truncated tokens", () => {
    expect(deserializeStationPreset("not-a-preset").ok).toBe(false);
    expect(
      deserializeStationPreset(encodeBase64UrlJson({ v: 99, id: "90s-alt" })).ok,
    ).toBe(false);
    expect(deserializeStationPreset(encodeBase64UrlJson({ v: 1, id: "" })).ok).toBe(false);
  });

  it("omits default era and standard mode from the compact wire shape", () => {
    const compact = toCompactStationPreset({
      stationId: "90s-alt",
      eraLock: "all",
      mode: "standard",
    });
    expect(compact.e).toBeUndefined();
    expect(compact.m).toBeUndefined();
  });

  it("trims an oversized deep-dive sleeve rather than overflowing the URL budget", () => {
    const bloated: AlbumContext = {
      albumTitle: "Endless Notes",
      artist: "The Verbose",
      personnel: Array.from({ length: 20 }, (_, i) => ({
        name: `Player ${i} with a very long credited name`,
        role: "guitar, bass, drums, synth, and more",
      })),
      trackList: Array.from({ length: 30 }, (_, i) => ({
        position: i + 1,
        title: `Track Number ${i + 1} With An Overlong Title For Compression`,
        note: "x".repeat(180),
      })),
    };

    const token = serializeStationPreset({
      stationId: "deep-dive",
      mode: "album_deep_dive",
      albumContext: bloated,
    });

    expect(token.length).toBeLessThanOrEqual(MAX_PRESET_TOKEN_LENGTH);
    const decoded = deserializeStationPreset(token);
    expect(decoded.ok).toBe(true);
  });
});

describe("share URL helpers", () => {
  it("writes and replaces the preset query param", () => {
    const url = buildStationShareUrl("https://songhost.app/", {
      stationId: "90s-alt",
      vibePrompt: "neon",
    });
    expect(url).toContain(`?${STATION_PRESET_PARAM}=`);
    expect(readPresetTokenFromSearch(new URL(url).search)).toBeTruthy();
  });

  it("strips the preset param without touching the rest of the URL", () => {
    const cleaned = stripPresetFromUrl(
      "https://songhost.app/?preset=abc&utm=1#deck",
    );
    expect(cleaned).toBe("https://songhost.app/?utm=1#deck");
  });

  it("summarises the shareable knobs for the modal", () => {
    const rows = summarizeShareableStation({
      stationId: "90s-alt",
      name: "Night Shift",
      eraLock: "90s",
      voiceProfile: { energy: "high", snark: "light" },
    });
    expect(rows.some((row) => row.label === "Station" && row.value === "Night Shift")).toBe(
      true,
    );
    expect(rows.some((row) => row.label === "Era")).toBe(true);
    expect(rows.some((row) => row.label === "Voice")).toBe(true);
  });

  it("expands a compact preset into a normalized config", () => {
    const config = fromCompactStationPreset({
      v: 1,
      id: "90s-alt",
      c: "music_focused",
      vp: { en: "low", ac: "british" },
    });
    expect(config.chatterPacing).toBe("music_focused");
    expect(config.voiceProfile).toEqual({ energy: "low", accent: "british" });
  });
});
