import { describe, expect, it } from "vitest";
import { STATION_SEED_TRACKS, seedTracksFor } from "@/data/station-seeds";
import { getStationById } from "@/data/stations";
import { STARTER_HISTORY_LIMIT } from "@/lib/starter-history";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A pool has to outlast the anti-repeat window with room to spare, otherwise
 * every launch past the window is forced back onto a recent opener.
 */
const MIN_POOL_SIZE = 30;

const pools = Object.entries(STATION_SEED_TRACKS);

describe("station seed pools", () => {
  it("covers the primary preset stations", () => {
    expect(pools.length).toBeGreaterThanOrEqual(14);
  });

  it("keeps every pool deeper than the anti-repeat window", () => {
    expect(MIN_POOL_SIZE).toBeGreaterThan(STARTER_HISTORY_LIMIT);

    for (const [stationId, tracks] of pools) {
      expect(`${stationId}: ${tracks.length}`).toBe(
        `${stationId}: ${Math.max(tracks.length, MIN_POOL_SIZE)}`,
      );
    }
  });

  it("holds only well-formed, playable tracks", () => {
    for (const [stationId, tracks] of pools) {
      for (const track of tracks) {
        expect(track.youtubeId, `${stationId} / ${track.title}`).toMatch(YOUTUBE_ID);
        expect(track.title.trim(), `${stationId} / ${track.youtubeId}`).not.toBe("");
        expect(track.artist.trim(), `${stationId} / ${track.youtubeId}`).not.toBe("");
      }
    }
  });

  it("never repeats a video inside a pool", () => {
    for (const [stationId, tracks] of pools) {
      const ids = new Set(tracks.map((t) => t.youtubeId));
      expect(ids.size, `${stationId} has duplicate videos`).toBe(tracks.length);
    }
  });

  it("labels a shared video with the same title", () => {
    const labels = new Map<string, { artist: string; title: string }>();
    const knownArtistSplits = new Set([
      "aC-enyY6W8I",
      "3RMmIJn_4FA",
      "s61-e29Vr6Q",
      "EaTjt_iIs2s",
    ]);

    for (const [stationId, tracks] of pools) {
      for (const track of tracks) {
        const seen = labels.get(track.youtubeId);
        if (!seen) {
          labels.set(track.youtubeId, { artist: track.artist, title: track.title });
          continue;
        }
        expect(track.title, `${stationId} / ${track.youtubeId}`).toBe(seen.title);
        if (track.artist === seen.artist) continue;
        expect(knownArtistSplits.has(track.youtubeId), `${stationId} / ${track.youtubeId}: "${track.artist}" vs "${seen.artist}"`).toBe(true);
      }
    }
  });

  it("reaches the stations that listeners actually tune in to", () => {
    for (const [stationId, tracks] of pools) {
      const station = getStationById(stationId);
      expect(station, `unknown station ${stationId}`).toBeDefined();
      expect(station!.tracks).toBe(tracks);
      // The lead video is what the carousel and saved-station snapshots quote.
      expect(station!.youtubeVideoId).toBe(tracks[0].youtubeId);
    }
  });
});

describe("seedTracksFor", () => {
  const fallback = [{ youtubeId: "aaaaaaaaaaa", title: "Fallback", artist: "Nobody" }];

  it("returns the deep pool for a curated station", () => {
    expect(seedTracksFor("alternative-rock", fallback)).toBe(
      STATION_SEED_TRACKS["alternative-rock"],
    );
    expect(seedTracksFor("classical-masters", fallback)).toBe(
      STATION_SEED_TRACKS["classical-masters"],
    );
  });

  it("falls back for a station that has not been curated to depth", () => {
    expect(seedTracksFor("not-a-real-station", fallback)).toBe(fallback);
    expect(seedTracksFor("", fallback)).toBe(fallback);
  });
});
