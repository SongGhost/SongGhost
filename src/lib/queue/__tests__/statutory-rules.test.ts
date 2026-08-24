import { afterEach, describe, expect, it } from "vitest";
import type { StationTrack } from "@/data/stations";
import {
  MAX_ALBUM_PER_WINDOW,
  MAX_ARTIST_PER_WINDOW,
  MAX_CONSECUTIVE_ALBUM,
  MAX_CONSECUTIVE_ARTIST,
  STATUTORY_WINDOW_MS,
  clearAirLog,
  filterStatutoryAdmissions,
  getAirLog,
  normalizeAlbumKey,
  primaryArtistName,
  recordAirLogEntry,
  seedAirLogFromPlayedTracks,
  validateStatutoryAdmission,
} from "../statutory-rules";

function track(
  title: string,
  artist: string,
  album?: string,
): StationTrack {
  return {
    youtubeId: `${artist}-${title}`.toLowerCase().replace(/\s+/g, "-"),
    title,
    artist,
    album,
  };
}

afterEach(() => {
  clearAirLog();
});

describe("primaryArtistName / normalizeAlbumKey", () => {
  it("isolates the featured primary artist", () => {
    expect(primaryArtistName("Fleetwood Mac & Lindsey Buckingham")).toBe("Fleetwood Mac");
    expect(primaryArtistName("Prince feat. The Revolution")).toBe("Prince");
  });

  it("strips remaster suffixes from album keys", () => {
    expect(normalizeAlbumKey("Rumours (Remastered 2013)")).toBe("rumours");
  });
});

describe("validateStatutoryAdmission", () => {
  // Caps DEFERRED Aug 24 2026 — former rejections now admit (pass-through).
  it("admits a 5th appearance of the same artist inside 3 hours (caps deferred)", () => {
    const now = 1_700_000_000_000;
    const rumours = ["Second Hand News", "Dreams", "Never Going Back Again", "Don't Stop"].map(
      (title) => track(title, "Fleetwood Mac", "Rumours"),
    );
    rumours.forEach((row, i) => recordAirLogEntry(row, now - 60_000 * (4 - i)));

    expect(
      validateStatutoryAdmission(track("Go Your Own Way", "Fleetwood Mac", "Heroes"), {
        now,
      }),
    ).toBe(true);
    expect(MAX_ARTIST_PER_WINDOW).toBe(4);
  });

  it("admits a 4th appearance of the same album inside 3 hours (caps deferred)", () => {
    const now = 1_700_000_000_000;
    recordAirLogEntry(track("A", "Artist One", "Same Album"), now - 10_000);
    recordAirLogEntry(track("B", "Artist Two", "Same Album"), now - 8_000);
    recordAirLogEntry(track("C", "Artist Three", "Same Album"), now - 6_000);

    expect(
      validateStatutoryAdmission(track("D", "Artist Four", "Same Album"), { now }),
    ).toBe(true);
    expect(MAX_ALBUM_PER_WINDOW).toBe(3);
  });

  it("admits a 4th consecutive track by the same artist (caps deferred)", () => {
    const queued = [
      track("One", "The Cure", "Disintegration"),
      track("Two", "The Cure", "Wish"),
      track("Three", "The Cure", "Kiss Me"),
    ];
    expect(
      validateStatutoryAdmission(track("Four", "The Cure", "Wild Mood Swings"), { queued }),
    ).toBe(true);
    expect(MAX_CONSECUTIVE_ARTIST).toBe(3);
  });

  it("admits a 3rd consecutive track from the same album (caps deferred)", () => {
    const queued = [
      track("Dreams", "Fleetwood Mac", "Rumours"),
      track("Go Your Own Way", "Fleetwood Mac", "Rumours"),
    ];
    expect(
      validateStatutoryAdmission(track("Don't Stop", "Fleetwood Mac", "Rumours"), { queued }),
    ).toBe(true);
    expect(MAX_CONSECUTIVE_ALBUM).toBe(2);
  });

  it("admits both a same-artist 4th track and a different artist after a 3-track run (caps deferred)", () => {
    const queued = [
      track("One", "The Cure", "Disintegration"),
      track("Two", "The Cure", "Wish"),
      track("Three", "The Cure", "Kiss Me"),
    ];
    expect(
      validateStatutoryAdmission(track("Just Like Heaven", "The Cure", "Kiss Me Kiss Me Kiss Me"), {
        queued,
      }),
    ).toBe(true);
    expect(
      validateStatutoryAdmission(track("Bizarre Love Triangle", "New Order", "Brotherhood"), {
        queued,
      }),
    ).toBe(true);
  });

  it("ignores air-log entries older than 3 hours", () => {
    const now = 1_700_000_000_000;
    recordAirLogEntry(track("Old 1", "The Smiths", "Hatful"), now - STATUTORY_WINDOW_MS - 1);
    recordAirLogEntry(track("Old 2", "The Smiths", "Hatful"), now - STATUTORY_WINDOW_MS - 2);
    recordAirLogEntry(track("Old 3", "The Smiths", "Meat"), now - STATUTORY_WINDOW_MS - 3);
    recordAirLogEntry(track("Old 4", "The Smiths", "Meat"), now - STATUTORY_WINDOW_MS - 4);

    expect(
      validateStatutoryAdmission(track("This Charming Man", "The Smiths", "Hatful"), { now }),
    ).toBe(true);
  });

  it("does not apply the album cap when the candidate has no album identity", () => {
    const now = 1_700_000_000_000;
    recordAirLogEntry(track("A", "Solo Act"), now - 1_000);
    recordAirLogEntry(track("B", "Other Act"), now - 800);
    recordAirLogEntry(track("C", "Third Act"), now - 600);
    expect(validateStatutoryAdmission(track("D", "Fourth Act"), { now })).toBe(true);
  });
});

describe("filterStatutoryAdmissions", () => {
  it("admits the full mixed pool (caps deferred; no artist/album filtering)", () => {
    const pool = [
      track("Dreams", "Fleetwood Mac", "Rumours"),
      track("Go Your Own Way", "Fleetwood Mac", "Rumours"),
      track("Don't Stop", "Fleetwood Mac", "Rumours"),
      track("Rhiannon", "Fleetwood Mac", "Fleetwood Mac"),
      track("Blue Monday", "New Order", "Power, Corruption & Lies"),
      track("Bizarre Love Triangle", "New Order", "Brotherhood"),
    ];
    const admitted = filterStatutoryAdmissions(pool);
    expect(admitted.map((row) => row.title)).toEqual(pool.map((row) => row.title));
    expect(admitted).not.toBe(pool);
  });
});

describe("seedAirLogFromPlayedTracks", () => {
  it("hydrates an empty air-log once and does not replace on a second seed (caps deferred so admission still passes)", () => {
    seedAirLogFromPlayedTracks([track("Dreams", "Fleetwood Mac", "Rumours")]);
    seedAirLogFromPlayedTracks([track("Blue Monday", "New Order", "Power")]);
    expect(getAirLog()).toHaveLength(1);
    expect(getAirLog()[0]?.artistKey).toContain("fleetwood");
    expect(
      validateStatutoryAdmission(track("Don't Stop", "Fleetwood Mac", "Rumours"), {
        queued: [track("Go Your Own Way", "Fleetwood Mac", "Rumours")],
      }),
    ).toBe(true);
  });
});
