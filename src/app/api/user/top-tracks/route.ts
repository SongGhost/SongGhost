import { NextResponse } from "next/server";
import type { StationTrack } from "@/data/stations";
import {
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  type ITunesSong,
} from "@/lib/itunes";
import {
  buildHeavyRotationResult,
  HEAVY_ROTATION_TRACK_COUNT,
  type HeavyRotationArtist,
} from "@/lib/heavy-rotation";
import { resolveInPool } from "@/lib/resolve-pool";
import { pickSpotifyArtwork, type SpotifyImage } from "@/lib/spotify/app-auth";
import { isAcceptableArtistRadioTrack } from "@/lib/track-quality";
import { resolveTrackVideoId } from "@/lib/youtube-search";

export const dynamic = "force-dynamic";

type SpotifyArtistRef = { name?: string; id?: string };
type SpotifyAlbumRef = {
  name?: string;
  images?: SpotifyImage[];
  release_date?: string;
};
type SpotifyTrackItem = {
  id?: string;
  name?: string;
  duration_ms?: number;
  preview_url?: string | null;
  artists?: SpotifyArtistRef[];
  album?: SpotifyAlbumRef;
};
type SpotifyArtistItem = {
  id?: string;
  name?: string;
  images?: SpotifyImage[];
  genres?: string[];
};

type CatalogCandidate = {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  previewUrl?: string;
  releaseYear?: number;
  spotifyId?: string;
};

const VALID_TIME_RANGES = new Set(["short_term", "medium_term", "long_term"]);

function releaseYearFromDate(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : undefined;
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim();
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function spotifyTrackToCandidate(item: SpotifyTrackItem): CatalogCandidate | null {
  const title = item.name?.trim();
  const artist = item.artists
    ?.map((a) => a.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(", ");
  if (!title || !artist || !item.id) return null;

  const candidate: CatalogCandidate = {
    title,
    artist,
    spotifyId: item.id,
  };

  const album = item.album?.name?.trim();
  if (album) candidate.album = album;

  if (typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms)) {
    candidate.durationMs = item.duration_ms;
  }

  const previewUrl = item.preview_url?.trim();
  if (previewUrl) candidate.previewUrl = previewUrl;

  const year = releaseYearFromDate(item.album?.release_date);
  if (year) candidate.releaseYear = year;

  return candidate;
}

function mapTopArtist(item: SpotifyArtistItem): HeavyRotationArtist | null {
  const id = item.id?.trim();
  const name = item.name?.trim();
  if (!id || !name) return null;

  const artist: HeavyRotationArtist = { id, name };
  const imageUrl = pickSpotifyArtwork(item.images);
  if (imageUrl) artist.imageUrl = imageUrl;

  const genres = (item.genres ?? [])
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (genres.length) artist.genres = genres;

  return artist;
}

async function fetchJson<T>(
  url: string,
  token: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

/**
 * When `/me/top/tracks` is empty, pull each top artist's Spotify top tracks and
 * interleave them so the station still reflects listening history.
 */
async function fetchArtistTopTrackCandidates(
  token: string,
  artists: HeavyRotationArtist[],
  limit: number,
): Promise<CatalogCandidate[]> {
  const perArtist = Math.max(3, Math.ceil(limit / Math.max(artists.length, 1)));
  const pools = await Promise.all(
    artists.map(async (artist) => {
      const result = await fetchJson<{ tracks?: SpotifyTrackItem[] }>(
        `https://api.spotify.com/v1/artists/${encodeURIComponent(artist.id)}/top-tracks?market=US`,
        token,
      );
      if (!result.ok) return [] as CatalogCandidate[];
      return (result.data.tracks ?? [])
        .map(spotifyTrackToCandidate)
        .filter((c): c is CatalogCandidate => Boolean(c))
        .slice(0, perArtist);
    }),
  );

  const out: CatalogCandidate[] = [];
  const seen = new Set<string>();
  let index = 0;
  let remaining = true;
  while (remaining && out.length < limit) {
    remaining = false;
    for (const pool of pools) {
      const candidate = pool[index];
      if (!candidate) continue;
      remaining = true;
      const key = candidate.spotifyId ?? `${candidate.artist}::${candidate.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
      if (out.length >= limit) break;
    }
    index += 1;
  }
  return out;
}

async function resolveCandidate(
  candidate: CatalogCandidate,
  seen: Set<string>,
): Promise<StationTrack | null> {
  if (
    !isAcceptableArtistRadioTrack(candidate.title, {
      durationMs: candidate.durationMs,
    })
  ) {
    return null;
  }

  const youtubeId = await resolveTrackVideoId(
    candidate.artist,
    candidate.title,
    undefined,
    candidate.durationMs != null ? candidate.durationMs / 1000 : undefined,
  );

  const asITunes: ITunesSong = {
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.album,
    previewUrl: candidate.previewUrl,
    durationMs: candidate.durationMs,
    releaseYear: candidate.releaseYear,
  };

  let track: StationTrack | null = null;
  if (youtubeId && !seen.has(youtubeId)) {
    track = itunesSongToStationTrack(asITunes, youtubeId);
  } else {
    track = itunesPreviewToStationTrack(asITunes);
  }

  if (!track) return null;

  const key =
    track.youtubeId ||
    `preview:${candidate.spotifyId ?? `${track.artist}::${track.title}`}`;
  if (seen.has(key)) return null;
  seen.add(key);

  if (candidate.spotifyId) {
    return { ...track, spotifyId: candidate.spotifyId };
  }
  return track;
}

/**
 * GET /api/user/top-tracks
 *
 * Requires a Spotify user access token (`Authorization: Bearer …`) with
 * `user-top-read`. Fetches the listener's top artists and builds a playable
 * Heavy Rotation station from their top listening history.
 */
export async function GET(request: Request) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "Authorization Bearer token required" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawRange = searchParams.get("time_range")?.trim() ?? "medium_term";
  const timeRange = VALID_TIME_RANGES.has(rawRange) ? rawRange : "medium_term";
  const artistLimit = Math.min(
    5,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "5", 10) || 5),
  );

  try {
    const artistsResult = await fetchJson<{ items?: SpotifyArtistItem[] }>(
      `https://api.spotify.com/v1/me/top/artists?limit=${artistLimit}&time_range=${timeRange}`,
      token,
    );

    if (!artistsResult.ok) {
      const status = artistsResult.status === 401 || artistsResult.status === 403
        ? artistsResult.status
        : 502;
      return NextResponse.json(
        {
          error:
            artistsResult.status === 403
              ? "Spotify scope user-top-read required — reconnect Spotify"
              : "Failed to fetch Spotify top artists",
          status: artistsResult.status,
        },
        { status },
      );
    }

    const artists = (artistsResult.data.items ?? [])
      .map(mapTopArtist)
      .filter((a): a is HeavyRotationArtist => Boolean(a));

    if (!artists.length) {
      return NextResponse.json(
        { error: "No top artists yet — listen on Spotify a bit, then try again" },
        { status: 404 },
      );
    }

    const topTracksResult = await fetchJson<{ items?: SpotifyTrackItem[] }>(
      `https://api.spotify.com/v1/me/top/tracks?limit=${HEAVY_ROTATION_TRACK_COUNT}&time_range=${timeRange}`,
      token,
    );

    let candidates: CatalogCandidate[] = [];
    if (topTracksResult.ok) {
      candidates = (topTracksResult.data.items ?? [])
        .map(spotifyTrackToCandidate)
        .filter((c): c is CatalogCandidate => Boolean(c));
    }

    if (!candidates.length) {
      candidates = await fetchArtistTopTrackCandidates(
        token,
        artists,
        HEAVY_ROTATION_TRACK_COUNT,
      );
    }

    if (!candidates.length) {
      return NextResponse.json(
        { error: "Could not build a Heavy Rotation queue from your listening history" },
        { status: 404 },
      );
    }

    const seen = new Set<string>();
    const tracks = await resolveInPool(
      candidates,
      (candidate) => resolveCandidate(candidate, seen),
      { concurrency: 8, limit: HEAVY_ROTATION_TRACK_COUNT },
    );

    if (!tracks.length) {
      return NextResponse.json(
        { error: "Could not resolve playable tracks for Your Heavy Rotation" },
        { status: 404 },
      );
    }

    const result = buildHeavyRotationResult(artists, tracks);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/user/top-tracks] Failed:", err);
    return NextResponse.json(
      {
        error: "Heavy Rotation fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
