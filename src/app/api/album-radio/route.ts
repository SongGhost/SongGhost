import { NextResponse } from "next/server";
import { buildAlbumContextFromITunes, buildAlbumRadioResult } from "@/lib/album-radio";
import {
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  lookupITunesAlbum,
  searchITunesAlbums,
  type ITunesSong,
} from "@/lib/itunes";
import { parseFailedYoutubeIdsParam } from "@/lib/failed-youtube-ids";
import { buildStationQueue } from "@/lib/queue/builder";
import { resolveInPool } from "@/lib/resolve-pool";
import { isAcceptableCatalogTrack } from "@/lib/track-quality";
import { resolveTrackVideoId } from "@/lib/youtube-search";
import type { StationTrack } from "@/data/stations";
import { MAX_ALBUM_TRACKS } from "@/types/station";

/** Album resolution hits live store fronts and must never be statically cached. */
export const dynamic = "force-dynamic";

async function resolveAlbumSong(
  song: ITunesSong,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack | null> {
  if (!isAcceptableCatalogTrack({ title: song.title, durationMs: song.durationMs })) {
    return null;
  }

  const youtubeId = await resolveTrackVideoId(
    song.artist,
    song.title,
    excludeYoutubeIds,
    song.durationMs != null ? song.durationMs / 1000 : undefined,
  );
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

async function resolveCollectionId(
  collectionId: number,
  excludeYoutubeIds: ReadonlySet<string>,
) {
  const lookedUp = await lookupITunesAlbum(collectionId);
  if (!lookedUp || lookedUp.songs.length === 0) {
    return NextResponse.json({ error: "Album not found or has no tracks" }, { status: 404 });
  }

  const albumContext = buildAlbumContextFromITunes(lookedUp.album, lookedUp.songs);
  if (!albumContext) {
    return NextResponse.json({ error: "Could not build album sleeve metadata" }, { status: 422 });
  }

  const seen = new Set<string>();
  const candidates = lookedUp.songs.slice(0, MAX_ALBUM_TRACKS);
  const resolved = await resolveInPool(
    candidates,
    (song) => resolveAlbumSong(song, seen, excludeYoutubeIds),
    { concurrency: 10 },
  );

  // Sequence against the sleeve so play order is the printed running order even
  // when a YouTube miss drops a mid-album track (gaps stay gaps, not reshuffles).
  const sequenced = buildStationQueue({
    tracks: resolved,
    mode: "album_deep_dive",
    albumContext,
  });

  if (sequenced.tracks.length === 0) {
    return NextResponse.json(
      {
        error: `No playable tracks found for "${albumContext.albumTitle}" by ${albumContext.artist}.`,
      },
      { status: 404 },
    );
  }

  const result = buildAlbumRadioResult(albumContext, sequenced.tracks, collectionId);
  return NextResponse.json({
    ...result,
    mode: "album_deep_dive" as const,
    missingTitles: sequenced.missingTitles,
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const collectionIdParam = searchParams.get("collectionId")?.trim();
  const q = searchParams.get("q")?.trim();
  const excludeYoutubeIds = parseFailedYoutubeIdsParam(searchParams.get("excludeYoutubeIds"));

  let collectionId = collectionIdParam ? Number(collectionIdParam) : NaN;

  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    if (!q || q.length < 2) {
      return NextResponse.json(
        { error: "collectionId or q query parameter is required" },
        { status: 400 },
      );
    }

    const matches = await searchITunesAlbums(q, 1);
    const top = matches[0];
    if (!top) {
      return NextResponse.json({ error: `No albums found for "${q}".` }, { status: 404 });
    }
    collectionId = top.collectionId;
  }

  return resolveCollectionId(collectionId, excludeYoutubeIds);
}
