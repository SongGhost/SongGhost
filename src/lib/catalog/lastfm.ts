/**
 * Lightweight Last.fm client — artist similarity and folksonomy tags
 * used to widen statutory recommendation / station-track pools.
 */

import { normalizeArtistName } from "@/lib/track-quality";

const LASTFM_ENDPOINT = "https://ws.audioscrobbler.com/2.0/";

type LastFmArtist = { name?: string };
type LastFmTag = { name?: string; count?: number };

type LastFmSimilarResponse = {
  error?: number;
  message?: string;
  similarartists?: { artist?: LastFmArtist | LastFmArtist[] };
};

type LastFmTagsResponse = {
  error?: number;
  message?: string;
  toptags?: { tag?: LastFmTag | LastFmTag[] };
};

function lastFmApiKey(): string {
  return process.env.LASTFM_API_KEY?.trim() ?? "";
}

export function isLastFmConfigured(): boolean {
  return Boolean(lastFmApiKey());
}

function asList<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function dedupeArtistNames(artists: string[], excludeArtist: string, limit: number): string[] {
  const exclude = normalizeArtistName(excludeArtist);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const artist of artists) {
    const name = artist.trim();
    if (!name) continue;
    const norm = normalizeArtistName(name);
    if (!norm || norm === exclude || seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
    if (out.length >= limit) break;
  }

  return out;
}

async function lastFmGet<T>(params: Record<string, string>): Promise<T | null> {
  const apiKey = lastFmApiKey();
  if (!apiKey) return null;

  const search = new URLSearchParams({
    ...params,
    api_key: apiKey,
    format: "json",
  });

  try {
    const res = await fetch(`${LASTFM_ENDPOINT}?${search.toString()}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (error) {
    console.warn("[lastfm] request failed:", error);
    return null;
  }
}

/** Similar artists for recommendation-pool widening. */
export async function fetchLastFmSimilarArtists(
  artistName: string,
  limit = 8,
): Promise<string[]> {
  const artist = artistName.trim();
  if (!artist || !isLastFmConfigured()) return [];

  const data = await lastFmGet<LastFmSimilarResponse>({
    method: "artist.getsimilar",
    artist,
    limit: String(Math.min(Math.max(limit * 2, 4), 20)),
    autocorrect: "1",
  });
  if (!data || data.error) {
    if (data?.error) {
      console.warn("[lastfm] artist.getsimilar:", data.message ?? data.error);
    }
    return [];
  }

  return dedupeArtistNames(
    asList(data.similarartists?.artist).map((item) => item.name ?? ""),
    artist,
    limit,
  );
}

/** Acoustic / folksonomy tags for an artist (genre, era, mood). */
export async function fetchLastFmArtistTags(
  artistName: string,
  limit = 8,
): Promise<string[]> {
  const artist = artistName.trim();
  if (!artist || !isLastFmConfigured()) return [];

  const data = await lastFmGet<LastFmTagsResponse>({
    method: "artist.gettoptags",
    artist,
    autocorrect: "1",
  });
  if (!data || data.error) return [];

  const tags = asList(data.toptags?.tag)
    .map((tag) => tag.name?.trim() ?? "")
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}
