import { NextResponse } from "next/server";
import {
  fetchSpotifyRecommendationPool,
  RECOMMENDATION_POOL_SIZE,
  randomTargetPopularity,
} from "@/lib/spotify/recommendations";

export const dynamic = "force-dynamic";

/**
 * GET /api/recommendations
 *
 * Anti-repetition recommendation pool for Song Radio / Artist Radio:
 * - Requests up to 50 Spotify candidates
 * - Filters `exclude` (recentTrackIds)
 * - Randomizes `target_popularity` in [45, 85] when not supplied
 * - Fisher–Yates shuffles survivors before responding
 *
 * Query:
 *   seed_tracks   comma-separated Spotify track ids
 *   seed_artists  comma-separated Spotify artist ids
 *   exclude       comma-separated ids to drop (recentTrackIds)
 *   limit         pool size (default 50, max 100)
 *   target_popularity  optional override (0–100)
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

  if (!seedTracks.length && !seedArtists.length) {
    return NextResponse.json(
      { error: "seed_tracks or seed_artists is required" },
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
  const targetPopularity = Number.isFinite(popularityRaw)
    ? Math.min(100, Math.max(0, popularityRaw))
    : randomTargetPopularity();

  try {
    const tracks = await fetchSpotifyRecommendationPool({
      seedTracks,
      seedArtists,
      excludeIds: exclude,
      limit,
      targetPopularity,
    });

    return NextResponse.json({
      tracks,
      targetPopularity,
      poolSize: limit,
      excluded: exclude.length,
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
