import type { StationTrack } from "@/data/stations";
import { isValidYouTubeVideoId } from "@/lib/youtube";
import { artistNamesMatch } from "@/lib/track-quality";

/** Raw iTunes Search API result item (song entity) */
type ITunesApiSongResult = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  primaryGenreName?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  wrapperType?: string;
  kind?: string;
};

type ITunesApiArtistResult = {
  artistName?: string;
};

type ITunesSearchResponse<T> = {
  resultCount?: number;
  results?: T[];
};

export type ITunesSong = {
  title: string;
  artist: string;
  album?: string;
  primaryGenreName?: string;
  previewUrl?: string;
  trackId?: number;
  durationMs?: number;
};

export type ITunesSearchOptions = {
  entity?: "musicArtist" | "song";
  limit?: number;
  /** Skip cache for this request */
  bypassCache?: boolean;
};

const ITUNES_SEARCH_BASE = "https://itunes.apple.com/search";
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

type CacheEntry<T> = { value: T; expiresAt: number };

const searchCache = new Map<string, CacheEntry<unknown>>();

function cacheKey(url: string): string {
  return url;
}

function readCache<T>(key: string): T | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function writeCache<T>(key: string, value: T): void {
  if (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSearchResponse<T>(data: unknown): T[] {
  if (!isRecord(data)) return [];
  const results = data.results;
  return Array.isArray(results) ? (results as T[]) : [];
}

async function fetchITunesSearch<T>(
  params: Record<string, string>,
  options?: { bypassCache?: boolean },
): Promise<T[]> {
  const query = new URLSearchParams(params);
  const url = `${ITUNES_SEARCH_BASE}?${query.toString()}`;
  const key = cacheKey(url);

  if (!options?.bypassCache) {
    const cached = readCache<T[]>(key);
    if (cached) return cached;
  }

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      console.warn(`[itunes] Search failed (${res.status}): ${params.term ?? params.entity}`);
      return [];
    }

    const data = (await res.json()) as ITunesSearchResponse<T>;
    const results = parseSearchResponse<T>(data);
    writeCache(key, results);
    return results;
  } catch (error) {
    console.warn("[itunes] Search request error:", error);
    return [];
  }
}

function parseSongResult(item: ITunesApiSongResult): ITunesSong | null {
  const title = item.trackName?.trim();
  const artist = item.artistName?.trim();
  if (!title || !artist) return null;

  const previewUrl = item.previewUrl?.trim() || undefined;

  return {
    title,
    artist,
    album: item.collectionName?.trim(),
    primaryGenreName: item.primaryGenreName?.trim(),
    previewUrl,
    trackId: typeof item.trackId === "number" ? item.trackId : undefined,
    durationMs: typeof item.trackTimeMillis === "number" ? item.trackTimeMillis : undefined,
  };
}

function dedupeSongs(songs: ITunesSong[]): ITunesSong[] {
  const seen = new Set<string>();
  const out: ITunesSong[] = [];

  for (const song of songs) {
    const key = song.trackId
      ? `id:${song.trackId}`
      : `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(song);
  }

  return out;
}

export async function searchITunesArtists(term: string, limit = 8): Promise<string[]> {
  const results = await fetchITunesSearch<ITunesApiArtistResult>({
    term,
    entity: "musicArtist",
    limit: String(Math.min(limit, 50)),
  });

  const seen = new Set<string>();
  const artists: string[] = [];

  for (const item of results) {
    const name = item.artistName?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    artists.push(name);
  }

  return artists;
}

export async function searchITunesSongs(
  term: string,
  limit = 25,
  options?: ITunesSearchOptions,
): Promise<ITunesSong[]> {
  const results = await fetchITunesSearch<ITunesApiSongResult>(
    {
      term,
      entity: "song",
      limit: String(Math.min(limit, 200)),
    },
    { bypassCache: options?.bypassCache },
  );

  const songs = results
    .map(parseSongResult)
    .filter((song): song is ITunesSong => song !== null);

  return dedupeSongs(songs).slice(0, limit);
}

export async function searchITunesGenreSongs(term: string, limit = 50): Promise<ITunesSong[]> {
  return searchITunesSongs(term, limit);
}

export async function findITunesArtist(query: string): Promise<string | null> {
  const artists = await searchITunesArtists(query, 12);
  if (!artists.length) return null;

  const norm = query.toLowerCase().trim();
  return (
    artists.find((a) => a.toLowerCase() === norm) ??
    artists.find((a) => a.toLowerCase().includes(norm) || norm.includes(a.toLowerCase())) ??
    artists[0]
  );
}

export async function searchSongsByArtist(artistName: string, limit = 25): Promise<ITunesSong[]> {
  const songs = await searchITunesSongs(artistName, 50);
  const norm = artistName.toLowerCase().trim();

  return dedupeSongs(
    songs.filter((song) => {
      const artist = song.artist.toLowerCase();
      return artist === norm || artist.includes(norm) || norm.includes(artist);
    }),
  ).slice(0, limit);
}

/** Stricter artist matching for Artist Radio — avoids tribute acts and partial-name false positives. */
export async function searchSongsByArtistStrict(
  artistName: string,
  limit = 25,
): Promise<ITunesSong[]> {
  const songs = await searchITunesSongs(artistName, 80);

  return dedupeSongs(songs.filter((song) => artistNamesMatch(song.artist, artistName))).slice(
    0,
    limit,
  );
}

/**
 * Lookup a single track by artist + title for metadata and 30s preview URL.
 */
export async function lookupITunesTrack(
  artist: string,
  title: string,
): Promise<ITunesSong | null> {
  const term = `${artist} ${title}`.trim();
  const songs = await searchITunesSongs(term, 12);
  const normArtist = artist.toLowerCase().trim();
  const normTitle = title.toLowerCase().trim();

  return (
    songs.find(
      (s) =>
        s.artist.toLowerCase().includes(normArtist) &&
        s.title.toLowerCase().includes(normTitle),
    ) ??
    songs.find(
      (s) =>
        normTitle.includes(s.title.toLowerCase()) ||
        s.title.toLowerCase().includes(normTitle),
    ) ??
    songs[0] ??
    null
  );
}

/** Songs with playable 30-second preview clips */
export async function searchITunesPreviewTracks(
  term: string,
  limit = 25,
): Promise<ITunesSong[]> {
  const songs = await searchITunesSongs(term, Math.min(limit * 2, 100));
  return songs.filter((s) => Boolean(s.previewUrl)).slice(0, limit);
}

export function itunesSongToStationTrack(
  song: ITunesSong,
  youtubeId?: string,
): StationTrack | null {
  const id = youtubeId?.trim();
  const preview = song.previewUrl?.trim();
  const validYoutubeId = id && isValidYouTubeVideoId(id) ? id : undefined;

  if (!validYoutubeId && !preview) return null;

  return {
    youtubeId: validYoutubeId ?? "",
    title: song.title,
    artist: song.artist,
    previewUrl: preview,
    itunesTrackId: song.trackId,
    album: song.album,
  };
}

/**
 * Build a preview-only station track when no YouTube embed is available.
 */
export function itunesPreviewToStationTrack(song: ITunesSong): StationTrack | null {
  if (!song.previewUrl?.trim()) return null;
  return itunesSongToStationTrack(song);
}

export function itunesSongsToStationTracks(
  songs: ITunesSong[],
  youtubeIds: Map<string, string>,
): StationTrack[] {
  const tracks: StationTrack[] = [];
  const seen = new Set<string>();

  for (const song of songs) {
    const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
    const youtubeId = youtubeIds.get(key);
    const track = itunesSongToStationTrack(song, youtubeId);
    if (!track) continue;

    const dedupeKey = track.youtubeId || `preview:${track.itunesTrackId ?? key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    tracks.push(track);
  }

  return tracks;
}

/** Clear in-memory search cache (testing / admin) */
export function clearITunesCache(): void {
  searchCache.clear();
}
