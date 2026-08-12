/**
 * Spotify Recommendations helper for Advanced Station Tuning.
 * Seeds via search (optional `year:` filter), then calls `/v1/recommendations`
 * with the Energy / Catalog Depth slider targets.
 */

import { getSpotifyAppToken, type SpotifyImage } from "@/lib/spotify/app-auth";
import { fetchSpotifyGetWithRetry } from "@/lib/spotify/fetchWithRetry";

export type SpotifyTuneTrack = {
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
  explicit?: boolean;
};

export type GetRecommendationsInput = {
  /** Energy Level slider 0-100 -> target_energy 0.0-1.0 */
  energyValue: number;
  /**
   * Catalog Depth slider 0100 (Mainstream   Deep Cuts).
   * Mapped to Spotify target_popularity: Mainstream ~80-100, Deep Cuts ~0-35.
   */
  catalogDepthValue: number;
  /** Freeform custom year window, e.g. "1997-2005" */
  yearRange?: string;
  /** Decade pills, e.g. "90s", "2000s", "Modern" */
  decades?: readonly string[];
  /** Genre labels used to build the seed search query */
  genres?: readonly string[];
  /** Recommendation pool size (default 40, max 100) */
  limit?: number;
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

const DECADE_YEAR_RANGE: Record<string, string> = {
  "60s": "1960-1969",
  "70s": "1970-1979",
  "80s": "1980-1989",
  "90s": "1990-1999",
  "2000s": "2000-2009",
  "2010s": "2010-2019",
  Modern: "2020-2029",
};

/** Energy slider -> Spotify target_energy (0.0-1.0). */
export function energyToTargetEnergy(energyValue: number): number {
  const n = Number.isFinite(energyValue) ? energyValue : 50;
  return Math.min(1, Math.max(0, Math.round(n) / 100));
}

/**
 * Catalog Depth slider (0 = Mainstream, 100 = Deep Cuts)  Spotify
 * `target_popularity`. Mainstream lands in 80100; Deep Cuts in 035.
 */
export function depthToTargetPopularity(catalogDepthValue: number): number {
  const depth = Math.min(100, Math.max(0, Math.round(catalogDepthValue)));
  // Invert slider: Mainstream (0) -> 100, Deep Cuts (100) -> 0 (bands 80-100 / 0-35).
  return 100 - depth;
}

/**
 * Prefer a freeform year window; otherwise span selected decade pills
 * (e.g. 90s  `1990-1999`, Modern  `2020-2029`).
 */
export function resolveYearFilter(
  yearRange?: string,
  decades?: readonly string[],
): string | undefined {
  const trimmed = yearRange?.trim().replace(/\s+/g, "") ?? "";
  if (/^\d{4}-\d{4}$/.test(trimmed)) return trimmed;
  if (/^\d{4}$/.test(trimmed)) return trimmed;

  if (!decades?.length) return undefined;

  const bounds: number[] = [];
  for (const decade of decades) {
    const range = DECADE_YEAR_RANGE[decade];
    if (!range) continue;
    const [lo, hi] = range.split("-").map((v) => Number.parseInt(v, 10));
    if (Number.isFinite(lo)) bounds.push(lo);
    if (Number.isFinite(hi)) bounds.push(hi);
  }
  if (!bounds.length) return undefined;
  return `${Math.min(...bounds)}-${Math.max(...bounds)}`;
}

function mapTrack(item: SpotifyTrackItem): SpotifyTuneTrack | null {
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

  return {
    id,
    name,
    artists,
    artistIds,
    album: item.album?.name?.trim() || undefined,
    durationMs:
      typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms)
        ? item.duration_ms
        : undefined,
    previewUrl: item.preview_url?.trim() || undefined,
    releaseDate: item.album?.release_date?.trim() || undefined,
    popularity:
      typeof item.popularity === "number" && Number.isFinite(item.popularity)
        ? item.popularity
        : undefined,
    images: item.album?.images,
    uri: item.uri?.trim() || `spotify:track:${id}`,
    explicit: item.explicit === true,
  };
}

/**
 * Build the Spotify search seed query. When a year window or decade is set,
 * appends `year:1997-2005`-style filter syntax before recommendations.
 */
export function buildSeedSearchQuery(input: {
  genres?: readonly string[];
  decades?: readonly string[];
  yearRange?: string;
}): string {
  const genrePart = (input.genres ?? [])
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  const decadePart = (input.decades ?? [])
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  let query = [genrePart, decadePart].filter(Boolean).join(" ").trim();
  if (!query) query = "classic hits";

  const yearFilter = resolveYearFilter(input.yearRange, input.decades);
  if (yearFilter) {
    query = `${query} year:${yearFilter}`;
  }
  return query;
}

async function searchSeedTrackIds(
  token: string,
  query: string,
  limit = 5,
): Promise<string[]> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(Math.min(10, Math.max(1, limit))),
  });
  const res = await fetchSpotifyGetWithRetry(
    `https://api.spotify.com/v1/search?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    },
  );
  if (!res.ok) {
    console.warn("[music/spotify] Seed search failed:", res.status);
    return [];
  }

  const data = (await res.json()) as { tracks?: { items?: SpotifyTrackItem[] } };
  const ids: string[] = [];
  for (const item of data.tracks?.items ?? []) {
    const id = item.id?.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= 5) break;
  }
  return ids;
}

/**
 * Fetch tuned Spotify recommendations for the Advanced Tuner.
 * Passes `target_energy` and `target_popularity` from the sliders; appends
 * year filter to the seed search when an era / custom year range is specified.
 */
export async function getRecommendations(
  input: GetRecommendationsInput,
): Promise<SpotifyTuneTrack[]> {
  const token = await getSpotifyAppToken();
  if (!token) return [];

  const seedQuery = buildSeedSearchQuery({
    genres: input.genres,
    decades: input.decades,
    yearRange: input.yearRange,
  });
  const seedTracks = await searchSeedTrackIds(token, seedQuery, 5);
  if (!seedTracks.length) {
    console.warn("[music/spotify] No seed tracks for query:", seedQuery);
    return [];
  }

  const limit = Math.min(100, Math.max(1, input.limit ?? 40));
  const targetEnergy = energyToTargetEnergy(input.energyValue);
  const targetPopularity = depthToTargetPopularity(input.catalogDepthValue);

  const params = new URLSearchParams({
    limit: String(limit),
    seed_tracks: seedTracks.join(","),
    target_energy: String(targetEnergy),
    target_popularity: String(targetPopularity),
  });

  const res = await fetch(
    `https://api.spotify.com/v1/recommendations?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    },
  );

  if (!res.ok) {
    console.warn("[music/spotify] Recommendations failed:", res.status);
    return [];
  }

  const data = (await res.json()) as { tracks?: SpotifyTrackItem[] };
  const out: SpotifyTuneTrack[] = [];
  const seen = new Set<string>();
  for (const item of data.tracks ?? []) {
    const mapped = mapTrack(item);
    if (!mapped || seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    out.push(mapped);
  }
  return out;
}
