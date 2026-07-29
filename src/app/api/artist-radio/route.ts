import { NextResponse } from "next/server";
import {
  buildArtistRadioResult,
  findTracksInLibrary,
  type ArtistRadioResult,
} from "@/lib/artist-radio";
import {
  findITunesArtist,
  searchITunesGenreSongs,
  searchSongsByArtist,
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  type ITunesSong,
} from "@/lib/itunes";
import type { StationTrack } from "@/data/stations";
import { resolveTrackVideoId, searchYouTubeVideos } from "@/lib/youtube-search";

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function resolveSong(song: ITunesSong, seen: Set<string>): Promise<StationTrack | null> {
  const youtubeId = await resolveTrackVideoId(song.artist, song.title);
  if (youtubeId && !seen.has(youtubeId)) {
    seen.add(youtubeId);
    return itunesSongToStationTrack(song, youtubeId);
  }

  const previewTrack = itunesPreviewToStationTrack(song);
  if (!previewTrack) return null;

  const previewKey = previewTrack.itunesTrackId
    ? `preview:${previewTrack.itunesTrackId}`
    : `preview:${song.artist}::${song.title}`;
  if (seen.has(previewKey)) return null;
  seen.add(previewKey);
  return previewTrack;
}

async function fetchRelatedArtists(primaryArtist: string, limit = 6): Promise<string[]> {
  const songs = await searchSongsByArtist(primaryArtist, 5);
  const genre = songs.find((s) => s.primaryGenreName)?.primaryGenreName;
  if (!genre) return [];

  const genreSongs = await searchITunesGenreSongs(genre, 40);
  const related = new Set<string>();

  for (const song of genreSongs) {
    if (song.artist.toLowerCase() === primaryArtist.toLowerCase()) continue;
    related.add(song.artist);
    if (related.size >= limit) break;
  }

  return [...related];
}

async function buildArtistRadioTracks(artistName: string): Promise<StationTrack[]> {
  const seen = new Set<string>();
  const tracks: StationTrack[] = [];

  const ytResults = await searchYouTubeVideos(`${artistName} official music`, 15);
  for (const track of ytResults) {
    if (seen.has(track.youtubeId)) continue;
    seen.add(track.youtubeId);
    tracks.push({ ...track, artist: artistName });
  }

  const matchedArtist = (await findITunesArtist(artistName)) ?? artistName;
  const primarySongs = await searchSongsByArtist(matchedArtist, 20);

  for (const song of primarySongs) {
    const track = await resolveSong(song, seen);
    if (track) tracks.push(track);
  }

  const relatedArtists = await fetchRelatedArtists(matchedArtist, 8);
  for (const related of shuffle(relatedArtists).slice(0, 5)) {
    const relatedSongs = await searchSongsByArtist(related, 4);
    for (const song of relatedSongs) {
      const track = await resolveSong(song, seen);
      if (track) tracks.push(track);
    }
  }

  if (tracks.length < 8) {
    const library = findTracksInLibrary(artistName);
    for (const track of library) {
      if (seen.has(track.youtubeId)) continue;
      seen.add(track.youtubeId);
      tracks.push(track);
    }
  }

  return shuffle(tracks);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get("artist")?.trim();

  if (!artist) {
    return NextResponse.json({ error: "artist query parameter is required" }, { status: 400 });
  }

  const tracks = await buildArtistRadioTracks(artist);

  if (tracks.length === 0) {
    return NextResponse.json(
      { error: `No tracks found for "${artist}". Try another artist name.` },
      { status: 404 },
    );
  }

  const result: ArtistRadioResult = buildArtistRadioResult(artist, tracks);
  return NextResponse.json(result);
}
