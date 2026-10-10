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
import { preferPlayableCandidates } from "@/lib/youtube/playability";
import { isValidYouTubeVideoId } from "@/lib/youtube/ids";
import { resolveTrackVideoId, searchYouTubeVideos } from "@/lib/youtube-search";
import { classifyYouTubePlayback } from "@/lib/youtube/youtube-search";
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
import type { MixPoolName, PreviousCast } from "@/lib/artist-mix";
import { loadStationSceneHour } from "@/lib/station/scene-hour";

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
        seen,
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
  options?: {
    limit?: number;
    previous?: PreviousCast;
    cachedPool?: { names: readonly MixPoolName[]; at: number } | null;
    starter?: StationTrack | null;
  },
): Promise<StationTrack[]> {
  const hour = await loadStationSceneHour({
    station,
    excludeYoutubeIds: excludeSet,
    eraLock,
    previous: options?.previous,
    cachedPool: options?.cachedPool,
    starter: options?.starter,
  });
  return hour.tracks;
}

function resolveCatalogAllowExplicit(allowExplicit: CatalogExplicitMode): boolean {
  if (allowExplicit === "allow") return true;
  return parseAllowExplicit(allowExplicit);
}

/**
 * Drop listings YouTube says cannot embed, and put a playable id ahead of a
 * region-locked or age-gated one. A check that does not answer leaves the
 * order alone.
 */
async function placePlayableTracksFirst(tracks: StationTrack[]): Promise<StationTrack[]> {
  if (!tracks.length) return tracks;
  const ids = tracks
    .map((track) => track.youtubeId?.trim() ?? "")
    .filter((id) => isValidYouTubeVideoId(id));
  if (!ids.length) return tracks;

  try {
    const verdicts = await classifyYouTubePlayback(ids);
    if (verdicts.size === 0) return tracks;
    return preferPlayableCandidates(tracks, verdicts);
  } catch {
    return tracks;
  }
}

/**
 * Post-fetch pipeline shared by preset replenishment and tuner/Inspired generate:
 * era lock → junk filter → Clean Mode → MusicBrainz enrich → artist cap + order
 * → playable videos toward the front.
 */
export async function finalizeStationCatalog(
  tracks: StationTrack[],
  options: {
    eraLock: EraLock;
    allowExplicit: CatalogExplicitMode;
    /** Scene hours allow 3 songs for the closest artists. */
    artistCap?: number;
    /** Keep the woven scene order. Song 1 stays put. */
    keepOrder?: boolean;
  },
): Promise<StationTrack[]> {
  const allowExplicit = resolveCatalogAllowExplicit(options.allowExplicit);
  let next = filterTracksByEra(tracks, options.eraLock);
  next = next.filter((t) => isValidRadioTrack(t.title, t.artist));
  next = filterExplicitTracks(next, allowExplicit);
  next = next.filter(isPlayableStationTrack);
  next = await enrichTracksWithMusicBrainz(next, { limit: 4 });
  const cap = options.artistCap ?? 2;
  const ordered = options.keepOrder ? next : orderCatalog(next);
  const capped = applyArtistCap(ordered, cap);
  const playable = await placePlayableTracksFirst(capped);
  if (!options.keepOrder || playable.length === 0) return playable;
  const openerId = capped[0]?.youtubeId?.trim();
  if (!openerId) return playable;
  const index = playable.findIndex((track) => track.youtubeId?.trim() === openerId);
  if (index <= 0) return playable;
  return [playable[index]!, ...playable.slice(0, index), ...playable.slice(index + 1)];
}
