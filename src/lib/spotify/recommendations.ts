/**
 * Spotify Recommendations helpers for Song Radio / Artist Radio anti-repetition.
 * Fetches a large candidate pool, drops recently played ids, varies popularity,
 * then Fisher–Yates shuffles before the caller trims to a delivery size.
 */

import { fisherYatesShuffle } from "@/lib/queue/shuffle";
import { getSpotifyAppToken, type SpotifyImage } from "@/lib/spotify/app-auth";

export const RECOMMENDATION_POOL_SIZE = 50;

export { fisherYatesShuffle };

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
  /** When omitted, a random value in [45, 85] is chosen. */
  targetPopularity?: number;
};

/**
 * Pulls Spotify recommendation candidates, filters `excludeIds`, applies
 * randomized `target_popularity`, and Fisher–Yates shuffles the survivors.
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
  const targetPopularity =
    typeof input.targetPopularity === "number" &&
    Number.isFinite(input.targetPopularity)
      ? Math.round(input.targetPopularity)
      : randomTargetPopularity();

  const params = new URLSearchParams({
    limit: String(limit),
    target_popularity: String(Math.min(100, Math.max(0, targetPopularity))),
  });
  if (seedTracks.length) params.set("seed_tracks", seedTracks.join(","));
  if (seedArtists.length) params.set("seed_artists", seedArtists.join(","));

  const res = await fetch(
    `https://api.spotify.com/v1/recommendations?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
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
  const exclude = new Set(
    (input.excludeIds ?? []).map((id) => id.trim()).filter(Boolean),
  );

  const candidates: SpotifyRecommendationTrack[] = [];
  for (const item of data.tracks ?? []) {
    const mapped = mapTrack(item);
    if (!mapped) continue;
    if (exclude.has(mapped.id)) continue;
    if (exclude.has(mapped.uri)) continue;
    candidates.push(mapped);
  }

  return fisherYatesShuffle(candidates);
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
  const res = await fetch(
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
