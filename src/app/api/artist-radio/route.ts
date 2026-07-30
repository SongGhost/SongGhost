import { NextResponse } from "next/server";
import {
  buildArtistRadioResult,
  findTracksInLibrary,
  type ArtistRadioMode,
  type ArtistRadioResult,
} from "@/lib/artist-radio";
import {
  findITunesArtist,
  searchSongsByArtistStrict,
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  type ITunesSong,
} from "@/lib/itunes";
import { fetchSimilarArtists, isLastFmConfigured } from "@/lib/similar-artists";
import type { StationTrack } from "@/data/stations";
import { isAcceptableArtistRadioTrack } from "@/lib/track-quality";
import { parseFailedYoutubeIdsParam } from "@/lib/failed-youtube-ids";
import { isValidYouTubeVideoId } from "@/lib/youtube";
import { resolveTrackVideoId } from "@/lib/youtube-search";

function parseArtistRadioMode(value: string | null): ArtistRadioMode {
  return value === "artist-only" ? "artist-only" : "mixed";
}

function interleaveRadioTracks(primary: StationTrack[], similar: StationTrack[]): StationTrack[] {
  const playlist: StationTrack[] = [];
  let primaryIndex = 0;
  let similarIndex = 0;

  while (primaryIndex < primary.length || similarIndex < similar.length) {
    for (let i = 0; i < 2 && primaryIndex < primary.length; i += 1) {
      playlist.push(primary[primaryIndex]);
      primaryIndex += 1;
    }
    if (similarIndex < similar.length) {
      playlist.push(similar[similarIndex]);
      similarIndex += 1;
    }
  }

  return playlist;
}

async function resolveSong(
  song: ITunesSong,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack | null> {
  if (!isAcceptableArtistRadioTrack(song.title)) return null;

  const youtubeId = await resolveTrackVideoId(song.artist, song.title, excludeYoutubeIds);
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

function promotePlayableLeadTrack(tracks: StationTrack[]): StationTrack[] {
  if (tracks.length <= 1) return tracks;

  const lead = tracks[0];
  const leadHasYoutube = Boolean(lead.youtubeId?.trim());
  const leadHasPreview = Boolean(lead.previewUrl?.trim());
  if (!leadHasYoutube || leadHasPreview) return tracks;

  const fallbackIndex = tracks.findIndex(
    (track, index) => index > 0 && Boolean(track.previewUrl?.trim()),
  );
  if (fallbackIndex <= 0) return tracks;

  const next = [...tracks];
  [next[0], next[fallbackIndex]] = [next[fallbackIndex], next[0]];
  return next;
}

async function buildPrimaryTracks(
  matchedArtist: string,
  limit: number,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack[]> {
  const tracks: StationTrack[] = [];
  const songs = await searchSongsByArtistStrict(matchedArtist, limit);

  for (const song of songs) {
    const track = await resolveSong(song, seen, excludeYoutubeIds);
    if (track) tracks.push(track);
  }

  return tracks;
}

async function buildSimilarTracks(
  similarArtists: string[],
  perArtist: number,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack[]> {
  const tracks: StationTrack[] = [];

  for (const related of similarArtists) {
    const relatedSongs = await searchSongsByArtistStrict(related, perArtist + 2);
    let added = 0;

    for (const song of relatedSongs) {
      if (added >= perArtist) break;
      const track = await resolveSong(song, seen, excludeYoutubeIds);
      if (track) {
        tracks.push(track);
        added += 1;
      }
    }
  }

  return tracks;
}

async function buildArtistRadioTracks(
  artistName: string,
  mode: ArtistRadioMode,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack[]> {
  const seen = new Set<string>();
  const matchedArtist = (await findITunesArtist(artistName)) ?? artistName;

  if (mode === "artist-only") {
    const primaryTracks = await buildPrimaryTracks(matchedArtist, 35, seen, excludeYoutubeIds);

    if (primaryTracks.length < 8) {
      for (const track of findTracksInLibrary(artistName)) {
        if (!isAcceptableArtistRadioTrack(track.title)) continue;
        if (!track.youtubeId || !isValidYouTubeVideoId(track.youtubeId) || seen.has(track.youtubeId))
          continue;
        seen.add(track.youtubeId);
        primaryTracks.push(track);
      }
    }

    return promotePlayableLeadTrack(primaryTracks);
  }

  const primaryTracks = await buildPrimaryTracks(matchedArtist, 20, seen, excludeYoutubeIds);
  const similarArtists = await fetchSimilarArtists(matchedArtist, 6);
  const similarTracks =
    similarArtists.length > 0
      ? await buildSimilarTracks(similarArtists, 2, seen, excludeYoutubeIds)
      : [];

  if (primaryTracks.length + similarTracks.length < 8) {
    for (const track of findTracksInLibrary(artistName)) {
      if (!isAcceptableArtistRadioTrack(track.title)) continue;
      if (!track.youtubeId || !isValidYouTubeVideoId(track.youtubeId) || seen.has(track.youtubeId))
        continue;
      seen.add(track.youtubeId);
      primaryTracks.push(track);
    }
  }

  return promotePlayableLeadTrack(interleaveRadioTracks(primaryTracks, similarTracks));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get("artist")?.trim();
  const mode = parseArtistRadioMode(searchParams.get("mode"));
  const excludeYoutubeIds = parseFailedYoutubeIdsParam(searchParams.get("excludeYoutubeIds"));

  if (!artist) {
    return NextResponse.json({ error: "artist query parameter is required" }, { status: 400 });
  }

  const tracks = await buildArtistRadioTracks(artist, mode, excludeYoutubeIds);

  if (tracks.length === 0) {
    return NextResponse.json(
      { error: `No tracks found for "${artist}". Try another artist name.` },
      { status: 404 },
    );
  }

  const result: ArtistRadioResult = buildArtistRadioResult(artist, tracks, mode);

  return NextResponse.json({
    ...result,
    similarArtistsConfigured: isLastFmConfigured(),
  });
}
