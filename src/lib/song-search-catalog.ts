/**
 * Songs-filter catalog pages.
 * First page is one iTunes search window (same size as the old list).
 * Later pages walk iTunes search, then iTunes lookup, then MusicBrainz
 * browse when a source hits its cap. Neighbor songs start only after that.
 */

import { artistNamesMatch, isAcceptableArtistRadioTrack } from "@/lib/track-quality";
import { normalizeItunesArtist, normalizeItunesTitle } from "@/lib/itunes";

/** Listener page size. The old Songs list stopped here. */
export const SONG_PAGE_SIZE = 25;

/** iTunes Search API maximum `limit` on one response. */
export const ITUNES_SEARCH_LIMIT_MAX = 200;

/** iTunes lookup by artist id returns at most this many songs and has no offset. */
export const ITUNES_LOOKUP_CAP = 200;

/** MusicBrainz recording browse maximum `limit`. */
export const MUSICBRAINZ_BROWSE_MAX = 100;

/** Stop iTunes search paging if Apple keeps returning full windows forever. */
export const ITUNES_SEARCH_OFFSET_CAP = 1000;

const MAX_WINDOWS_PER_PAGE = 6;

export type SongCatalogPhase =
  | "itunes-search"
  | "itunes-lookup"
  | "musicbrainz"
  | "similar"
  | "done";

export type SongCatalogCursor = {
  phase: SongCatalogPhase;
  offset: number;
  artistName: string;
  artistId?: number;
  mbid?: string;
  lookupCapped: boolean;
  neighborsReady: boolean;
  neighbors: string[];
  neighborIndex: number;
  neighborOffset: number;
  /** Offset into each neighbor's catalog. -1 means that neighbor is finished. */
  neighborOffsets?: number[];
};

export type RawCatalogSong = {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
  previewUrl?: string;
  trackId?: number;
  recordingId?: string;
  disambiguation?: string;
};

export type SongCatalogTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSec?: number;
  previewUrl?: string;
  section: "artist" | "similar";
};

export type SongCatalogDeps = {
  findArtist: (query: string) => Promise<{ name: string; artistId?: number } | null>;
  searchSongs: (
    term: string,
    limit: number,
    offset: number,
  ) => Promise<{ songs: RawCatalogSong[]; rawCount: number }>;
  lookupSongs: (artistId: number) => Promise<RawCatalogSong[]>;
  resolveMbid: (artistName: string) => Promise<string | null>;
  browseRecordings: (
    mbid: string,
    limit: number,
    offset: number,
  ) => Promise<{ songs: RawCatalogSong[]; rawCount: number; total: number } | null>;
  neighbors: (artistName: string) => Promise<string[]>;
};

export function recordingDedupeKey(song: { title: string; artist: string }): string {
  const artist = normalizeItunesArtist(song.artist);
  const title = normalizeItunesTitle(song.title);
  if (!artist || !title) return "";
  return `${artist}::${title}`;
}

function emptyCursor(artistName: string, artistId?: number): SongCatalogCursor {
  return {
    phase: "itunes-search",
    offset: 0,
    artistName,
    ...(artistId ? { artistId } : {}),
    lookupCapped: false,
    neighborsReady: false,
    neighbors: [],
    neighborIndex: 0,
    neighborOffset: 0,
  };
}

function toTrack(
  song: RawCatalogSong,
  section: "artist" | "similar",
  index: number,
): SongCatalogTrack {
  const id = song.trackId
    ? `itunes:${song.trackId}`
    : song.recordingId
      ? `mb:${song.recordingId}`
      : `song:${recordingDedupeKey(song)}:${index}`;
  const track: SongCatalogTrack = {
    id,
    title: song.title.trim(),
    artist: song.artist.trim(),
    section,
  };
  const album = song.album?.trim();
  if (album) track.album = album;
  const artworkUrl = song.artworkUrl?.trim();
  if (artworkUrl) track.artworkUrl = artworkUrl;
  if (typeof song.durationMs === "number" && song.durationMs > 0) {
    track.durationSec = Math.round(song.durationMs / 1000);
  }
  const previewUrl = song.previewUrl?.trim();
  if (previewUrl) track.previewUrl = previewUrl;
  return track;
}

function songAllowed(song: RawCatalogSong, artistName: string): boolean {
  if (!song.title.trim() || !song.artist.trim()) return false;
  if (!artistNamesMatch(song.artist, artistName)) return false;
  const extra = song.disambiguation?.trim();
  const label = extra ? `${song.title} ${extra}` : song.title;
  return isAcceptableArtistRadioTrack(label, { durationMs: song.durationMs });
}

function takeFresh(
  songs: readonly RawCatalogSong[],
  artistName: string,
  seen: Set<string>,
  section: "artist" | "similar",
  room: number,
): SongCatalogTrack[] {
  const out: SongCatalogTrack[] = [];
  for (const song of songs) {
    if (out.length >= room) break;
    if (!songAllowed(song, artistName)) continue;
    const key = recordingDedupeKey(song);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(toTrack(song, section, seen.size));
  }
  return out;
}

function advanceAfterSearch(cursor: SongCatalogCursor): SongCatalogCursor {
  if (cursor.artistId) {
    return { ...cursor, phase: "itunes-lookup", offset: 0 };
  }
  return { ...cursor, phase: "musicbrainz", offset: 0, mbid: undefined };
}

function advanceAfterLookup(cursor: SongCatalogCursor): SongCatalogCursor {
  if (cursor.lookupCapped) {
    return { ...cursor, phase: "musicbrainz", offset: 0, mbid: undefined };
  }
  return { ...cursor, phase: "similar", offset: 0 };
}

type WindowPull = {
  cursor: SongCatalogCursor;
  tracks: SongCatalogTrack[];
  advanced: boolean;
};

async function pullWindow(
  cursor: SongCatalogCursor,
  seen: Set<string>,
  deps: SongCatalogDeps,
  pageSize: number,
): Promise<WindowPull> {
  if (cursor.phase === "done") {
    return { cursor, tracks: [], advanced: false };
  }

  if (cursor.phase === "itunes-search") {
    if (cursor.offset >= ITUNES_SEARCH_OFFSET_CAP) {
      return { cursor: advanceAfterSearch(cursor), tracks: [], advanced: true };
    }
    const page = await deps.searchSongs(cursor.artistName, pageSize, cursor.offset);
    const nextOffset = cursor.offset + (page.rawCount > 0 ? page.rawCount : pageSize);
    const short = page.rawCount < pageSize;
    const tracks = takeFresh(page.songs, cursor.artistName, seen, "artist", pageSize);
    // A later search page with no new songs is the search cap, not the catalog.
    const stalled = tracks.length === 0 && cursor.offset > 0;
    const next = short || stalled || nextOffset >= ITUNES_SEARCH_OFFSET_CAP
      ? advanceAfterSearch({ ...cursor, offset: nextOffset })
      : { ...cursor, offset: nextOffset };
    return { cursor: next, tracks, advanced: true };
  }

  if (cursor.phase === "itunes-lookup") {
    if (!cursor.artistId) {
      return { cursor: advanceAfterLookup(cursor), tracks: [], advanced: true };
    }
    const all = await deps.lookupSongs(cursor.artistId);
    const lookupCapped = all.length >= ITUNES_LOOKUP_CAP;
    const stable = all.filter((song) => songAllowed(song, cursor.artistName));
    const slice = stable.slice(cursor.offset, cursor.offset + pageSize);
    const tracks = takeFresh(slice, cursor.artistName, seen, "artist", pageSize);
    const nextOffset = cursor.offset + slice.length;
    const withCap = { ...cursor, lookupCapped, offset: nextOffset };
    const next = nextOffset >= stable.length ? advanceAfterLookup(withCap) : withCap;
    return { cursor: next, tracks, advanced: nextOffset !== cursor.offset || next.phase !== cursor.phase };
  }

  if (cursor.phase === "musicbrainz") {
    let mbid = cursor.mbid?.trim() ?? "";
    if (!mbid) {
      mbid = (await deps.resolveMbid(cursor.artistName))?.trim() ?? "";
      if (!mbid) {
        return {
          cursor: { ...cursor, phase: "similar", offset: 0, mbid: undefined },
          tracks: [],
          advanced: true,
        };
      }
    }
    const page = await deps.browseRecordings(mbid, Math.min(pageSize, MUSICBRAINZ_BROWSE_MAX), cursor.offset);
    if (!page || page.rawCount === 0) {
      return {
        cursor: { ...cursor, phase: "similar", offset: 0, mbid },
        tracks: [],
        advanced: true,
      };
    }
    const nextOffset = cursor.offset + page.rawCount;
    const tracks = takeFresh(page.songs, cursor.artistName, seen, "artist", pageSize);
    const finished = nextOffset >= page.total;
    const next: SongCatalogCursor = finished
      ? { ...cursor, phase: "similar", offset: 0, mbid }
      : { ...cursor, offset: nextOffset, mbid };
    return { cursor: next, tracks, advanced: true };
  }

  return pullSimilar(cursor, seen, deps, pageSize);
}

/** At most two songs in a row from one neighbor, then the next neighbor. */
const SIMILAR_STREAK = 2;

async function pullSimilar(
  cursor: SongCatalogCursor,
  seen: Set<string>,
  deps: SongCatalogDeps,
  pageSize: number,
): Promise<WindowPull> {
  let neighbors = cursor.neighbors;
  let ready = cursor.neighborsReady;
  if (!ready) {
    neighbors = await deps.neighbors(cursor.artistName);
    ready = true;
  }
  if (neighbors.length === 0) {
    return {
      cursor: { ...cursor, phase: "done", neighbors, neighborsReady: true, neighborOffsets: [] },
      tracks: [],
      advanced: true,
    };
  }

  const offsets = neighbors.map((_, index) => {
    const saved = cursor.neighborOffsets?.[index];
    if (typeof saved === "number") return saved;
    return index === cursor.neighborIndex ? cursor.neighborOffset : 0;
  });
  const done = offsets.map((offset) => offset < 0);
  const tracks: SongCatalogTrack[] = [];
  let index = ((cursor.neighborIndex % neighbors.length) + neighbors.length) % neighbors.length;
  let spins = 0;
  const maxSpins = neighbors.length * 8;

  while (tracks.length < pageSize && spins < maxSpins && done.some((finished) => !finished)) {
    if (done[index]) {
      index = (index + 1) % neighbors.length;
      spins += 1;
      continue;
    }
    const name = neighbors[index] ?? "";
    const offset = Math.max(0, offsets[index] ?? 0);
    const page = await deps.searchSongs(name, SIMILAR_STREAK, offset);
    const fresh = takeFresh(page.songs, name, seen, "similar", SIMILAR_STREAK);
    const short = page.rawCount < SIMILAR_STREAK;
    if (page.rawCount === 0 || short) {
      done[index] = true;
      offsets[index] = -1;
    } else {
      offsets[index] = offset + page.rawCount;
    }
    tracks.push(...fresh);
    index = (index + 1) % neighbors.length;
    spins += 1;
  }

  const finished = done.every(Boolean);
  return {
    cursor: {
      ...cursor,
      neighbors,
      neighborsReady: true,
      neighborIndex: index,
      neighborOffset: 0,
      neighborOffsets: offsets,
      phase: finished ? "done" : "similar",
    },
    tracks,
    advanced: true,
  };
}

export async function loadSongCatalogPage(input: {
  query: string;
  cursor: SongCatalogCursor | null;
  seen: readonly string[];
  deps: SongCatalogDeps;
  pageSize?: number;
}): Promise<{
  artistName: string | null;
  tracks: SongCatalogTrack[];
  cursor: SongCatalogCursor | null;
  exhausted: boolean;
  /** True once the artist catalog has ended, including a page that only just ended it. */
  similarOpen: boolean;
}> {
  const pageSize = input.pageSize ?? SONG_PAGE_SIZE;
  const query = input.query.trim();
  if (query.length < 2) {
    return { artistName: null, tracks: [], cursor: null, exhausted: true, similarOpen: false };
  }

  let cursor = input.cursor;
  if (!cursor) {
    const artist = await input.deps.findArtist(query);
    if (!artist?.name?.trim()) {
      return { artistName: null, tracks: [], cursor: null, exhausted: true, similarOpen: false };
    }
    cursor = emptyCursor(artist.name.trim(), artist.artistId);
  }
  if (cursor.phase === "done") {
    return {
      artistName: cursor.artistName,
      tracks: [],
      cursor,
      exhausted: true,
      similarOpen: true,
    };
  }

  const seen = new Set(input.seen.filter(Boolean));
  const tracks: SongCatalogTrack[] = [];
  let windows = 0;
  let guard = `${cursor.phase}:${cursor.offset}:${cursor.neighborIndex}:${(cursor.neighborOffsets ?? []).join(",")}`;

  while (cursor.phase !== "done" && tracks.length < pageSize && windows < MAX_WINDOWS_PER_PAGE) {
    windows += 1;
    const pulled = await pullWindow(cursor, seen, input.deps, pageSize);
    cursor = pulled.cursor;
    tracks.push(...pulled.tracks);
    const nextGuard = `${cursor.phase}:${cursor.offset}:${cursor.neighborIndex}:${(cursor.neighborOffsets ?? []).join(",")}:${cursor.neighborsReady}`;
    if (!pulled.advanced || (nextGuard === guard && pulled.tracks.length === 0)) {
      cursor = { ...cursor, phase: "done" };
      break;
    }
    guard = nextGuard;
    if (tracks.length > 0) break;
  }

  const exhausted = cursor.phase === "done";
  return {
    artistName: cursor.artistName,
    tracks,
    cursor,
    exhausted,
    similarOpen: cursor.phase === "similar" || cursor.phase === "done",
  };
}
