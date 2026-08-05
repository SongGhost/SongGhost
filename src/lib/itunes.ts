import type { StationTrack } from "@/data/stations";
import { parseReleaseYear } from "@/lib/queue/builder";
import { isValidYouTubeVideoId } from "@/lib/youtube";
import {
  artistNamesMatch,
  isAcceptableArtistRadioTrack,
  isAcceptableCatalogTrack,
} from "@/lib/track-quality";
import { splitTiers, type Ranked } from "@/lib/track-shuffle";

/** Raw iTunes Search API result item (song entity) */
type ITunesApiSongResult = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionId?: number;
  primaryGenreName?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  wrapperType?: string;
  kind?: string;
  trackNumber?: number;
  discNumber?: number;
  discCount?: number;
};

type ITunesApiArtistResult = {
  artistName?: string;
  artistId?: number;
};

/** Raw iTunes Search API result item (album / collection entity) */
type ITunesApiAlbumResult = {
  wrapperType?: string;
  collectionType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl60?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  trackCount?: number;
  copyright?: string;
  primaryGenreName?: string;
};

export type ITunesArtist = {
  name: string;
  artistId?: number;
};

type ITunesSearchResponse<T> = {
  resultCount?: number;
  results?: T[];
};

export type ITunesSong = {
  title: string;
  artist: string;
  album?: string;
  collectionId?: number;
  primaryGenreName?: string;
  previewUrl?: string;
  trackId?: number;
  durationMs?: number;
  /** Four-digit release year parsed from the ISO `releaseDate` — drives era locking */
  releaseYear?: number;
  trackNumber?: number;
  discNumber?: number;
  discCount?: number;
};

/** Album / collection hit from iTunes `entity=album` search or lookup */
export type ITunesAlbum = {
  collectionId: number;
  albumTitle: string;
  artist: string;
  releaseYear?: number;
  trackCount?: number;
  coverArtUrl?: string;
  copyright?: string;
  primaryGenreName?: string;
};

export type ITunesSearchOptions = {
  entity?: "musicArtist" | "song" | "album";
  limit?: number;
  /** Skip cache for this request */
  bypassCache?: boolean;
};

const ITUNES_SEARCH_BASE = "https://itunes.apple.com/search";
const ITUNES_LOOKUP_BASE = "https://itunes.apple.com/lookup";
/** iTunes caps a single response at 200 items. */
const ITUNES_MAX_LIMIT = 200;
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

async function fetchITunesEndpoint<T>(
  base: string,
  params: Record<string, string>,
  options?: { bypassCache?: boolean },
): Promise<T[]> {
  const query = new URLSearchParams(params);
  const url = `${base}?${query.toString()}`;
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

async function fetchITunesSearch<T>(
  params: Record<string, string>,
  options?: { bypassCache?: boolean },
): Promise<T[]> {
  return fetchITunesEndpoint<T>(ITUNES_SEARCH_BASE, params, options);
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
    collectionId: typeof item.collectionId === "number" ? item.collectionId : undefined,
    primaryGenreName: item.primaryGenreName?.trim(),
    previewUrl,
    trackId: typeof item.trackId === "number" ? item.trackId : undefined,
    durationMs: typeof item.trackTimeMillis === "number" ? item.trackTimeMillis : undefined,
    releaseYear: parseReleaseYear(item.releaseDate),
    trackNumber: typeof item.trackNumber === "number" ? item.trackNumber : undefined,
    discNumber: typeof item.discNumber === "number" ? item.discNumber : undefined,
    discCount: typeof item.discCount === "number" ? item.discCount : undefined,
  };
}

/** Bump the 100×100 thumbnail to a liner-notes-friendly resolution. */
export function upgradeITunesArtworkUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/\d+x\d+bb(?:-\d+)?(\.[a-z]+)?$/i, "/600x600bb$1");
}

function parseAlbumResult(item: ITunesApiAlbumResult): ITunesAlbum | null {
  const collectionId = item.collectionId;
  const albumTitle = item.collectionName?.trim();
  const artist = item.artistName?.trim();
  if (typeof collectionId !== "number" || !albumTitle || !artist) return null;

  // Singles are not a deep-dive record; albums, EPs, and compilations are.
  const collectionType = item.collectionType?.trim().toLowerCase() ?? "";
  if (collectionType === "single") return null;
  if (typeof item.trackCount === "number" && item.trackCount > 0 && item.trackCount < 2) {
    return null;
  }

  const coverArtUrl =
    upgradeITunesArtworkUrl(item.artworkUrl100) ?? upgradeITunesArtworkUrl(item.artworkUrl60);

  return {
    collectionId,
    albumTitle,
    artist,
    releaseYear: parseReleaseYear(item.releaseDate),
    trackCount: typeof item.trackCount === "number" ? item.trackCount : undefined,
    coverArtUrl,
    copyright: item.copyright?.trim() || undefined,
    primaryGenreName: item.primaryGenreName?.trim() || undefined,
  };
}

function dedupeAlbums(albums: ITunesAlbum[]): ITunesAlbum[] {
  const seen = new Set<number>();
  const out: ITunesAlbum[] = [];
  for (const album of albums) {
    if (seen.has(album.collectionId)) continue;
    seen.add(album.collectionId);
    out.push(album);
  }
  return out;
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

export async function searchITunesArtistsDetailed(
  term: string,
  limit = 8,
): Promise<ITunesArtist[]> {
  const results = await fetchITunesSearch<ITunesApiArtistResult>({
    term,
    entity: "musicArtist",
    limit: String(Math.min(limit, 50)),
  });

  const seen = new Set<string>();
  const artists: ITunesArtist[] = [];

  for (const item of results) {
    const name = item.artistName?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    artists.push({
      name,
      artistId: typeof item.artistId === "number" ? item.artistId : undefined,
    });
  }

  return artists;
}

export async function searchITunesArtists(term: string, limit = 8): Promise<string[]> {
  return (await searchITunesArtistsDetailed(term, limit)).map((artist) => artist.name);
}

/**
 * Discography autocomplete — `entity=album` hits with cover art and release year
 * for the FULL ALBUM search drop-down.
 */
export async function searchITunesAlbums(term: string, limit = 8): Promise<ITunesAlbum[]> {
  const results = await fetchITunesSearch<ITunesApiAlbumResult>({
    term,
    entity: "album",
    media: "music",
    limit: String(Math.min(Math.max(limit * 2, limit), 50)),
  });

  const albums = results
    .map(parseAlbumResult)
    .filter((album): album is ITunesAlbum => album !== null);

  return dedupeAlbums(albums).slice(0, limit);
}

/**
 * Pull the collection row plus every song on the record (running order).
 *
 * iTunes returns the album wrapper as the first row, then track rows. Songs are
 * sorted by disc/track number so a multi-disc set keeps its printed sequence.
 */
export async function lookupITunesAlbum(
  collectionId: number,
): Promise<{ album: ITunesAlbum; songs: ITunesSong[] } | null> {
  if (!Number.isFinite(collectionId) || collectionId <= 0) return null;

  const results = await fetchITunesEndpoint<ITunesApiAlbumResult & ITunesApiSongResult>(
    ITUNES_LOOKUP_BASE,
    {
      id: String(collectionId),
      entity: "song",
      limit: String(ITUNES_MAX_LIMIT),
    },
  );

  if (!results.length) return null;

  const albumRow =
    results.find((item) => item.wrapperType === "collection" || Boolean(item.collectionType)) ??
    null;
  const album =
    (albumRow ? parseAlbumResult(albumRow) : null) ??
    (() => {
      // Fallback when the wrapper row is missing — still build from the first track.
      const firstTrack = results.find(
        (item) => item.wrapperType === "track" || item.kind === "song",
      );
      if (!firstTrack?.collectionName?.trim() || !firstTrack.artistName?.trim()) return null;
      return parseAlbumResult({
        wrapperType: "collection",
        collectionType: "Album",
        collectionId,
        collectionName: firstTrack.collectionName,
        artistName: firstTrack.artistName,
        releaseDate: firstTrack.releaseDate,
        artworkUrl100: undefined,
      });
    })();

  if (!album) return null;

  const songs = results
    .filter((item) => item.wrapperType === "track" || item.kind === "song")
    .map(parseSongResult)
    .filter((song): song is ITunesSong => song !== null)
    .sort((a, b) => {
      const discA = a.discNumber ?? 1;
      const discB = b.discNumber ?? 1;
      if (discA !== discB) return discA - discB;
      return (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
    });

  return { album, songs: dedupeSongs(songs) };
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
  const songs = await searchITunesSongs(term, Math.min(limit * 2, ITUNES_MAX_LIMIT));
  return songs
    .filter((song) => isAcceptableCatalogTrack({ title: song.title, durationMs: song.durationMs }))
    .slice(0, limit);
}

export async function findITunesArtistDetailed(query: string): Promise<ITunesArtist | null> {
  const artists = await searchITunesArtistsDetailed(query, 12);
  if (!artists.length) return null;

  const norm = query.toLowerCase().trim();
  return (
    artists.find((a) => a.name.toLowerCase() === norm) ??
    artists.find(
      (a) => a.name.toLowerCase().includes(norm) || norm.includes(a.name.toLowerCase()),
    ) ??
    artists[0]
  );
}

export async function findITunesArtist(query: string): Promise<string | null> {
  return (await findITunesArtistDetailed(query))?.name ?? null;
}

/**
 * Full catalog for an artist. Unlike `search`, this returns everything the artist
 * released — but ordered by collection/release, so it carries no popularity signal.
 */
export async function lookupArtistSongs(
  artistId: number,
  limit = ITUNES_MAX_LIMIT,
): Promise<ITunesSong[]> {
  const results = await fetchITunesEndpoint<ITunesApiSongResult>(ITUNES_LOOKUP_BASE, {
    id: String(artistId),
    entity: "song",
    limit: String(Math.min(limit, ITUNES_MAX_LIMIT)),
  });

  const songs = results
    // The first row of a lookup response is the artist wrapper, not a track.
    .filter((item) => item.wrapperType === "track" || item.kind === "song")
    .map(parseSongResult)
    .filter((song): song is ITunesSong => song !== null);

  return dedupeSongs(songs);
}

export async function searchSongsByArtist(artistName: string, limit = 25): Promise<ITunesSong[]> {
  const songs = await searchITunesSongs(artistName, 50);
  const norm = artistName.toLowerCase().trim();

  return dedupeSongs(
    songs.filter((song) => {
      if (!isAcceptableCatalogTrack({ title: song.title, durationMs: song.durationMs })) {
        return false;
      }
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

  return dedupeSongs(
    songs.filter(
      (song) =>
        artistNamesMatch(song.artist, artistName) &&
        isAcceptableCatalogTrack({ title: song.title, durationMs: song.durationMs }),
    ),
  ).slice(0, limit);
}

function songKey(song: ITunesSong): string {
  return song.trackId
    ? `id:${song.trackId}`
    : `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
}

/**
 * Deep catalog pool for Artist Radio.
 *
 * Combines two iTunes endpoints because neither alone is sufficient: `search`
 * returns popularity-ranked results (the signal we tier on) but shallow coverage,
 * while `lookup` returns the full catalog but in release order with no ranking.
 * Search hits keep their index as `rank`; lookup-only deep cuts get `Infinity`.
 */
export async function buildDeepArtistPool(
  artistName: string,
  options?: { artistId?: number; target?: number },
): Promise<Ranked<ITunesSong>[]> {
  const target = options?.target ?? 100;

  const searchSongs = (await searchITunesSongs(artistName, ITUNES_MAX_LIMIT)).filter(
    (song) =>
      artistNamesMatch(song.artist, artistName) &&
      isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs }),
  );

  const ranked: Ranked<ITunesSong>[] = [];
  const seen = new Set<string>();

  for (const song of searchSongs) {
    const key = songKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({ item: song, rank: ranked.length, tier: 1, isPrimaryArtist: true });
  }

  if (options?.artistId && ranked.length < target) {
    const catalog = await lookupArtistSongs(options.artistId, ITUNES_MAX_LIMIT);

    for (const song of catalog) {
      if (ranked.length >= target) break;
      const key = songKey(song);
      if (seen.has(key)) continue;
      if (!artistNamesMatch(song.artist, artistName)) continue;
      if (!isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs })) continue;
      seen.add(key);
      ranked.push({ item: song, rank: Infinity, tier: 2, isPrimaryArtist: true });
    }
  }

  return splitTiers(ranked).slice(0, target);
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
    releaseYear: song.releaseYear,
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
