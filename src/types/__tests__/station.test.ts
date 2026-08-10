import { describe, expect, it } from "vitest";
import {
  albumTrackTitleKey,
  assignMemoryPreset,
  CHATTER_PACING_ORDER,
  clearMemoryPreset,
  createEmptyMemoryPresets,
  DEFAULT_CHATTER_PACING,
  DEFAULT_ERA_LOCK,
  DEFAULT_STATION_MODE,
  describeAlbumRelease,
  ERA_LOCK_ORDER,
  eraYearBounds,
  findAlbumTrackIndex,
  findMemoryPresetSlot,
  formatAlbumCredit,
  formatEraWindow,
  getChatterPacingProfile,
  isAlbumDeepDive,
  isChatterPacing,
  isDjMuted,
  isEraLock,
  isEraLocked,
  isPlayableAlbumContext,
  isStationMode,
  MAX_ALBUM_TRACKS,
  MAX_VIBE_PROMPT_LENGTH,
  MEMORY_PRESET_COUNT,
  normalizeAlbumContext,
  normalizeAlbumPersonnel,
  normalizeAlbumTrackList,
  normalizeMemoryPresets,
  normalizeStationConfig,
  normalizeStationConfigs,
  normalizeVoiceProfileOverride,
  resolveChatterPacing,
  resolveEraLock,
  resolveStationMode,
  resolveStationSettings,
  sanitizeVibePrompt,
  STATION_MODE_ORDER,
  type AlbumContext,
} from "../station";

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
    { position: 1, title: "Second Hand News", side: "A" },
    { position: 2, title: "Dreams", side: "A" },
    { position: 3, title: "Never Going Back Again", side: "A" },
  ],
};

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

describe("station mode", () => {
  it("offers exactly the two documented formats and defaults to rotation", () => {
    expect([...STATION_MODE_ORDER]).toEqual(["standard", "album_deep_dive"]);
    expect(DEFAULT_STATION_MODE).toBe("standard");
  });

  it("falls back rather than sticking on an unusable value", () => {
    expect(isStationMode("album")).toBe(false);
    expect(resolveStationMode("album")).toBe("standard");
    expect(resolveStationMode("album_deep_dive")).toBe("album_deep_dive");
    expect(isAlbumDeepDive("album_deep_dive")).toBe(true);
    expect(isAlbumDeepDive(undefined)).toBe(false);
  });
});

describe("album track title matching", () => {
  it("ignores the reissue decoration store fronts attach", () => {
    expect(albumTrackTitleKey("Dreams (2004 Remaster)")).toBe(albumTrackTitleKey("Dreams"));
    expect(albumTrackTitleKey("Dreams - Single Version")).toBe(albumTrackTitleKey("Dreams"));
    expect(albumTrackTitleKey("Dreams [Live]")).toBe(albumTrackTitleKey("Dreams"));
  });

  it("ignores case, spacing, and punctuation", () => {
    expect(albumTrackTitleKey("Don't Stop")).toBe(albumTrackTitleKey("dont  stop"));
  });

  it("keeps genuinely different songs apart", () => {
    expect(albumTrackTitleKey("Dreams")).not.toBe(albumTrackTitleKey("Gold Dust Woman"));
  });

  it("is empty for anything that is not a title", () => {
    expect(albumTrackTitleKey(undefined)).toBe("");
    expect(albumTrackTitleKey("(Remastered)")).toBe("");
  });
});

describe("album context normalization", () => {
  it("keeps a complete sleeve intact", () => {
    const album = normalizeAlbumContext(rumours);
    expect(album?.albumTitle).toBe("Rumours");
    expect(album?.releaseYear).toBe(1977);
    expect(album?.recordingStudio).toBe("Record Plant, Sausalito");
    expect(album?.personnel).toHaveLength(2);
    expect(album?.trackList).toHaveLength(3);
  });

  it("rejects a sleeve with nothing to play or talk about", () => {
    expect(normalizeAlbumContext(undefined)).toBeNull();
    expect(normalizeAlbumContext({ ...rumours, trackList: [] })).toBeNull();
    expect(normalizeAlbumContext({ ...rumours, albumTitle: "  " })).toBeNull();
    expect(normalizeAlbumContext({ ...rumours, artist: "" })).toBeNull();
    expect(isPlayableAlbumContext(rumours)).toBe(true);
    expect(isPlayableAlbumContext({ albumTitle: "Rumours" })).toBe(false);
  });

  it("rewrites positions from list order so the running order stays addressable", () => {
    const tracks = normalizeAlbumTrackList([
      { position: 9, title: "Second Hand News" },
      { position: 9, title: "Dreams" },
    ]);
    expect(tracks.map((t) => t.position)).toEqual([1, 2]);
  });

  it("drops entries it cannot place and caps a runaway tracklist", () => {
    expect(normalizeAlbumTrackList([{ title: "" }, "junk", null, 7])).toEqual([]);
    const flood = Array.from({ length: 100 }, (_, i) => ({ title: `Track ${i}` }));
    expect(normalizeAlbumTrackList(flood)).toHaveLength(MAX_ALBUM_TRACKS);
  });

  it("drops values it cannot trust off a track entry", () => {
    const [track] = normalizeAlbumTrackList([
      { title: "Dreams", durationSeconds: -4, side: "A", note: "  cut in one take  " },
    ]);
    expect(track.durationSeconds).toBeUndefined();
    expect(track.side).toBe("A");
    expect(track.note).toBe("cut in one take");
  });

  it("requires a name on every credit", () => {
    const personnel = normalizeAlbumPersonnel([
      { name: "John McVie", role: "bass" },
      { role: "orphan role" },
      { name: "Mick Fleetwood" },
    ]);
    expect(personnel).toEqual([
      { name: "John McVie", role: "bass" },
      { name: "Mick Fleetwood", role: "" },
    ]);
  });

  it("drops a release year that is not a whole year", () => {
    expect(normalizeAlbumContext({ ...rumours, releaseYear: 1977.5 })?.releaseYear).toBeUndefined();
  });
});

describe("album context helpers", () => {
  it("names the record the way the host would", () => {
    expect(describeAlbumRelease(rumours)).toBe('"Rumours" by Fleetwood Mac (1977)');
    expect(describeAlbumRelease({ ...rumours, releaseYear: undefined })).toBe(
      '"Rumours" by Fleetwood Mac',
    );
  });

  it("formats a credit with and without a role", () => {
    expect(formatAlbumCredit({ name: "Stevie Nicks", role: "vocals" })).toBe(
      "Stevie Nicks (vocals)",
    );
    expect(formatAlbumCredit({ name: "Stevie Nicks", role: "" })).toBe("Stevie Nicks");
  });

  it("finds a recording's position through a reissue title", () => {
    expect(findAlbumTrackIndex(rumours, "Dreams (2004 Remaster)")).toBe(1);
    expect(findAlbumTrackIndex(rumours, "Gold Dust Woman")).toBe(-1);
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

  it("hydrates older sparse configs with schema defaults instead of invalidating them", () => {
    const config = normalizeStationConfig("90s-alt", { eraLock: "90s" });
    expect(config).toEqual({
      stationId: "90s-alt",
      eraLock: "90s",
      mode: "standard",
      albumContext: null,
    });
    expect(config.voiceProfile).toBeUndefined();

    const empty = normalizeStationConfig("legacy-mix", undefined);
    expect(empty.mode).toBe("standard");
    expect(empty.albumContext).toBeNull();
    expect(empty.voiceProfile).toBeUndefined();
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
    expect(config.mode).toBe("standard");
    expect(config.albumContext).toBeNull();
  });

  it("normalizes a whole persisted map", () => {
    const map = normalizeStationConfigs({ "90s-alt": { eraLock: "90s" }, "": { eraLock: "80s" } });
    expect(Object.keys(map)).toEqual(["90s-alt"]);
    expect(map["90s-alt"]?.mode).toBe("standard");
  });

  it("persists a deep dive mode and its sleeve, falling back when unusable", () => {
    const kept = normalizeStationConfig("rumours", {
      mode: "album_deep_dive",
      albumContext: rumours,
    });
    expect(kept.mode).toBe("album_deep_dive");
    expect(kept.albumContext?.albumTitle).toBe("Rumours");

    const dropped = normalizeStationConfig("rumours", {
      mode: "deep_dive" as never,
      albumContext: { albumTitle: "Rumours" } as never,
    });
    expect(dropped.mode).toBe("standard");
    expect(dropped.albumContext).toBeNull();
  });

  it("caps a runaway vibe prompt", () => {
    expect(sanitizeVibePrompt("x".repeat(1000))).toHaveLength(MAX_VIBE_PROMPT_LENGTH);
    expect(sanitizeVibePrompt(42)).toBe("");
  });

  it("keeps valid voice tuning knobs and drops unknown ones", () => {
    expect(
      normalizeVoiceProfileOverride({
        energy: "high",
        accent: "nyc",
        snark: "sassy" as never,
        pacing: "rapid",
      }),
    ).toEqual({ energy: "high", accent: "nyc", pacing: "rapid" });
    expect(normalizeVoiceProfileOverride({})).toBeUndefined();
  });

  it("persists a voice profile on the station config", () => {
    const config = normalizeStationConfig("90s-alt", {
      voiceProfile: { energy: "low", snark: "light" },
    });
    expect(config.voiceProfile).toEqual({ energy: "low", snark: "light" });
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

  it("runs a standard rotation with no mode set", () => {
    const settings = resolveStationSettings(station, undefined, "standard");
    expect(settings.mode).toBe("standard");
    expect(settings.albumContext).toBeNull();
  });

  it("turns on the deep dive when a mode and a usable sleeve are both present", () => {
    const settings = resolveStationSettings(
      station,
      { stationId: station.id, mode: "album_deep_dive", albumContext: rumours },
      "standard",
    );
    expect(settings.mode).toBe("album_deep_dive");
    expect(settings.albumContext?.trackList).toHaveLength(3);
  });

  it("degrades a deep dive with no sleeve back to a standard station", () => {
    const settings = resolveStationSettings(
      station,
      { stationId: station.id, mode: "album_deep_dive" },
      "standard",
    );
    expect(settings.mode).toBe("standard");
    expect(settings.albumContext).toBeNull();
  });

  it("degrades a deep dive whose sleeve has no running order", () => {
    const settings = resolveStationSettings(
      station,
      {
        stationId: station.id,
        mode: "album_deep_dive",
        albumContext: { ...rumours, trackList: [] },
      },
      "standard",
    );
    expect(settings.mode).toBe("standard");
  });

  it("does not turn a sleeve alone into a deep dive", () => {
    const settings = resolveStationSettings(
      station,
      { stationId: station.id, albumContext: rumours },
      "standard",
    );
    expect(settings.mode).toBe("standard");
    expect(settings.albumContext).not.toBeNull();
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

  it("surfaces voice tuning on resolved settings", () => {
    const settings = resolveStationSettings(
      station,
      {
        stationId: station.id,
        voiceProfile: { energy: "high", accent: "british" },
      },
      "standard",
    );
    expect(settings.voiceProfile).toEqual({ energy: "high", accent: "british" });
    expect(resolveStationSettings(station, undefined, "standard").voiceProfile).toBeNull();
  });

  it("defaults commentaryFormat to standard and lets station overrides win", () => {
    expect(resolveStationSettings(station, undefined, "standard").commentaryFormat).toBe(
      "standard",
    );
    expect(
      resolveStationSettings(station, undefined, "standard", "time_capsule").commentaryFormat,
    ).toBe("time_capsule");
    expect(
      resolveStationSettings(
        station,
        { stationId: station.id, commentaryFormat: "directors_cut" },
        "standard",
        "roots_branches",
      ).commentaryFormat,
    ).toBe("directors_cut");
  });
});
