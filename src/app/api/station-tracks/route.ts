import { NextResponse } from "next/server";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import { trackMatchesGenre } from "@/lib/genre-match";
import { getStationGenreProfile } from "@/lib/station-genre-profiles";
import { searchITunesArtists, searchITunesGenreSongs, searchSongsByArtist } from "@/lib/itunes";
import { resolveTrackVideoId, searchYouTubeVideos } from "@/lib/youtube-search";

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
    ...profile.catalogSearchTerms.map((term) => `${term} official music`),
    ...profile.anchorArtists.slice(0, 5).map((artist) => `${artist} official music video`),
    `${station.name} hits official`,
  ];
  return [...new Set(variants)];
}

async function fetchCatalogFromITunes(station: Station, seen: Set<string>, limit: number): Promise<StationTrack[]> {
  const profile = getStationGenreProfile(station);
  const tracks: StationTrack[] = [];

  for (const term of shuffle(profile.catalogSearchTerms).slice(0, 3)) {
    if (tracks.length >= limit) break;
    const songs = await searchITunesGenreSongs(term, profile.catalogDepth);
    for (const song of shuffle(songs)) {
      if (tracks.length >= limit) break;
      if (!trackMatchesGenre({ youtubeId: "", title: song.title, artist: song.artist }, station, song.primaryGenreName)) {
        continue;
      }
      const youtubeId = await resolveTrackVideoId(song.artist, song.title);
      if (!youtubeId || seen.has(youtubeId)) continue;
      seen.add(youtubeId);
      tracks.push({ youtubeId, title: song.title, artist: song.artist });
    }
  }

  for (const artist of shuffle(profile.anchorArtists).slice(0, 6)) {
    if (tracks.length >= limit) break;
    const songs = await searchSongsByArtist(artist, 8);
    for (const song of songs) {
      if (tracks.length >= limit) break;
      if (!trackMatchesGenre({ youtubeId: "", title: song.title, artist: song.artist }, station, song.primaryGenreName)) {
        continue;
      }
      const youtubeId = await resolveTrackVideoId(song.artist, song.title);
      if (!youtubeId || seen.has(youtubeId)) continue;
      seen.add(youtubeId);
      tracks.push({ youtubeId, title: song.title, artist: song.artist });
    }
  }

  const discoveredArtists = shuffle(await searchITunesArtists(station.name, 8));
  for (const artist of discoveredArtists.slice(0, 4)) {
    if (tracks.length >= limit) break;
    const songs = await searchSongsByArtist(artist, 6);
    for (const song of songs) {
      if (tracks.length >= limit) break;
      if (!trackMatchesGenre({ youtubeId: "", title: song.title, artist: song.artist }, station, song.primaryGenreName)) {
        continue;
      }
      const youtubeId = await resolveTrackVideoId(song.artist, song.title);
      if (!youtubeId || seen.has(youtubeId)) continue;
      seen.add(youtubeId);
      tracks.push({ youtubeId, title: song.title, artist: song.artist });
    }
  }

  return tracks.slice(0, limit);
}

async function fetchGenreTracks(station: Station, excludeSet: Set<string>): Promise<StationTrack[]> {
  const profile = getStationGenreProfile(station);
  const seen = new Set<string>(excludeSet);
  const tracks: StationTrack[] = [];

  for (const query of shuffle(buildSearchQueries(station)).slice(0, 4)) {
    if (tracks.length >= 30) break;
    const results = await searchYouTubeVideos(query, 20);
    for (const track of results) {
      if (seen.has(track.youtubeId)) continue;
      if (!trackMatchesGenre(track, station)) continue;
      seen.add(track.youtubeId);
      tracks.push(track);
    }
  }

  if (tracks.length < 20) {
    const itunesTracks = await fetchCatalogFromITunes(station, seen, Math.min(profile.catalogDepth, 40));
    tracks.push(...itunesTracks);
  }

  return shuffle(tracks);
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
  let tracks = await fetchGenreTracks(station, excludeSet);

  if (tracks.length === 0) {
    const unplayed = station.tracks.filter((t) => !excludeSet.has(t.youtubeId));
    tracks = shuffle(unplayed.length ? unplayed : [...station.tracks]);
  }

  tracks = tracks.filter((t) => t.youtubeId && !excludeSet.has(t.youtubeId));

  return NextResponse.json({ tracks: shuffle(tracks) });
}
