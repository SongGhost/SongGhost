import { describe, expect, it } from "vitest";
import {
  CATALOG_TITLE_BLACKLIST,
  hasBlacklistedTitle,
  isAcceptableArtistRadioTrack,
  isAcceptableCatalogTrack,
  isAcceptableTrackDuration,
  MAX_TRACK_DURATION_SEC,
  MIN_TRACK_DURATION_SEC,
} from "../track-quality";
import { parseClockDuration, parseIso8601Duration } from "../youtube-search";

describe("catalog title blacklist", () => {
  it("rejects every configured keyword case-insensitively", () => {
    for (const keyword of CATALOG_TITLE_BLACKLIST) {
      expect(hasBlacklistedTitle(`Artist - ${keyword.toUpperCase()} Live`)).toBe(true);
    }
  });

  it("allows ordinary single titles", () => {
    expect(hasBlacklistedTitle("Hotel California")).toBe(false);
    expect(hasBlacklistedTitle("Fake Plastic Trees")).toBe(false);
  });
});

describe("catalog duration window", () => {
  it("accepts the inclusive 90s–600s radio window", () => {
    expect(isAcceptableTrackDuration(MIN_TRACK_DURATION_SEC)).toBe(true);
    expect(isAcceptableTrackDuration(MAX_TRACK_DURATION_SEC)).toBe(true);
    expect(isAcceptableTrackDuration(210)).toBe(true);
  });

  it("rejects shorts and longform dumps", () => {
    expect(isAcceptableTrackDuration(89)).toBe(false);
    expect(isAcceptableTrackDuration(601)).toBe(false);
  });

  it("treats unknown duration as acceptable (title gate still applies)", () => {
    expect(isAcceptableTrackDuration(undefined)).toBe(true);
    expect(isAcceptableTrackDuration(null)).toBe(true);
  });
});

describe("isAcceptableCatalogTrack", () => {
  it("rejects blacklisted titles even with a good duration", () => {
    expect(
      isAcceptableCatalogTrack({ title: "Greatest Hits Full Album", durationSeconds: 240 }),
    ).toBe(false);
  });

  it("rejects out-of-window durations", () => {
    expect(isAcceptableCatalogTrack({ title: "Normal Song", durationSeconds: 45 })).toBe(false);
    expect(isAcceptableCatalogTrack({ title: "Normal Song", durationMs: 720_000 })).toBe(false);
  });

  it("accepts a radio-length single", () => {
    expect(
      isAcceptableCatalogTrack({ title: "Normal Song", durationMs: 210_000 }),
    ).toBe(true);
  });
});

describe("isAcceptableArtistRadioTrack", () => {
  it("still rejects karaoke / cover junk", () => {
    expect(isAcceptableArtistRadioTrack("Wonderwall Karaoke")).toBe(false);
  });

  it("applies duration when provided", () => {
    expect(
      isAcceptableArtistRadioTrack("Wonderwall", { durationSeconds: 45 }),
    ).toBe(false);
    expect(
      isAcceptableArtistRadioTrack("Wonderwall", { durationMs: 250_000 }),
    ).toBe(true);
  });
});

describe("YouTube duration parsers", () => {
  it("parses clock labels", () => {
    expect(parseClockDuration("3:45")).toBe(225);
    expect(parseClockDuration("1:02:03")).toBe(3723);
  });

  it("parses ISO-8601 contentDetails durations", () => {
    expect(parseIso8601Duration("PT3M45S")).toBe(225);
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("PT10H")).toBe(36_000);
  });
});
