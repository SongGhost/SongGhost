import { NextResponse } from "next/server";
import {
  ARTIST_RADIO_PAYLOAD_SIZE,
  buildArtistRadioResult,
  finalizeArtistRadioTracks,
  findTracksInLibrary,
  orderArtistRadioTracks,
  type ArtistRadioMode,
  type ArtistRadioResult,
} from "@/lib/artist-radio";
import {
  buildDeepArtistPool,
  findITunesArtistDetailed,
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
import { resolveInPool } from "@/lib/resolve-pool";
import { splitTiers, TIER_1_SIZE, type Ranked } from "@/lib/track-shuffle";

/** Ordering is randomized per request, so responses must never be statically cached. */
export const dynamic = "force-dynamic";

/** Deep pool fetched from iTunes before ordering and trimming to the payload size. */
const CATALOG_POOL_TARGET = 100;
/** Resolve headroom above the payload so YouTube misses don't shrink the delivered queue. */
const RESOLVE_CANDIDATES = 40;

function parseArtistRadioMode(value: string | null): ArtistRadioMode {
  return value === "artist-only" ? "artist-only" : "mixed";
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

/**
 * Similar-artist tracks are ranked below the primary artist's Tier 1 so they mix into
 * the tail as deep cuts and can never win the opening slot.
 */
async function buildSimilarPool(
  similarArtists: string[],
  perArtist: number,
): Promise<Ranked<ITunesSong>[]> {
  const pools = await Promise.all(
    similarArtists.map(async (related) => {
      const songs = await searchSongsByArtistStrict(related, perArtist + 2);
      return songs.filter((song) => isAcceptableArtistRadioTrack(song.title)).slice(0, perArtist);
    }),
  );

  return pools.flat().map((song, index) => ({
    item: song,
    rank: TIER_1_SIZE + index,
    tier: 2 as const,
    isPrimaryArtist: false,
  }));
}

/** Local library entries have no popularity signal — they backfill the tail only. */
function libraryFallbackTracks(artistName: string, seen: Set<string>): StationTrack[] {
  const out: StationTrack[] = [];

  for (const track of findTracksInLibrary(artistName)) {
    if (!isAcceptableArtistRadioTrack(track.title)) continue;
    if (!track.youtubeId || !isValidYouTubeVideoId(track.youtubeId)) continue;
    if (seen.has(track.youtubeId)) continue;
    seen.add(track.youtubeId);
    out.push(track);
  }

  return out;
}

function songIdentity(song: ITunesSong): string {
  return song.trackId
    ? `id:${song.trackId}`
    : `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
}

async function buildArtistRadioTracks(
  artistName: string,
  mode: ArtistRadioMode,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack[]> {
  const seen = new Set<string>();
  const matched = await findITunesArtistDetailed(artistName);
  const matchedArtist = matched?.name ?? artistName;

  const primaryPool = await buildDeepArtistPool(matchedArtist, {
    artistId: matched?.artistId,
    target: CATALOG_POOL_TARGET,
  });

  const similarPool =
    mode === "mixed"
      ? await buildSimilarPool(await fetchSimilarArtists(matchedArtist, 6), 3)
      : [];

  // Order on iTunes metadata first so the expensive YouTube resolve only runs on
  // tracks we actually intend to deliver. This is the one randomization point.
  const orderedSongs = orderArtistRadioTracks(splitTiers([...primaryPool, ...similarPool]), {
    payloadSize: RESOLVE_CANDIDATES,
    identify: songIdentity,
  });

  const resolved = await resolveInPool(
    orderedSongs,
    (song) => resolveSong(song, seen, excludeYoutubeIds),
    { concurrency: 10, limit: ARTIST_RADIO_PAYLOAD_SIZE },
  );

  if (resolved.length < 8) {
    resolved.push(...libraryFallbackTracks(artistName, seen));
  }

  return finalizeArtistRadioTracks(resolved).slice(0, ARTIST_RADIO_PAYLOAD_SIZE);
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
