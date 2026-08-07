import { NextResponse } from "next/server";
import { searchITunesSongs } from "@/lib/itunes";
import type { SearchTrackResult } from "@/types/studio-search";

export const dynamic = "force-dynamic";

export type { SearchTrackResult };

type SpotifyTokenCache = {
  accessToken: string;
  expiresAt: number;
};

let spotifyTokenCache: SpotifyTokenCache | null = null;

type SpotifyImage = { url?: string; height?: number; width?: number };
type SpotifyArtist = { name?: string };
type SpotifyAlbum = {
  name?: string;
  images?: SpotifyImage[];
};
type SpotifyTrackItem = {
  id?: string;
  name?: string;
  duration_ms?: number;
  preview_url?: string | null;
  artists?: SpotifyArtist[];
  album?: SpotifyAlbum;
};

type SpotifySearchResponse = {
  tracks?: {
    items?: SpotifyTrackItem[];
  };
};

function pickArtwork(images: SpotifyImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0),
  );
  // Prefer ~300px thumbnails for list rows.
  const mid =
    sorted.find((img) => (img.height ?? 0) >= 200 && (img.height ?? 0) <= 400) ??
    sorted[Math.min(1, sorted.length - 1)] ??
    sorted[0];
  return mid?.url?.trim() || undefined;
}

async function getSpotifyAppToken(): Promise<string | null> {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt - 30_000) {
    return spotifyTokenCache.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    console.warn("[api/search] Spotify token exchange failed:", res.status);
    return null;
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;

  spotifyTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function searchSpotifyTracks(
  q: string,
  limit: number,
): Promise<SearchTrackResult[] | null> {
  const token = await getSpotifyAppToken();
  if (!token) return null;

  const params = new URLSearchParams({
    q,
    type: "track",
    limit: String(limit),
  });

  const res = await fetch(
    `https://api.spotify.com/v1/search?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    },
  );

  if (!res.ok) {
    console.warn("[api/search] Spotify search failed:", res.status);
    return null;
  }

  const data = (await res.json()) as SpotifySearchResponse;
  const items = data.tracks?.items ?? [];
  const tracks: SearchTrackResult[] = [];

  for (const item of items) {
    const title = item.name?.trim();
    const artist = item.artists
      ?.map((a) => a.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ");
    if (!title || !artist || !item.id) continue;

    const track: SearchTrackResult = {
      id: `spotify:${item.id}`,
      title,
      artist,
      spotifyId: item.id,
    };

    const album = item.album?.name?.trim();
    if (album) track.album = album;

    const artworkUrl = pickArtwork(item.album?.images);
    if (artworkUrl) track.artworkUrl = artworkUrl;

    if (typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms)) {
      track.durationSec = Math.round(item.duration_ms / 1000);
    }

    const previewUrl = item.preview_url?.trim();
    if (previewUrl) track.previewUrl = previewUrl;

    tracks.push(track);
  }

  return tracks;
}

/**
 * iTunes fallback when Spotify app credentials are unavailable.
 * Artwork is derived from collection artwork when present on the song payload.
 */
async function searchITunesFallback(
  q: string,
  limit: number,
): Promise<SearchTrackResult[]> {
  const songs = await searchITunesSongs(q, limit);
  return songs.map((song, index) => {
    const id = song.trackId
      ? `itunes:${song.trackId}`
      : `itunes:${song.artist}::${song.title}::${index}`;

    const track: SearchTrackResult = {
      id,
      title: song.title,
      artist: song.artist,
    };

    if (song.album) track.album = song.album;
    if (song.previewUrl) track.previewUrl = song.previewUrl;
    if (typeof song.durationMs === "number") {
      track.durationSec = Math.round(song.durationMs / 1000);
    }

    return track;
  });
}

/**
 * GET /api/search?q=… — Spotify track search for Studio sequence builder.
 * Falls back to iTunes when Spotify client credentials are not configured.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const limitRaw = Number(searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(25, Math.max(1, Math.floor(limitRaw)))
    : 10;

  if (q.length < 2) {
    return NextResponse.json({ tracks: [] as SearchTrackResult[] });
  }

  try {
    const spotify = await searchSpotifyTracks(q, limit);
    if (spotify) {
      return NextResponse.json({ tracks: spotify, source: "spotify" as const });
    }

    const itunes = await searchITunesFallback(q, limit);
    return NextResponse.json({ tracks: itunes, source: "itunes" as const });
  } catch (err) {
    console.error("[api/search] Search failed:", err);
    return NextResponse.json(
      {
        error: "Track search failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
