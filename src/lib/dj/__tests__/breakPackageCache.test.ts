import { describe, expect, it } from "vitest";
import {
  TWO_AHEAD_DEPTH,
  breakPackageCacheKey,
  buildBreakSettingsFingerprint,
  trackKeyFromPackageCacheKey,
  twoAheadTargets,
} from "../breakPackageCache";

describe("buildBreakSettingsFingerprint", () => {
  it("is stable for the same knobs", () => {
    const input = {
      provider: "local",
      voice: "local:1",
      voiceSlot: 1,
      personaId: "warm-companion",
      commentaryFormat: "roots_branches",
      chatterPacing: "standard",
      vibePrompt: "sunset drive",
      voiceProfile: { energy: "medium", accent: "american" },
      tier: "pro",
      allowExplicit: false,
      alwaysAnnounceSongs: true,
      homeCity: "Austin",
      stationId: "k-gold",
    };
    expect(buildBreakSettingsFingerprint(input)).toBe(
      buildBreakSettingsFingerprint({ ...input }),
    );
  });

  it("changes when voice, lore tier, persona, or vibe change", () => {
    const base = {
      provider: "local",
      voice: "local:1",
      personaId: "warm-companion",
      commentaryFormat: "standard",
      vibePrompt: "late night",
    };
    const a = buildBreakSettingsFingerprint(base);
    expect(buildBreakSettingsFingerprint({ ...base, voice: "local:2" })).not.toBe(a);
    expect(
      buildBreakSettingsFingerprint({ ...base, commentaryFormat: "directors_cut" }),
    ).not.toBe(a);
    expect(buildBreakSettingsFingerprint({ ...base, personaId: "hype-dj" })).not.toBe(a);
    expect(buildBreakSettingsFingerprint({ ...base, vibePrompt: "morning" })).not.toBe(a);
  });

  it("changes when pacing, city, or explicit gate change", () => {
    const base = {
      chatterPacing: "standard",
      homeCity: "Denver",
      allowExplicit: false,
    };
    const a = buildBreakSettingsFingerprint(base);
    expect(buildBreakSettingsFingerprint({ ...base, chatterPacing: "talkative" })).not.toBe(a);
    expect(buildBreakSettingsFingerprint({ ...base, homeCity: "Austin" })).not.toBe(a);
    expect(buildBreakSettingsFingerprint({ ...base, allowExplicit: true })).not.toBe(a);
  });
});

describe("breakPackageCacheKey", () => {
  it("is unique per track + fingerprint and parses the track back out", () => {
    const fpA = buildBreakSettingsFingerprint({ voice: "echo" });
    const fpB = buildBreakSettingsFingerprint({ voice: "nova" });
    const keyA = breakPackageCacheKey("track-n1", fpA);
    const keyB = breakPackageCacheKey("track-n1", fpB);
    const keyC = breakPackageCacheKey("track-n2", fpA);

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
    expect(trackKeyFromPackageCacheKey(keyA)).toBe("track-n1");
    expect(trackKeyFromPackageCacheKey(keyC)).toBe("track-n2");
  });
});

describe("twoAheadTargets", () => {
  const queue = [
    { trackKey: "n", title: "Now", artist: "On Air" },
    { trackKey: "n1", title: "Next", artist: "One" },
    { trackKey: "n2", title: "Later", artist: "Two" },
    { trackKey: "n3", title: "After", artist: "Three" },
  ];

  it("targets exactly two upcoming transitions from song start", () => {
    expect(TWO_AHEAD_DEPTH).toBe(2);
    const targets = twoAheadTargets(queue, 0);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      trackKey: "n1",
      depth: 1,
      previousTrack: { title: "Now", artist: "On Air" },
    });
    expect(targets[1]).toMatchObject({
      trackKey: "n2",
      depth: 2,
      previousTrack: { title: "Next", artist: "One" },
    });
  });

  it("does not include the on-air row or a third lookahead", () => {
    const keys = twoAheadTargets(queue, 0).map((t) => t.trackKey);
    expect(keys).toEqual(["n1", "n2"]);
    expect(keys).not.toContain("n");
    expect(keys).not.toContain("n3");
  });

  it("shrinks when fewer than two tracks remain", () => {
    expect(twoAheadTargets(queue, 2).map((t) => t.trackKey)).toEqual(["n3"]);
    expect(twoAheadTargets(queue, 3)).toEqual([]);
  });

  it("retargets after a skip (new current index)", () => {
    const afterSkip = twoAheadTargets(queue, 1);
    expect(afterSkip.map((t) => t.trackKey)).toEqual(["n2", "n3"]);
    expect(afterSkip[0]?.previousTrack).toEqual({ title: "Next", artist: "One" });
  });
});
