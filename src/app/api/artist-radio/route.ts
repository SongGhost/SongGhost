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
import {
  fetchSpotifyRecommendationPool,
  RECOMMENDATION_POOL_SIZE,
  resolveSpotifyArtistId,
  type SpotifyRecommendationTrack,
} from "@/lib/spotify/recommendations";
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
  if (!isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs })) return null;

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
      return songs
        .filter((song) =>
          isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs }),
        )
        .slice(0, perArtist);
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

function spotifyRecToITunesSong(track: SpotifyRecommendationTrack): ITunesSong {
  const year = track.releaseDate
    ? Number.parseInt(track.releaseDate.slice(0, 4), 10)
    : undefined;
  return {
    title: track.name,
    artist: track.artists.join(", "),
    album: track.album,
    previewUrl: track.previewUrl,
    durationMs: track.durationMs,
    releaseYear:
      typeof year === "number" && Number.isFinite(year) && year >= 1900 && year <= 2100
        ? year
        : undefined,
  };
}

/**
 * Artist Radio (mixed): 50 Spotify recommendation candidates seeded by the
 * searched artist, minus recentTrackIds, with randomized target_popularity and
 * Fisher–Yates shuffle inside the helper.
 */
async function buildSpotifySimilarPool(
  artistName: string,
  excludeIds: readonly string[],
): Promise<Ranked<ITunesSong>[]> {
  const artistId = await resolveSpotifyArtistId(artistName);
  if (!artistId) return [];

  const pool = await fetchSpotifyRecommendationPool({
    seedArtists: [artistId],
    excludeIds,
    limit: RECOMMENDATION_POOL_SIZE,
  });

  return pool.map((track, index) => ({
    item: spotifyRecToITunesSong(track),
    rank: TIER_1_SIZE + index,
    tier: 2 as const,
    isPrimaryArtist: false,
  }));
}

async function buildArtistRadioTracks(
  artistName: string,
  mode: ArtistRadioMode,
  excludeYoutubeIds: ReadonlySet<string>,
  recentTrackIds: readonly string[],
): Promise<StationTrack[]> {
  const seen = new Set<string>();
  const matched = await findITunesArtistDetailed(artistName);
  const matchedArtist = matched?.name ?? artistName;

  const primaryPool = await buildDeepArtistPool(matchedArtist, {
    artistId: matched?.artistId,
    target: CATALOG_POOL_TARGET,
  });

  let similarPool: Ranked<ITunesSong>[] = [];
  if (mode === "mixed") {
    // Prefer Spotify recommendations (anti-repetition pool); fall back to Last.fm.
    similarPool = await buildSpotifySimilarPool(matchedArtist, recentTrackIds);
    if (!similarPool.length) {
      similarPool = await buildSimilarPool(
        await fetchSimilarArtists(matchedArtist, 6),
        3,
      );
    }
  }

  // Order on catalog metadata first so the expensive YouTube resolve only runs on
  // tracks we actually intend to deliver. Spotify path already Fisher–Yates shuffled.
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
  const recentTrackIds = (searchParams.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!artist) {
    return NextResponse.json({ error: "artist query parameter is required" }, { status: 400 });
  }

  const tracks = await buildArtistRadioTracks(
    artist,
    mode,
    excludeYoutubeIds,
    recentTrackIds,
  );

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
