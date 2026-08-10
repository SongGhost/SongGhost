import { NextResponse } from "next/server";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import {
  filterExplicitTracks,
  parseAllowExplicit,
} from "@/lib/content-filter";
import { trackMatchesGenre } from "@/lib/genre-match";
import { getStationGenreProfile } from "@/lib/station-genre-profiles";
import { searchITunesGenreSongs, searchSongsByArtist, itunesPreviewToStationTrack, type ITunesSong } from "@/lib/itunes";
import { resolveTrackVideoId, searchYouTubeVideos } from "@/lib/youtube-search";
import { resolveInPool } from "@/lib/resolve-pool";
import {
  buildEraFilteredQueue,
  filterTracksByEra,
  isValidRadioTrack,
  isYearWithinEra,
} from "@/lib/queue/builder";
import { isAcceptableCatalogTrack } from "@/lib/track-quality";
import { buildOrderedStationQueue, toRanked } from "@/lib/track-shuffle";
import { isEraLocked, resolveEraLock, type EraLock } from "@/types/station";

/** Responses are randomized per request and must never be statically cached. */
export const dynamic = "force-dynamic";

const CATALOG_CACHE_MS = 15 * 60 * 1000;
const catalogCache = new Map<string, { tracks: StationTrack[]; cachedAt: number }>();

/**
 * Floor for genre/decade catalog builds so a station launch can seed Spotify
 * with a full Connect queue (~25–30 URIs), not just the authored seed opener.
 */
const MIN_STATION_CATALOG = 30;

/**
 * Weighted ordering with the no-back-to-back-same-artist rule. Genre catalogs carry
 * no popularity signal, so position stands in as the rank proxy.
 */
function orderCatalog(tracks: StationTrack[]): StationTrack[] {
  return buildOrderedStationQueue(toRanked(tracks));
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildSearchQueries(station: Station): string[] {
  const profile = getStationGenreProfile(station);
  const variants = [
    ...profile.catalogSearchTerms.map((term) => `${term} official music video`),
    ...profile.catalogSearchTerms.map((term) => `${term} greatest hits`),
    ...profile.anchorArtists.map((artist) => `${artist} official music video`),
    ...profile.anchorArtists.map((artist) => `${artist} greatest hits`),
    `${station.name} hits official`,
    `${station.name} playlist`,
  ];
  return [...new Set(variants)];
}

async function resolveTracksInParallel(
  songs: ITunesSong[],
  station: Station,
  seen: Set<string>,
  limit: number,
  eraLock: EraLock,
): Promise<StationTrack[]> {
  return resolveInPool(
    songs,
    async (song) => {
      if (!isAcceptableCatalogTrack({ title: song.title, durationMs: song.durationMs })) {
        return null;
      }

      // Compilation/tribute/karaoke junk is rejected up front, alongside the
      // other cheap checks, before the YouTube resolve spends a network call.
      if (!isValidRadioTrack(song.title, song.artist)) return null;

      // Checked before the YouTube resolve so an off-era candidate never costs a
      // lookup, which is the expensive half of building a catalog.
      if (!isYearWithinEra(song.releaseYear, eraLock)) return null;

      if (
        !trackMatchesGenre(
          { youtubeId: "", title: song.title, artist: song.artist },
          station,
          song.primaryGenreName,
        )
      ) {
        return null;
      }

      const youtubeId = await resolveTrackVideoId(
        song.artist,
        song.title,
        undefined,
        song.durationMs != null ? song.durationMs / 1000 : undefined,
      );
      if (youtubeId && !seen.has(youtubeId)) {
        seen.add(youtubeId);
        return {
          youtubeId,
          title: song.title,
          artist: song.artist,
          releaseYear: song.releaseYear,
          ...(song.explicit === true ? { explicit: true } : {}),
        };
      }

      const previewTrack = itunesPreviewToStationTrack(song);
      if (!previewTrack) return null;

      const previewKey = previewTrack.itunesTrackId
        ? `preview:${previewTrack.itunesTrackId}`
        : `preview:${song.artist}::${song.title}`;
      if (seen.has(previewKey)) return null;
      seen.add(previewKey);
      return previewTrack;
    },
    { limit },
  );
}

async function fetchCatalogFromITunes(
  station: Station,
  seen: Set<string>,
  limit: number,
  eraLock: EraLock,
): Promise<StationTrack[]> {
  const profile = getStationGenreProfile(station);
  const songCandidates: ITunesSong[] = [];
  const songKeys = new Set<string>();

  // An era lock throws away most of what iTunes returns, so the candidate pool
  // has to be dug deeper before the filter to land anywhere near the target.
  const candidateTarget = isEraLocked(eraLock) ? limit * 6 : limit * 2;

  for (const term of shuffle(profile.catalogSearchTerms)) {
    if (songCandidates.length >= candidateTarget) break;
    const songs = await searchITunesGenreSongs(term, Math.min(limit, 200));
    for (const song of songs) {
      const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
      if (songKeys.has(key)) continue;
      songKeys.add(key);
      songCandidates.push(song);
    }
  }

  for (const artist of shuffle(profile.anchorArtists)) {
    if (songCandidates.length >= candidateTarget) break;
    const songs = await searchSongsByArtist(artist, isEraLocked(eraLock) ? 50 : 20);
    for (const song of songs) {
      const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
      if (songKeys.has(key)) continue;
      songKeys.add(key);
      songCandidates.push(song);
    }
  }

  return resolveTracksInParallel(shuffle(songCandidates), station, seen, limit, eraLock);
}

async function fetchGenreTracks(
  station: Station,
  excludeSet: Set<string>,
  eraLock: EraLock,
): Promise<StationTrack[]> {
  const profile = getStationGenreProfile(station);
  // Never shrink below MIN_STATION_CATALOG — Spotify launch resolves up to 30 URIs.
  const targetLimit = Math.max(MIN_STATION_CATALOG, Math.min(profile.catalogDepth, 200));
  const seen = new Set<string>(excludeSet);
  const tracks: StationTrack[] = [];

  /**
   * YouTube search results carry no release date, so under an era lock there is
   * nothing to validate them against and strict filtering would drop the entire
   * batch anyway. iTunes is the only source that dates its catalog, so a locked
   * station is sourced from it exclusively.
   */
  if (isEraLocked(eraLock)) {
    const dated = await fetchCatalogFromITunes(station, seen, targetLimit, eraLock);
    return buildEraFilteredQueue(dated, eraLock, { limit: targetLimit }).tracks;
  }

  const queries = shuffle(buildSearchQueries(station)).slice(0, 20);
  const searchResults = await Promise.all(queries.map((query) => searchYouTubeVideos(query, 30)));

  for (const batch of searchResults) {
    for (const track of shuffle(batch)) {
      if (tracks.length >= targetLimit) break;
      if (seen.has(track.youtubeId)) continue;
      if (
        !isAcceptableCatalogTrack({
          title: track.title,
          durationSeconds: track.durationSeconds,
        })
      ) {
        continue;
      }
      if (!isValidRadioTrack(track.title, track.artist)) continue;
      if (!trackMatchesGenre(track, station)) continue;
      seen.add(track.youtubeId);
      tracks.push({
        youtubeId: track.youtubeId,
        title: track.title,
        artist: track.artist,
      });
    }
  }

  if (tracks.length < Math.min(60, targetLimit)) {
    const itunesTracks = await fetchCatalogFromITunes(
      station,
      seen,
      targetLimit - tracks.length,
      eraLock,
    );
    tracks.push(...itunesTracks);
  }

  return orderCatalog(tracks).slice(0, targetLimit);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get("stationId")?.trim();
  const exclude = searchParams.get("exclude")?.split(",").filter(Boolean) ?? [];
  const eraLock = resolveEraLock(searchParams.get("era"));
  const allowExplicit = parseAllowExplicit(searchParams.get("allowExplicit"));

  if (!stationId) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }

  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Station not found" }, { status: 404 });
  }

  const excludeSet = new Set(exclude);
  const useCache = excludeSet.size === 0;
  // Each era / Clean Mode combo yields a different catalog — never share entries.
  const cacheKey = `${stationId}::${eraLock}::explicit:${allowExplicit ? "1" : "0"}`;
  const cached = catalogCache.get(cacheKey);

  if (useCache && cached && Date.now() - cached.cachedAt < CATALOG_CACHE_MS) {
    return NextResponse.json({
      tracks: orderCatalog(cached.tracks),
      eraLock,
      allowExplicit,
    });
  }

  let tracks = await fetchGenreTracks(station, excludeSet, eraLock);

  if (tracks.length === 0) {
    // Seed pools are the last resort, and they are only dated where a previous
    // enrichment pass wrote a year — so under a lock most stations fall through
    // to an empty response rather than leaking undated tracks onto the dial.
    const seeds = filterTracksByEra(station.tracks, eraLock);
    const unplayed = seeds.filter((t) => !excludeSet.has(t.youtubeId));
    tracks = shuffle(unplayed.length ? unplayed : seeds);
  }

  tracks = tracks.filter(
    (t) => (t.youtubeId || t.previewUrl) && (!t.youtubeId || !excludeSet.has(t.youtubeId)),
  );

  // Belt and braces: nothing reaches the dial without clearing the lock, however
  // it got into the list above.
  tracks = filterTracksByEra(tracks, eraLock);

  // Same belt and braces for junk: a sampler or countdown video must never
  // reach the dial, whichever path — search, seed fallback, or cache — served it.
  tracks = tracks.filter((t) => isValidRadioTrack(t.title, t.artist));

  // Clean Mode: drop confirmed-explicit catalog rows before the dial sees them.
  tracks = filterExplicitTracks(tracks, allowExplicit);

  if (useCache && tracks.length) {
    catalogCache.set(cacheKey, { tracks: [...tracks], cachedAt: Date.now() });
  }

  return NextResponse.json({
    tracks: orderCatalog(tracks),
    eraLock,
    allowExplicit,
  });
}
