import { describe, expect, it } from "vitest";
import {
  assignMemoryPreset,
  CHATTER_PACING_ORDER,
  clearMemoryPreset,
  createEmptyMemoryPresets,
  DEFAULT_CHATTER_PACING,
  DEFAULT_ERA_LOCK,
  ERA_LOCK_ORDER,
  eraYearBounds,
  findMemoryPresetSlot,
  formatEraWindow,
  getChatterPacingProfile,
  isChatterPacing,
  isDjMuted,
  isEraLock,
  isEraLocked,
  MAX_VIBE_PROMPT_LENGTH,
  MEMORY_PRESET_COUNT,
  normalizeMemoryPresets,
  normalizeStationConfig,
  normalizeStationConfigs,
  resolveChatterPacing,
  resolveEraLock,
  resolveStationSettings,
  sanitizeVibePrompt,
} from "../station";

const station = {
  id: "90s-alt",
  name: "90s Alternative",
  frequency: 104.5,
  defaultPersonaId: "sloane-vance" as const,
};

describe("chatter pacing", () => {
  it("offers exactly the four documented levels", () => {
    expect([...CHATTER_PACING_ORDER]).toEqual([
      "talkative",
      "standard",
      "music_focused",
      "music_only",
    ]);
  });

  it("defaults to standard", () => {
    expect(DEFAULT_CHATTER_PACING).toBe("standard");
  });

  it("maps each level onto the documented track gap", () => {
    expect(getChatterPacingProfile("talkative").minGap).toBe(1);
    expect(getChatterPacingProfile("talkative").maxGap).toBe(2);
    expect(getChatterPacingProfile("standard").minGap).toBe(2);
    expect(getChatterPacingProfile("standard").maxGap).toBe(4);
    expect(getChatterPacingProfile("music_focused").minGap).toBe(5);
  });

  it("only alternates stingers at the tightest pacing", () => {
    expect(getChatterPacingProfile("talkative").alternateStinger).toBe(true);
    expect(getChatterPacingProfile("standard").alternateStinger).toBe(false);
    expect(getChatterPacingProfile("music_focused").alternateStinger).toBe(false);
  });

  it("treats music_only as a full host mute", () => {
    expect(isDjMuted("music_only")).toBe(true);
    expect(isDjMuted("music_focused")).toBe(false);
  });

  it("falls back rather than sticking on an unusable value", () => {
    expect(isChatterPacing("chatty")).toBe(false);
    expect(resolveChatterPacing("chatty")).toBe(DEFAULT_CHATTER_PACING);
    expect(resolveChatterPacing(undefined)).toBe(DEFAULT_CHATTER_PACING);
    expect(resolveChatterPacing("music_only")).toBe("music_only");
  });
});

describe("era locking", () => {
  it("defaults to no restriction", () => {
    expect(DEFAULT_ERA_LOCK).toBe("all");
    expect(isEraLocked("all")).toBe(false);
    expect(eraYearBounds("all")).toBeNull();
  });

  it("gives every decade an inclusive ten-year window", () => {
    for (const era of ERA_LOCK_ORDER) {
      if (era === "all") continue;
      const bounds = eraYearBounds(era);
      expect(bounds).not.toBeNull();
      expect(bounds!.endYear - bounds!.startYear).toBe(9);
    }
  });

  it("bounds the named decades exactly", () => {
    expect(eraYearBounds("70s")).toEqual({ startYear: 1970, endYear: 1979 });
    expect(eraYearBounds("80s")).toEqual({ startYear: 1980, endYear: 1989 });
    expect(eraYearBounds("90s")).toEqual({ startYear: 1990, endYear: 1999 });
    expect(eraYearBounds("2000s")).toEqual({ startYear: 2000, endYear: 2009 });
  });

  it("formats an on-air window for the host", () => {
    expect(formatEraWindow("80s")).toBe("the 80s (1980–1989)");
    expect(formatEraWindow("all")).toBeNull();
  });

  it("rejects unknown eras rather than trusting them", () => {
    expect(isEraLock("40s")).toBe(false);
    expect(resolveEraLock("40s")).toBe("all");
    expect(resolveEraLock("90s")).toBe("90s");
  });
});

describe("memory presets", () => {
  const preset = {
    stationId: "90s-alt",
    stationName: "90s Alternative",
    frequency: 104.5,
    accentColor: "#C4882A",
  };

  it("starts as six empty slots", () => {
    const presets = createEmptyMemoryPresets();
    expect(presets).toHaveLength(MEMORY_PRESET_COUNT);
    expect(presets.every((slot) => slot === null)).toBe(true);
  });

  it("assigns a station to a slot and stamps the slot number", () => {
    const presets = assignMemoryPreset(createEmptyMemoryPresets(), 3, preset);
    expect(presets[2]?.stationId).toBe("90s-alt");
    expect(presets[2]?.slot).toBe(3);
    expect(presets[2]?.savedAt).toBeTruthy();
  });

  it("ignores a slot outside 1–6", () => {
    const presets = assignMemoryPreset(createEmptyMemoryPresets(), 9, preset);
    expect(presets).toHaveLength(MEMORY_PRESET_COUNT);
    expect(presets.every((slot) => slot === null)).toBe(true);
  });

  it("overwrites an occupied slot in place", () => {
    let presets = assignMemoryPreset(createEmptyMemoryPresets(), 1, preset);
    presets = assignMemoryPreset(presets, 1, { ...preset, stationId: "80s", stationName: "80s" });
    expect(presets[0]?.stationId).toBe("80s");
    expect(presets.filter(Boolean)).toHaveLength(1);
  });

  it("clears a slot back to empty", () => {
    const presets = clearMemoryPreset(assignMemoryPreset(createEmptyMemoryPresets(), 2, preset), 2);
    expect(presets[1]).toBeNull();
  });

  it("finds which button a station is parked on", () => {
    const presets = assignMemoryPreset(createEmptyMemoryPresets(), 5, preset);
    expect(findMemoryPresetSlot(presets, "90s-alt")).toBe(5);
    expect(findMemoryPresetSlot(presets, "70s-disco")).toBeNull();
  });

  it("length-locks a short or malformed persisted list", () => {
    expect(normalizeMemoryPresets(undefined)).toHaveLength(MEMORY_PRESET_COUNT);
    expect(normalizeMemoryPresets([preset])).toHaveLength(MEMORY_PRESET_COUNT);
    expect(normalizeMemoryPresets([{ stationId: "" }, "junk", null])[0]).toBeNull();
  });

  it("rewrites slot numbers from position so a shifted list stays addressable", () => {
    const stored = [null, { ...preset, slot: 99 }];
    expect(normalizeMemoryPresets(stored)[1]?.slot).toBe(2);
  });
});

describe("station config overrides", () => {
  it("drops values it cannot trust", () => {
    const config = normalizeStationConfig("90s-alt", {
      chatterPacing: "chatty" as never,
      eraLock: "40s" as never,
      frequency: Number.NaN,
    });
    expect(config.chatterPacing).toBeUndefined();
    expect(config.eraLock).toBeUndefined();
    expect(config.frequency).toBeUndefined();
  });

  it("keeps the values it can", () => {
    const config = normalizeStationConfig("90s-alt", {
      chatterPacing: "music_only",
      eraLock: "90s",
      frequency: 104.53,
      vibePrompt: "  moody   late-night  ",
    });
    expect(config.chatterPacing).toBe("music_only");
    expect(config.eraLock).toBe("90s");
    expect(config.frequency).toBe(104.5);
    expect(config.vibePrompt).toBe("moody late-night");
  });

  it("normalizes a whole persisted map", () => {
    const map = normalizeStationConfigs({ "90s-alt": { eraLock: "90s" }, "": { eraLock: "80s" } });
    expect(Object.keys(map)).toEqual(["90s-alt"]);
  });

  it("caps a runaway vibe prompt", () => {
    expect(sanitizeVibePrompt("x".repeat(1000))).toHaveLength(MAX_VIBE_PROMPT_LENGTH);
    expect(sanitizeVibePrompt(42)).toBe("");
  });
});

describe("resolveStationSettings", () => {
  it("falls back to the station's own defaults with no override", () => {
    const settings = resolveStationSettings(station, undefined, "talkative");
    expect(settings.name).toBe("90s Alternative");
    expect(settings.frequency).toBe(104.5);
    expect(settings.personaId).toBe("sloane-vance");
    expect(settings.eraLock).toBe("all");
    expect(settings.hostIsOverridden).toBe(false);
  });

  it("lets the listener's global pacing through when the station sets none", () => {
    expect(resolveStationSettings(station, { stationId: station.id }, "music_focused").chatterPacing)
      .toBe("music_focused");
  });

  it("gives a station-level pacing override precedence over the global setting", () => {
    const settings = resolveStationSettings(
      station,
      { stationId: station.id, chatterPacing: "music_only" },
      "talkative",
    );
    expect(settings.chatterPacing).toBe("music_only");
  });

  it("applies host, name, frequency, era, and vibe overrides", () => {
    const settings = resolveStationSettings(
      station,
      {
        stationId: station.id,
        name: "Night Shift",
        frequency: 88.1,
        hostPersonaId: "kira-nova",
        eraLock: "90s",
        vibePrompt: "neon rain",
      },
      "standard",
    );
    expect(settings.name).toBe("Night Shift");
    expect(settings.frequency).toBe(88.1);
    expect(settings.personaId).toBe("kira-nova");
    expect(settings.hostIsOverridden).toBe(true);
    expect(settings.eraLock).toBe("90s");
    expect(settings.vibePrompt).toBe("neon rain");
  });

  it("treats a cleared host override as an inherited default", () => {
    const settings = resolveStationSettings(
      station,
      { stationId: station.id, hostPersonaId: null },
      "standard",
    );
    expect(settings.personaId).toBe("sloane-vance");
    expect(settings.hostIsOverridden).toBe(false);
  });
});
