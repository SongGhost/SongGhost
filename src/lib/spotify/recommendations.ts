/**
 * Spotify Recommendations helpers for Song Radio / Artist Radio anti-repetition.
 * Fetches a large candidate pool, drops recently played ids, varies popularity
 * (70/30 hits vs deep cuts for preset-style pulls), Fisher–Yates shuffles, then
 * applies the shared artist frequency cap before the caller trims delivery size.
 */

import { applyArtistCap } from "@/lib/queue/builder";
import { fisherYatesShuffle } from "@/lib/queue/shuffle";
import { getSpotifyAppToken, type SpotifyImage } from "@/lib/spotify/app-auth";
import { fetchSpotifyGetWithRetry } from "@/lib/spotify/fetchWithRetry";

export const RECOMMENDATION_POOL_SIZE = 50;

/** Hits pool — ~70% of a balanced preset-station pull. */
export const HITS_POPULARITY = { min: 65, max: 90 } as const;
/** Deep-cuts pool — ~30% of a balanced preset-station pull. */
export const DEEP_CUTS_POPULARITY = { min: 40, max: 64 } as const;

export { fisherYatesShuffle, applyArtistCap };

export type SpotifyRecommendationTrack = {
  id: string;
  name: string;
  artists: string[];
  artistIds: string[];
  album?: string;
  durationMs?: number;
  previewUrl?: string;
  releaseDate?: string;
  popularity?: number;
  images?: SpotifyImage[];
  uri: string;
  /** Spotify `explicit` flag — Clean Mode drops these when false. */
  explicit?: boolean;
};

type SpotifyArtistRef = { name?: string; id?: string };
type SpotifyAlbumRef = {
  name?: string;
  images?: SpotifyImage[];
  release_date?: string;
};
type SpotifyTrackItem = {
  id?: string;
  name?: string;
  uri?: string;
  duration_ms?: number;
  preview_url?: string | null;
  popularity?: number;
  explicit?: boolean;
  artists?: SpotifyArtistRef[];
  album?: SpotifyAlbumRef;
};

export function randomTargetPopularity(min = 45, max = 85): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function mapTrack(item: SpotifyTrackItem): SpotifyRecommendationTrack | null {
  const id = item.id?.trim();
  const name = item.name?.trim();
  if (!id || !name) return null;

  const artists =
    item.artists
      ?.map((a) => a.name?.trim())
      .filter((n): n is string => Boolean(n)) ?? [];
  if (!artists.length) return null;

  const artistIds =
    item.artists
      ?.map((a) => a.id?.trim())
      .filter((n): n is string => Boolean(n)) ?? [];

  const album = item.album?.name?.trim();
  const previewUrl = item.preview_url?.trim() || undefined;
  const releaseDate = item.album?.release_date?.trim() || undefined;
  const uri = item.uri?.trim() || `spotify:track:${id}`;

  return {
    id,
    name,
    artists,
    artistIds,
    album,
    durationMs:
      typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms)
        ? item.duration_ms
        : undefined,
    previewUrl,
    releaseDate,
    popularity:
      typeof item.popularity === "number" && Number.isFinite(item.popularity)
        ? item.popularity
        : undefined,
    images: item.album?.images,
    uri,
    explicit: item.explicit === true,
  };
}

export type FetchRecommendationsInput = {
  seedTracks?: readonly string[];
  seedArtists?: readonly string[];
  /** Spotify track ids (and optionally youtube / composite keys) to exclude. */
  excludeIds?: readonly string[];
  /** Pool size requested from Spotify (default 50). */
  limit?: number;
  /**
   * Single-pool popularity override. When omitted, preset-station pulls use the
   * 70/30 hits + deep-cuts tier split instead of one random target.
   */
  targetPopularity?: number;
  /**
   * When true (default), fetch Pool A (hits 65–90) and Pool B (deep cuts 40–64)
   * at a 70/30 split, interleave, then shuffle. Ignored when `targetPopularity`
   * is supplied.
   */
  balancedPopularityTiers?: boolean;
};

type RecommendationSliceInput = {
  token: string;
  seedTracks: string[];
  seedArtists: string[];
  exclude: Set<string>;
  limit: number;
  targetPopularity: number;
};

async function fetchRecommendationSlice(
  input: RecommendationSliceInput,
): Promise<SpotifyRecommendationTrack[]> {
  const params = new URLSearchParams({
    limit: String(input.limit),
    target_popularity: String(
      Math.min(100, Math.max(0, Math.round(input.targetPopularity))),
    ),
  });
  if (input.seedTracks.length) {
    params.set("seed_tracks", input.seedTracks.join(","));
  }
  if (input.seedArtists.length) {
    params.set("seed_artists", input.seedArtists.join(","));
  }

  const res = await fetch(
    `https://api.spotify.com/v1/recommendations?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${input.token}` },
      next: { revalidate: 0 },
    },
  );

  if (!res.ok) {
    console.warn(
      "[spotify/recommendations] Spotify recommendations failed:",
      res.status,
    );
    return [];
  }

  const data = (await res.json()) as { tracks?: SpotifyTrackItem[] };
  const candidates: SpotifyRecommendationTrack[] = [];
  for (const item of data.tracks ?? []) {
    const mapped = mapTrack(item);
    if (!mapped) continue;
    if (input.exclude.has(mapped.id)) continue;
    if (input.exclude.has(mapped.uri)) continue;
    candidates.push(mapped);
  }
  return candidates;
}

/**
 * Interleave Pool A (hits) and Pool B (deep cuts) at a 7:3 cadence so the
 * merged window stays ~70/30 before the final shuffle.
 */
export function interleavePopularityPools<T>(
  hits: readonly T[],
  deepCuts: readonly T[],
): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < hits.length || j < deepCuts.length) {
    for (let n = 0; n < 7 && i < hits.length; n++) out.push(hits[i++]);
    for (let n = 0; n < 3 && j < deepCuts.length; n++) out.push(deepCuts[j++]);
  }
  return out;
}

function dedupeByTrackId(
  tracks: readonly SpotifyRecommendationTrack[],
  seen: Set<string>,
): SpotifyRecommendationTrack[] {
  const out: SpotifyRecommendationTrack[] = [];
  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

/**
 * Pulls Spotify recommendation candidates, filters `excludeIds`, applies
 * 70/30 popularity tiers (or a single `targetPopularity`), interleaves,
 * Fisher–Yates shuffles, then artist-caps the survivors.
 */
export async function fetchSpotifyRecommendationPool(
  input: FetchRecommendationsInput,
): Promise<SpotifyRecommendationTrack[]> {
  const token = await getSpotifyAppToken();
  if (!token) return [];

  const seedTracks = (input.seedTracks ?? [])
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 5);
  const seedArtists = (input.seedArtists ?? [])
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!seedTracks.length && !seedArtists.length) return [];

  const limit = Math.min(
    100,
    Math.max(1, input.limit ?? RECOMMENDATION_POOL_SIZE),
  );
  const exclude = new Set(
    (input.excludeIds ?? []).map((id) => id.trim()).filter(Boolean),
  );

  const hasExplicitPopularity =
    typeof input.targetPopularity === "number" &&
    Number.isFinite(input.targetPopularity);
  const useBalancedTiers =
    input.balancedPopularityTiers !== false && !hasExplicitPopularity;

  let candidates: SpotifyRecommendationTrack[];

  if (useBalancedTiers) {
    // Pool A (hits) ~70%, Pool B (deep cuts) ~30%.
    const hitsLimit = Math.max(1, Math.round(limit * 0.7));
    const deepLimit = Math.max(1, limit - hitsLimit);
    const [hitsRaw, deepRaw] = await Promise.all([
      fetchRecommendationSlice({
        token,
        seedTracks,
        seedArtists,
        exclude,
        limit: hitsLimit,
        targetPopularity: randomTargetPopularity(
          HITS_POPULARITY.min,
          HITS_POPULARITY.max,
        ),
      }),
      fetchRecommendationSlice({
        token,
        seedTracks,
        seedArtists,
        exclude,
        limit: deepLimit,
        targetPopularity: randomTargetPopularity(
          DEEP_CUTS_POPULARITY.min,
          DEEP_CUTS_POPULARITY.max,
        ),
      }),
    ]);

    const seen = new Set<string>();
    const hits = dedupeByTrackId(hitsRaw, seen);
    const deepCuts = dedupeByTrackId(deepRaw, seen);
    candidates = interleavePopularityPools(hits, deepCuts);
  } else {
    const targetPopularity = hasExplicitPopularity
      ? Math.round(input.targetPopularity as number)
      : randomTargetPopularity();
    candidates = await fetchRecommendationSlice({
      token,
      seedTracks,
      seedArtists,
      exclude,
      limit,
      targetPopularity,
    });
  }

  const shuffled = fisherYatesShuffle(candidates);
  return applyArtistCap(shuffled, 2);
}

/**
 * Resolve a Spotify artist id from a display name (best-effort search).
 */
export async function resolveSpotifyArtistId(
  artistName: string,
): Promise<string | null> {
  const token = await getSpotifyAppToken();
  const q = artistName.trim();
  if (!token || !q) return null;

  const params = new URLSearchParams({
    q,
    type: "artist",
    limit: "1",
  });
  const res = await fetchSpotifyGetWithRetry(
    `https://api.spotify.com/v1/search?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as {
    artists?: { items?: Array<{ id?: string; name?: string }> };
  };
  const hit = data.artists?.items?.[0];
  return hit?.id?.trim() || null;
}
