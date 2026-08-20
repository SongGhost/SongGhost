import { NextResponse } from "next/server";
import { fetchLastFmArtistTags, fetchLastFmSimilarArtists } from "@/lib/catalog/lastfm";
import { enrichTracksWithMusicBrainz } from "@/lib/catalog/musicbrainz";
import {
  filterExplicitTracks,
  parseAllowExplicit,
} from "@/lib/content-filter";
import { searchSongsByArtist } from "@/lib/itunes";
import { applyArtistCap } from "@/lib/queue/builder";
import { resolveInPool } from "@/lib/resolve-pool";
import {
  fetchSpotifyRecommendationPool,
  RECOMMENDATION_POOL_SIZE,
  type SpotifyRecommendationTrack,
} from "@/lib/spotify/recommendations";
import { catalogDurationFromMs, resolveTrackVideoId } from "@/lib/youtube-search";

export const dynamic = "force-dynamic";

type RecommendationPayloadTrack = SpotifyRecommendationTrack & {
  youtubeId?: string;
  itunesTrackId?: number;
  streamUrl?: string;
};

function isDevYoutubeFallback(searchParams: URLSearchParams): boolean {
  return (
    searchParams.get("youtubeFallback") === "true" &&
    (process.env.NODE_ENV === "development" ||
      process.env.NEXT_PUBLIC_ENABLE_DEV_TOGGLE === "true")
  );
}

async function stampYoutubeIds(
  tracks: RecommendationPayloadTrack[],
): Promise<RecommendationPayloadTrack[]> {
  return resolveInPool(
    tracks,
    async (track) => {
      if (track.youtubeId?.trim()) return track;
      const artist = track.artists[0]?.trim();
      const title = track.name?.trim();
      if (!artist || !title) return track;
      const youtubeId = await resolveTrackVideoId(
        artist,
        title,
        undefined,
        catalogDurationFromMs(track.durationMs),
      );
      return youtubeId ? { ...track, youtubeId } : track;
    },
    { concurrency: 4 },
  );
}

/** Spotify catalog ids are 22-character base62; anything else is treated as a name. */
function looksLikeSpotifyId(value: string): boolean {
  return /^[A-Za-z0-9]{22}$/.test(value);
}

/**
 * Last.fm similarity needs a human artist name. Never read `tracks[0]` of a
 * possibly empty Spotify pool — Song Radio replenishment often has no
 * `spotifyId` and must pass `seed_artist_name` / seed metadata instead.
 */
function resolveSeedArtistName(
  searchParams: URLSearchParams,
  seedArtists: readonly string[],
): string {
  const fromQuery =
    searchParams.get("seed_artist_name")?.trim() ||
    searchParams.get("artist")?.trim() ||
    "";
  if (fromQuery) return fromQuery;
  const nameLike = seedArtists.find((value) => value && !looksLikeSpotifyId(value));
  return nameLike?.trim() ?? "";
}

/**
 * GET /api/recommendations
 *
 * Anti-repetition recommendation pool for Song Radio / Artist Radio:
 * - Requests up to 50 Spotify candidates
 * - Filters `exclude` (recentTrackIds)
 * - 70/30 hits (65–90) + deep cuts (40–64) when `target_popularity` omitted
 * - Fisher–Yates shuffles survivors, then artist-caps (max 2 per act)
 * - When `allowExplicit=false`, drops candidates with `explicit === true`
 * - Last.fm similar-artist widening uses `seed_artist_name` / `artist` (or a
 *   name-like `seed_artists` value), not `tracks[0]` of an empty Spotify pool
 *
 * Query:
 *   seed_tracks        comma-separated Spotify track ids
 *   seed_artists       comma-separated Spotify artist ids (or artist names)
 *   seed_artist_name   seed artist display name for Last.fm / iTunes fallback
 *   artist             alias for seed_artist_name
 *   exclude            comma-separated ids to drop (recentTrackIds)
 *   limit              pool size (default 50, max 100)
 *   target_popularity  optional single-pool override (0–100); disables 70/30
 *   allowExplicit      when false (default), filter explicit tracks
 *   youtubeFallback    development-only; when "true" (and NODE_ENV=development
 *                      or NEXT_PUBLIC_ENABLE_DEV_TOGGLE=true), stamp YouTube
 *                      video ids so refill candidates stay playable in Dev Mode
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seedTracks = (searchParams.get("seed_tracks") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seedArtists = (searchParams.get("seed_artists") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const exclude = (searchParams.get("exclude") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowExplicit = parseAllowExplicit(searchParams.get("allowExplicit"));
  const youtubeFallback = isDevYoutubeFallback(searchParams);
  const seedArtistName = resolveSeedArtistName(searchParams, seedArtists);

  if (!seedTracks.length && !seedArtists.length && !seedArtistName) {
    return NextResponse.json(
      { error: "seed_tracks, seed_artists, or seed_artist_name is required" },
      { status: 400 },
    );
  }

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(100, Math.max(1, limitRaw))
    : RECOMMENDATION_POOL_SIZE;

  const popularityRaw = Number.parseInt(
    searchParams.get("target_popularity") ?? "",
    10,
  );
  const hasExplicitPopularity = Number.isFinite(popularityRaw);
  const targetPopularity = hasExplicitPopularity
    ? Math.min(100, Math.max(0, popularityRaw))
    : undefined;

  try {
    const pool = await fetchSpotifyRecommendationPool({
      seedTracks,
      seedArtists: seedArtists.filter(looksLikeSpotifyId),
      excludeIds: exclude,
      limit,
      ...(typeof targetPopularity === "number" ? { targetPopularity } : {}),
      balancedPopularityTiers: !hasExplicitPopularity,
    });
    // Cap after Clean Mode so dropped explicit rows free slots for other acts.
    let tracks: RecommendationPayloadTrack[] = applyArtistCap(
      filterExplicitTracks(pool, allowExplicit),
      2,
    );

    const [similarArtists, acousticTags] = seedArtistName
      ? await Promise.all([
          fetchLastFmSimilarArtists(seedArtistName, 6),
          fetchLastFmArtistTags(seedArtistName, 6),
        ])
      : [[], []];

    if (tracks.length < Math.min(limit, 16) && similarArtists.length) {
      const extras: RecommendationPayloadTrack[] = [];
      const seen = new Set(tracks.map((row) => row.id));
      for (const artist of similarArtists.slice(0, 3)) {
        const songs = await searchSongsByArtist(artist, 8);
        for (const song of songs) {
          const id = song.trackId ? `itunes:${song.trackId}` : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          extras.push({
            id,
            name: song.title,
            artists: [song.artist],
            artistIds: [],
            album: song.album,
            previewUrl: song.previewUrl,
            releaseDate: song.releaseYear ? String(song.releaseYear) : undefined,
            uri: "",
            itunesTrackId: song.trackId,
            ...(song.explicit === true ? { explicit: true } : {}),
          });
        }
      }
      if (extras.length) {
        tracks = applyArtistCap(
          filterExplicitTracks([...tracks, ...extras], allowExplicit),
          2,
        );
      }
    }

    tracks = await enrichTracksWithMusicBrainz(tracks, { limit: 4 });

    if (youtubeFallback) {
      tracks = await stampYoutubeIds(tracks);
    }

    return NextResponse.json({
      tracks,
      similarArtists,
      acousticTags,
      targetPopularity: targetPopularity ?? null,
      balancedPopularityTiers: !hasExplicitPopularity,
      poolSize: limit,
      excluded: exclude.length,
      allowExplicit,
    });
  } catch (err) {
    console.error("[api/recommendations] Failed:", err);
    return NextResponse.json(
      {
        error: "Recommendations fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
