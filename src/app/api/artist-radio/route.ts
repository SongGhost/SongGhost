import { NextResponse } from "next/server";
import {
  buildArtistRadioResult,
  findTracksInLibrary,
  type ArtistRadioResult,
} from "@/lib/artist-radio";
import {
  findITunesArtist,
  searchITunesGenreSongs,
  searchSongsByArtistStrict,
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  type ITunesSong,
} from "@/lib/itunes";
import type { StationTrack } from "@/data/stations";
import { isAcceptableArtistRadioTrack, normalizeArtistName } from "@/lib/track-quality";
import { isValidYouTubeVideoId } from "@/lib/youtube";
import { resolveTrackVideoId } from "@/lib/youtube-search";

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function resolveSong(song: ITunesSong, seen: Set<string>): Promise<StationTrack | null> {
  if (!isAcceptableArtistRadioTrack(song.title)) return null;

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
  const songs = await searchSongsByArtistStrict(primaryArtist, 8);
  const genre = songs.find((s) => s.primaryGenreName)?.primaryGenreName;
  if (!genre) return [];

  const genreSongs = await searchITunesGenreSongs(genre, 60);
  const counts = new Map<string, number>();
  const normPrimary = normalizeArtistName(primaryArtist);

  for (const song of genreSongs) {
    if (!isAcceptableArtistRadioTrack(song.title)) continue;

    const normArtist = normalizeArtistName(song.artist);
    if (normArtist === normPrimary) continue;

    counts.set(song.artist, (counts.get(song.artist) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([artist]) => artist);
}

async function buildArtistRadioTracks(artistName: string): Promise<StationTrack[]> {
  const seen = new Set<string>();
  const primaryTracks: StationTrack[] = [];
  const relatedTracks: StationTrack[] = [];

  const matchedArtist = (await findITunesArtist(artistName)) ?? artistName;
  const primarySongs = await searchSongsByArtistStrict(matchedArtist, 25);

  for (const song of primarySongs) {
    const track = await resolveSong(song, seen);
    if (track) primaryTracks.push(track);
  }

  const relatedArtists = await fetchRelatedArtists(matchedArtist, 6);
  for (const related of relatedArtists) {
    const relatedSongs = await searchSongsByArtistStrict(related, 5);
    for (const song of relatedSongs) {
      const track = await resolveSong(song, seen);
      if (track) relatedTracks.push(track);
    }
  }

  const libraryTracks: StationTrack[] = [];
  if (primaryTracks.length + relatedTracks.length < 8) {
    for (const track of findTracksInLibrary(artistName)) {
      if (!isAcceptableArtistRadioTrack(track.title)) continue;
      if (!track.youtubeId || !isValidYouTubeVideoId(track.youtubeId) || seen.has(track.youtubeId))
        continue;
      seen.add(track.youtubeId);
      libraryTracks.push(track);
    }
  }

  return [
    ...primaryTracks,
    ...shuffle(relatedTracks),
    ...shuffle(libraryTracks),
  ];
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
