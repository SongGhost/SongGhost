/**
 * Lightweight Last.fm client — artist similarity, folksonomy tags, and
 * play-count-ranked top tracks used to widen statutory recommendation /
 * station-track pools and to pick "great songs" for Song Radio.
 */

import { normalizeArtistName } from "@/lib/track-quality";

const LASTFM_ENDPOINT = "https://ws.audioscrobbler.com/2.0/";

type LastFmArtist = { name?: string; match?: string | number };
type LastFmTag = { name?: string; count?: number };
type LastFmTrack = {
  name?: string;
  playcount?: string | number;
  artist?: { name?: string };
};

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

type LastFmTopTracksResponse = {
  error?: number;
  message?: string;
  toptracks?: { track?: LastFmTrack | LastFmTrack[] };
};

export type LastFmTopTrack = {
  title: string;
  playcount: number;
};

export type LastFmSimilarArtistScored = {
  name: string;
  match: number;
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

function normalizeTrackTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * Keep tracks whose play count is at least `ratioThreshold` of the artist's
 * #1 song. Always keeps the top track (ratio 1.0). Ranked by play count desc.
 */
export function filterGreatSongs(
  tracks: readonly LastFmTopTrack[],
  ratioThreshold = 0.2,
): LastFmTopTrack[] {
  if (!tracks.length) return [];

  const ranked = [...tracks].sort((a, b) => b.playcount - a.playcount);
  const topPlaycount = ranked[0]?.playcount ?? 0;
  const cutoff = ratioThreshold * topPlaycount;

  return ranked.filter((track, index) => index === 0 || track.playcount >= cutoff);
}

/** Play-count-ranked top tracks for an artist (`artist.gettoptracks`). */
export async function fetchLastFmTopTracks(
  artistName: string,
  limit = 30,
): Promise<LastFmTopTrack[]> {
  const artist = artistName.trim();
  if (!artist || !isLastFmConfigured()) return [];

  const data = await lastFmGet<LastFmTopTracksResponse>({
    method: "artist.gettoptracks",
    artist,
    limit: String(Math.min(Math.max(limit, 1), 50)),
    autocorrect: "1",
  });
  if (!data || data.error) {
    if (data?.error) {
      console.warn("[lastfm] artist.gettoptracks:", data.message ?? data.error);
    }
    return [];
  }

  const seen = new Set<string>();
  const out: LastFmTopTrack[] = [];
  for (const item of asList(data.toptracks?.track)) {
    const title = item.name?.trim() ?? "";
    if (!title) continue;
    const playcount = Number(item.playcount ?? 0);
    if (!Number.isFinite(playcount)) continue;

    const trackArtist = item.artist?.name?.trim() || artist;
    const key = `${normalizeArtistName(trackArtist)}::${normalizeTrackTitle(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, playcount });
    if (out.length >= limit) break;
  }
  return out;
}

/** Similar artists with Last.fm match scores (0–1). */
export async function fetchLastFmSimilarArtistsScored(
  artistName: string,
  limit = 12,
): Promise<LastFmSimilarArtistScored[]> {
  const artist = artistName.trim();
  if (!artist || !isLastFmConfigured()) return [];

  const data = await lastFmGet<LastFmSimilarResponse>({
    method: "artist.getsimilar",
    artist,
    limit: String(Math.min(Math.max(limit * 2, 4), 50)),
    autocorrect: "1",
  });
  if (!data || data.error) {
    if (data?.error) {
      console.warn("[lastfm] artist.getsimilar:", data.message ?? data.error);
    }
    return [];
  }

  const exclude = normalizeArtistName(artist);
  const seen = new Set<string>();
  const out: LastFmSimilarArtistScored[] = [];

  for (const item of asList(data.similarartists?.artist)) {
    const name = item.name?.trim() ?? "";
    if (!name) continue;
    const norm = normalizeArtistName(name);
    if (!norm || norm === exclude || seen.has(norm)) continue;

    const match = Number(item.match ?? 0);
    if (!Number.isFinite(match)) continue;

    seen.add(norm);
    out.push({ name, match });
    if (out.length >= limit) break;
  }

  return out;
}

/** Similar artists for recommendation-pool widening. */
export async function fetchLastFmSimilarArtists(
  artistName: string,
  limit = 8,
): Promise<string[]> {
  const scored = await fetchLastFmSimilarArtistsScored(artistName, limit);
  return scored.map((item) => item.name);
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
