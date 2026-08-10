import { describe, expect, it } from "vitest";
import {
  canonicalizeSpotifyRedirectUri,
  clampSpotifyVolumeNormalized,
  lerpSpotifyVolumeLog,
  resolveSpotifyRedirectUri,
  resolveSpotifyScopes,
  SPOTIFY_DEFAULT_REDIRECT_URI,
  SPOTIFY_VOLUME_DUCK_RAMP_MS,
  SPOTIFY_VOLUME_RAMP_MS,
  toSpotifyRestVolumePercent,
} from "@/lib/player/spotifyRemote";
import {
  SPOTIFY_DUCK_RATIO,
  SPOTIFY_DUCK_RAMP_MS,
  SPOTIFY_DUCK_VOLUME_PERCENT,
  SPOTIFY_RESTORE_RAMP_MS,
} from "@/lib/player/webOrchestrator";

describe("SPOTIFY_DUCK_RATIO", () => {
  it("ducks companion Spotify volume to 25% for standard short breaks", () => {
    expect(SPOTIFY_DUCK_RATIO).toBe(0.25);
    expect(SPOTIFY_DUCK_VOLUME_PERCENT).toBe(25);
    expect(toSpotifyRestVolumePercent(SPOTIFY_DUCK_RATIO)).toBe(25);
  });

  it("uses 400ms duck-down and 600ms swell-up ramps", () => {
    expect(SPOTIFY_VOLUME_DUCK_RAMP_MS).toBe(400);
    expect(SPOTIFY_VOLUME_RAMP_MS).toBe(600);
    expect(SPOTIFY_DUCK_RAMP_MS).toBe(400);
    expect(SPOTIFY_RESTORE_RAMP_MS).toBe(600);
  });
});

describe("lerpSpotifyVolumeLog", () => {
  it("tracks equal-ratio steps between full and duck gain", () => {
    const mid = lerpSpotifyVolumeLog(1, 0.25, 0.5);
    // Geometric mean of 1.0 and 0.25 ≈ √0.25
    expect(mid).toBeCloseTo(Math.sqrt(0.25), 5);
    expect(lerpSpotifyVolumeLog(1, 0.25, 0)).toBe(1);
    expect(lerpSpotifyVolumeLog(1, 0.25, 1)).toBeCloseTo(0.25, 5);
  });
});

describe("toSpotifyRestVolumePercent", () => {
  it("maps normalized duck gain 0.5 to REST volume_percent 50", () => {
    expect(toSpotifyRestVolumePercent(0.5)).toBe(50);
  });

  it("still maps legacy 0.2 duck gain to volume_percent 20", () => {
    expect(toSpotifyRestVolumePercent(0.2)).toBe(20);
  });

  it("maps full gain to 100 and mute to 0", () => {
    expect(toSpotifyRestVolumePercent(1)).toBe(100);
    expect(toSpotifyRestVolumePercent(0)).toBe(0);
  });

  it("treats values already in percent (>1) as percent", () => {
    expect(toSpotifyRestVolumePercent(20)).toBe(20);
    expect(toSpotifyRestVolumePercent(50)).toBe(50);
    expect(toSpotifyRestVolumePercent(100)).toBe(100);
  });

  it("clamps out-of-range inputs", () => {
    expect(toSpotifyRestVolumePercent(-1)).toBe(0);
    expect(toSpotifyRestVolumePercent(250)).toBe(100);
    expect(toSpotifyRestVolumePercent(Number.NaN)).toBe(0);
  });
});

describe("clampSpotifyVolumeNormalized", () => {
  it("keeps SDK-facing floats in 0–1 (0.5 stays 0.5)", () => {
    expect(clampSpotifyVolumeNormalized(0.5)).toBeCloseTo(0.5);
    expect(clampSpotifyVolumeNormalized(0.2)).toBeCloseTo(0.2);
    expect(clampSpotifyVolumeNormalized(1.4)).toBe(1);
    expect(clampSpotifyVolumeNormalized(-0.1)).toBe(0);
  });
});

describe("resolveSpotifyScopes", () => {
  it("always includes user-modify-playback-state and streaming", () => {
    const scopes = resolveSpotifyScopes(
      "user-read-currently-playing user-read-playback-state",
    );
    const parts = scopes.split(/\s+/);
    expect(parts).toContain("user-modify-playback-state");
    expect(parts).toContain("streaming");
  });
});

describe("canonicalizeSpotifyRedirectUri", () => {
  it("corrects the reversed NextAuth-style callback path", () => {
    expect(
      canonicalizeSpotifyRedirectUri(
        "http://127.0.0.1:3000/api/auth/callback/spotify",
      ),
    ).toBe(SPOTIFY_DEFAULT_REDIRECT_URI);
  });

  it("keeps the canonical path on 127.0.0.1", () => {
    expect(
      canonicalizeSpotifyRedirectUri(
        "http://127.0.0.1:3000/api/auth/spotify/callback",
      ),
    ).toBe(SPOTIFY_DEFAULT_REDIRECT_URI);
  });
});

describe("resolveSpotifyRedirectUri", () => {
  it("defaults to the local 127.0.0.1 Spotify callback on the server", () => {
    expect(resolveSpotifyRedirectUri()).toBe(SPOTIFY_DEFAULT_REDIRECT_URI);
  });
});
