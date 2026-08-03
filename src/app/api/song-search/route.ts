import { NextResponse } from "next/server";
import type { StationTrack } from "@/data/stations";
import {
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  searchITunesSongs,
} from "@/lib/itunes";
import { resolveTrackVideoId } from "@/lib/youtube-search";

/**
 * Results depend on live iTunes and YouTube lookups, so a cached response would
 * pin a stale set of tracks. Ordering stays relevance-ranked — this feeds the
 * add-to-queue picker, where the closest match belongs at the top.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ tracks: [] });
  }

  const songs = await searchITunesSongs(q, 10);
  const results = await Promise.all(
    songs.map(async (song) => {
      const youtubeId = await resolveTrackVideoId(song.artist, song.title);
      return youtubeId
        ? itunesSongToStationTrack(song, youtubeId)
        : itunesPreviewToStationTrack(song);
    }),
  );

  const tracks: StationTrack[] = [];
  const seen = new Set<string>();

  for (const track of results) {
    if (!track) continue;
    const dedupeKey =
      track.youtubeId || `preview:${track.itunesTrackId ?? `${track.artist}::${track.title}`}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    tracks.push(track);
  }

  return NextResponse.json({ tracks });
}
