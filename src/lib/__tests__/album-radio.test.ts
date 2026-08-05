import { describe, expect, it } from "vitest";
import {
  buildAlbumContextFromITunes,
  buildAlbumRadioResult,
  createAlbumDeepDiveStation,
} from "@/lib/album-radio";
import type { ITunesAlbum, ITunesSong } from "@/lib/itunes";
import type { StationTrack } from "@/data/stations";
import { buildStationQueue } from "@/lib/queue/builder";

const rumoursMeta: ITunesAlbum = {
  collectionId: 1065975593,
  albumTitle: "Rumours",
  artist: "Fleetwood Mac",
  releaseYear: 1977,
  coverArtUrl: "https://example.com/rumours.jpg",
  copyright: "℗ 1977 Warner Bros. Records",
  trackCount: 11,
};

const rumoursSongs: ITunesSong[] = [
  { title: "Second Hand News", artist: "Fleetwood Mac", trackNumber: 1, durationMs: 164000 },
  { title: "Dreams", artist: "Fleetwood Mac", trackNumber: 2, durationMs: 257000 },
  { title: "Never Going Back Again", artist: "Fleetwood Mac", trackNumber: 3, durationMs: 136000 },
];

const rumoursTracks: StationTrack[] = [
  { youtubeId: "yt1", title: "Dreams", artist: "Fleetwood Mac", releaseYear: 1977 },
  { youtubeId: "yt2", title: "Second Hand News", artist: "Fleetwood Mac", releaseYear: 1977 },
  { youtubeId: "yt3", title: "Never Going Back Again", artist: "Fleetwood Mac", releaseYear: 1977 },
];

describe("buildAlbumContextFromITunes", () => {
  it("builds a playable sleeve with running order and label from copyright", () => {
    const album = buildAlbumContextFromITunes(rumoursMeta, rumoursSongs);
    expect(album).not.toBeNull();
    expect(album?.albumTitle).toBe("Rumours");
    expect(album?.artist).toBe("Fleetwood Mac");
    expect(album?.releaseYear).toBe(1977);
    expect(album?.label).toBe("Warner Bros. Records");
    expect(album?.personnel).toEqual([]);
    expect(album?.trackList.map((t) => t.title)).toEqual([
      "Second Hand News",
      "Dreams",
      "Never Going Back Again",
    ]);
    expect(album?.trackList[0].position).toBe(1);
    expect(album?.coverArtUrl).toBe("https://example.com/rumours.jpg");
  });

  it("labels multi-disc sides from discNumber", () => {
    const album = buildAlbumContextFromITunes(rumoursMeta, [
      {
        title: "Speak to Me",
        artist: "Pink Floyd",
        trackNumber: 1,
        discNumber: 1,
        discCount: 2,
      },
      {
        title: "Time",
        artist: "Pink Floyd",
        trackNumber: 1,
        discNumber: 2,
        discCount: 2,
      },
    ]);
    expect(album?.trackList[0].side).toBe("Disc 1");
    expect(album?.trackList[1].side).toBe("Disc 2");
  });
});

describe("album deep dive launch queue", () => {
  it("sequences catalog tracks into the sleeve order via buildStationQueue", () => {
    const albumContext = buildAlbumContextFromITunes(rumoursMeta, rumoursSongs);
    expect(albumContext).not.toBeNull();

    const result = buildStationQueue({
      tracks: rumoursTracks,
      mode: "album_deep_dive",
      albumContext,
    });

    expect(result.mode).toBe("album_deep_dive");
    expect(result.tracks.map((t) => t.title)).toEqual([
      "Second Hand News",
      "Dreams",
      "Never Going Back Again",
    ]);
  });

  it("builds a station carrying the album title and deep-dive id", () => {
    const albumContext = buildAlbumContextFromITunes(rumoursMeta, rumoursSongs)!;
    const station = createAlbumDeepDiveStation(
      albumContext,
      rumoursTracks,
      "johnny-static",
      rumoursMeta.collectionId,
    );
    expect(station.name).toBe("Rumours");
    expect(station.id).toContain("album-deep-dive-");
    expect(station.id).toContain(String(rumoursMeta.collectionId));

    const packed = buildAlbumRadioResult(albumContext, rumoursTracks, rumoursMeta.collectionId);
    expect(packed.albumContext.albumTitle).toBe("Rumours");
    expect(packed.collectionId).toBe(rumoursMeta.collectionId);
    expect(packed.tracks).toHaveLength(3);
  });
});
