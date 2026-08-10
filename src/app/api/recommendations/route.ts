import { NextResponse } from "next/server";
import {
  filterExplicitTracks,
  parseAllowExplicit,
} from "@/lib/content-filter";
import { applyArtistCap } from "@/lib/queue/builder";
import {
  fetchSpotifyRecommendationPool,
  RECOMMENDATION_POOL_SIZE,
} from "@/lib/spotify/recommendations";

export const dynamic = "force-dynamic";

/**
 * GET /api/recommendations
 *
 * Anti-repetition recommendation pool for Song Radio / Artist Radio:
 * - Requests up to 50 Spotify candidates
 * - Filters `exclude` (recentTrackIds)
 * - 70/30 hits (65–90) + deep cuts (40–64) when `target_popularity` omitted
 * - Fisher–Yates shuffles survivors, then artist-caps (max 2 per act)
 * - When `allowExplicit=false`, drops candidates with `explicit === true`
 *
 * Query:
 *   seed_tracks   comma-separated Spotify track ids
 *   seed_artists  comma-separated Spotify artist ids
 *   exclude       comma-separated ids to drop (recentTrackIds)
 *   limit         pool size (default 50, max 100)
 *   target_popularity  optional single-pool override (0–100); disables 70/30
 *   allowExplicit      when false (default), filter explicit tracks
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
  const hasExplicitPopularity = Number.isFinite(popularityRaw);
  const targetPopularity = hasExplicitPopularity
    ? Math.min(100, Math.max(0, popularityRaw))
    : undefined;

  try {
    const pool = await fetchSpotifyRecommendationPool({
      seedTracks,
      seedArtists,
      excludeIds: exclude,
      limit,
      ...(typeof targetPopularity === "number" ? { targetPopularity } : {}),
      balancedPopularityTiers: !hasExplicitPopularity,
    });
    // Cap after Clean Mode so dropped explicit rows free slots for other acts.
    const tracks = applyArtistCap(filterExplicitTracks(pool, allowExplicit), 2);

    return NextResponse.json({
      tracks,
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
