import { NextResponse } from "next/server";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import { trackMatchesGenre } from "@/lib/genre-match";
import { getStationGenreProfile } from "@/lib/station-genre-profiles";
import { searchITunesGenreSongs, searchSongsByArtist, itunesPreviewToStationTrack, type ITunesSong } from "@/lib/itunes";
import { resolveTrackVideoId, searchYouTubeVideos } from "@/lib/youtube-search";
import { resolveInPool } from "@/lib/resolve-pool";
import { buildOrderedStationQueue, toRanked } from "@/lib/track-shuffle";

/** Responses are randomized per request and must never be statically cached. */
export const dynamic = "force-dynamic";

const CATALOG_CACHE_MS = 15 * 60 * 1000;
const catalogCache = new Map<string, { tracks: StationTrack[]; cachedAt: number }>();

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
): Promise<StationTrack[]> {
  return resolveInPool(
    songs,
    async (song) => {
      if (
        !trackMatchesGenre(
          { youtubeId: "", title: song.title, artist: song.artist },
          station,
          song.primaryGenreName,
        )
      ) {
        return null;
      }

      const youtubeId = await resolveTrackVideoId(song.artist, song.title);
      if (youtubeId && !seen.has(youtubeId)) {
        seen.add(youtubeId);
        return { youtubeId, title: song.title, artist: song.artist };
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

async function fetchCatalogFromITunes(station: Station, seen: Set<string>, limit: number): Promise<StationTrack[]> {
  const profile = getStationGenreProfile(station);
  const songCandidates: ITunesSong[] = [];
  const songKeys = new Set<string>();

  for (const term of shuffle(profile.catalogSearchTerms)) {
    if (songCandidates.length >= limit * 2) break;
    const songs = await searchITunesGenreSongs(term, Math.min(limit, 200));
    for (const song of songs) {
      const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
      if (songKeys.has(key)) continue;
      songKeys.add(key);
      songCandidates.push(song);
    }
  }

  for (const artist of shuffle(profile.anchorArtists)) {
    if (songCandidates.length >= limit * 2) break;
    const songs = await searchSongsByArtist(artist, 20);
    for (const song of songs) {
      const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
      if (songKeys.has(key)) continue;
      songKeys.add(key);
      songCandidates.push(song);
    }
  }

  return resolveTracksInParallel(shuffle(songCandidates), station, seen, limit);
}

async function fetchGenreTracks(station: Station, excludeSet: Set<string>): Promise<StationTrack[]> {
  const profile = getStationGenreProfile(station);
  const targetLimit = Math.min(profile.catalogDepth, 200);
  const seen = new Set<string>(excludeSet);
  const tracks: StationTrack[] = [];

  const queries = shuffle(buildSearchQueries(station)).slice(0, 20);
  const searchResults = await Promise.all(queries.map((query) => searchYouTubeVideos(query, 30)));

  for (const batch of searchResults) {
    for (const track of shuffle(batch)) {
      if (tracks.length >= targetLimit) break;
      if (seen.has(track.youtubeId)) continue;
      if (!trackMatchesGenre(track, station)) continue;
      seen.add(track.youtubeId);
      tracks.push(track);
    }
  }

  if (tracks.length < Math.min(60, targetLimit)) {
    const itunesTracks = await fetchCatalogFromITunes(station, seen, targetLimit - tracks.length);
    tracks.push(...itunesTracks);
  }

  return orderCatalog(tracks).slice(0, targetLimit);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get("stationId")?.trim();
  const exclude = searchParams.get("exclude")?.split(",").filter(Boolean) ?? [];

  if (!stationId) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }

  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Station not found" }, { status: 404 });
  }

  const excludeSet = new Set(exclude);
  const useCache = excludeSet.size === 0;
  const cached = catalogCache.get(stationId);

  if (useCache && cached && Date.now() - cached.cachedAt < CATALOG_CACHE_MS) {
    return NextResponse.json({ tracks: orderCatalog(cached.tracks) });
  }

  let tracks = await fetchGenreTracks(station, excludeSet);

  if (tracks.length === 0) {
    const unplayed = station.tracks.filter((t) => !excludeSet.has(t.youtubeId));
    tracks = shuffle(unplayed.length ? unplayed : [...station.tracks]);
  }

  tracks = tracks.filter(
    (t) => (t.youtubeId || t.previewUrl) && (!t.youtubeId || !excludeSet.has(t.youtubeId)),
  );

  if (useCache && tracks.length) {
    catalogCache.set(stationId, { tracks: [...tracks], cachedAt: Date.now() });
  }

  return NextResponse.json({ tracks: orderCatalog(tracks) });
}
