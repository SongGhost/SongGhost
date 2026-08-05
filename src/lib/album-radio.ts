import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import { matchPersonaForArtist } from "@/lib/artist-radio";
import type { ITunesAlbum, ITunesSong } from "@/lib/itunes";
import {
  MAX_ALBUM_TRACKS,
  normalizeAlbumContext,
  type AlbumContext,
  type AlbumTrackEntry,
} from "@/types/station";

export type AlbumRadioResult = {
  albumContext: AlbumContext;
  tracks: StationTrack[];
  personaId: PersonaId;
  station: Station;
  collectionId: number;
};

function slugifyAlbum(artist: string, albumTitle: string, collectionId: number): string {
  const base = `${artist}-${albumTitle}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "album"}-${collectionId}`;
}

function sideLabel(song: ITunesSong): string | undefined {
  const discs = song.discCount ?? 1;
  const disc = song.discNumber;
  if (discs > 1 && typeof disc === "number" && disc > 0) return `Disc ${disc}`;
  return undefined;
}

/**
 * Sleeve metadata from an iTunes album + its song rows.
 *
 * `recordingStudio` / `personnel` are not in the store-front payload — they stay
 * empty so the host never invents liner credits. Track titles match the resolved
 * station tracks so `buildStationQueue()` can sequence the record in order.
 */
export function buildAlbumContextFromITunes(
  album: ITunesAlbum,
  songs: ITunesSong[],
): AlbumContext | null {
  const trackList: AlbumTrackEntry[] = [];

  for (const song of songs.slice(0, MAX_ALBUM_TRACKS)) {
    const title = song.title.trim();
    if (!title) continue;

    const entry: AlbumTrackEntry = {
      position: trackList.length + 1,
      title,
    };

    const side = sideLabel(song);
    if (side) entry.side = side;

    if (typeof song.durationMs === "number" && song.durationMs > 0) {
      entry.durationSeconds = Math.round(song.durationMs / 1000);
    }

    trackList.push(entry);
  }

  const label = album.copyright
    ?.replace(/^℗\s*/u, "")
    .replace(/^\d{4}\s*/, "")
    .trim();

  return normalizeAlbumContext({
    albumTitle: album.albumTitle,
    artist: album.artist,
    releaseYear: album.releaseYear,
    label: label || undefined,
    coverArtUrl: album.coverArtUrl,
    personnel: [],
    trackList,
  });
}

export function createAlbumDeepDiveStation(
  albumContext: AlbumContext,
  tracks: StationTrack[],
  personaId: PersonaId,
  collectionId: number,
): Station {
  const first = tracks[0];
  const year = albumContext.releaseYear ? ` (${albumContext.releaseYear})` : "";

  return {
    id: `album-deep-dive-${slugifyAlbum(albumContext.artist, albumContext.albumTitle, collectionId)}`,
    name: `${albumContext.albumTitle}`,
    frequency: 99.1,
    category: "genres",
    defaultPersonaId: personaId,
    accentColor: "#C45C26",
    youtubeVideoId: first?.youtubeId ?? "",
    tracks,
    description: `Full album: ${albumContext.albumTitle} by ${albumContext.artist}${year}`,
  };
}

export function buildAlbumRadioResult(
  albumContext: AlbumContext,
  tracks: StationTrack[],
  collectionId: number,
): AlbumRadioResult {
  const personaId = matchPersonaForArtist(albumContext.artist, tracks);
  const station = createAlbumDeepDiveStation(albumContext, tracks, personaId, collectionId);
  return { albumContext, tracks, personaId, station, collectionId };
}
