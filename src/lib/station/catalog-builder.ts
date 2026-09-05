import type { Station, StationTrack } from "@/data/stations";
import { fetchLastFmSimilarArtists } from "@/lib/catalog/lastfm";
import { enrichTracksWithMusicBrainz } from "@/lib/catalog/musicbrainz";
import {
  filterExplicitTracks,
  parseAllowExplicit,
} from "@/lib/content-filter";
import { trackMatchesGenre } from "@/lib/genre-match";
import { getStationGenreProfile } from "@/lib/station-genre-profiles";
import {
  searchITunesGenreSongs,
  searchSongsByArtist,
  type ITunesSong,
} from "@/lib/itunes";
import { resolveTrackVideoId, searchYouTubeVideos } from "@/lib/youtube-search";
import { resolveInPool } from "@/lib/resolve-pool";
import {
  applyArtistCap,
  buildEraFilteredQueue,
  filterTracksByEra,
  isValidRadioTrack,
  isYearWithinEra,
} from "@/lib/queue/builder";
import { isAcceptableCatalogTrack } from "@/lib/track-quality";
import {
  buildOrderedStationQueue,
  isPlayableStationTrack,
  toRanked,
} from "@/lib/track-shuffle";
import { isEraLocked, type EraLock } from "@/types/station";

/**
 * Floor for genre/decade catalog builds so a station launch can seed Spotify
 * with a full Connect queue (~25–30 URIs), not just the authored seed opener.
 */
export const MIN_STATION_CATALOG = 30;

export type CatalogExplicitMode = boolean | "allow";

/**
 * Weighted ordering with the no-back-to-back-same-artist rule. Genre catalogs carry
 * no popularity signal, so position stands in as the rank proxy.
 */
export function orderCatalog(tracks: StationTrack[]): StationTrack[] {
  return buildOrderedStationQueue(toRanked(tracks));
}

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildSearchQueries(station: Station): string[] {
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

export async function resolveTracksInParallel(
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
      if (!youtubeId || seen.has(youtubeId)) return null;
      seen.add(youtubeId);
      return {
        youtubeId,
        title: song.title,
        artist: song.artist,
        releaseYear: song.releaseYear,
        ...(song.album ? { album: song.album } : {}),
        ...(song.explicit === true ? { explicit: true } : {}),
      };
    },
    { limit },
  );
}

export async function fetchCatalogFromITunes(
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

  // Last.fm similarity widens the dated iTunes pool so era locks do not starve.
  const similarSeeds = profile.anchorArtists.slice(0, 2);
  for (const seed of similarSeeds) {
    if (songCandidates.length >= candidateTarget) break;
    const similar = await fetchLastFmSimilarArtists(seed, 4);
    for (const artist of similar) {
      if (songCandidates.length >= candidateTarget) break;
      const songs = await searchSongsByArtist(artist, isEraLocked(eraLock) ? 25 : 12);
      for (const song of songs) {
        const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
        if (songKeys.has(key)) continue;
        songKeys.add(key);
        songCandidates.push(song);
      }
    }
  }

  return resolveTracksInParallel(shuffle(songCandidates), station, seen, limit, eraLock);
}

export async function fetchGenreTracks(
  station: Station,
  excludeSet: Set<string>,
  eraLock: EraLock,
  options?: { limit?: number },
): Promise<StationTrack[]> {
  const profile = getStationGenreProfile(station);
  const requested =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.round(options.limit)
      : 0;
  // Requested `limit` is a floor, not a ceiling — never shrink a deeper profile
  // (Advanced Tuning / preset replenishment) just because a caller asked for 50.
  const targetLimit = Math.max(
    MIN_STATION_CATALOG,
    Math.min(Math.max(profile.catalogDepth, requested), 200),
  );
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

function resolveCatalogAllowExplicit(allowExplicit: CatalogExplicitMode): boolean {
  if (allowExplicit === "allow") return true;
  return parseAllowExplicit(allowExplicit);
}

/**
 * Post-fetch pipeline shared by preset replenishment and tuner/Inspired generate:
 * era lock → junk filter → Clean Mode → MusicBrainz enrich → artist cap + order.
 */
export async function finalizeStationCatalog(
  tracks: StationTrack[],
  options: { eraLock: EraLock; allowExplicit: CatalogExplicitMode },
): Promise<StationTrack[]> {
  const allowExplicit = resolveCatalogAllowExplicit(options.allowExplicit);
  let next = filterTracksByEra(tracks, options.eraLock);
  next = next.filter((t) => isValidRadioTrack(t.title, t.artist));
  next = filterExplicitTracks(next, allowExplicit);
  next = next.filter(isPlayableStationTrack);
  next = await enrichTracksWithMusicBrainz(next, { limit: 4 });
  return applyArtistCap(orderCatalog(next), 2);
}
