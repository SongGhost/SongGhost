import { NextResponse } from "next/server";
import {
  itunesTrackMatchesQuery,
  searchITunesAlbums,
  searchITunesArtistsDetailed,
  searchITunesSongs,
} from "@/lib/itunes";
import {
  getSpotifyAppToken,
  pickSpotifyArtwork,
  type SpotifyImage,
} from "@/lib/spotify/app-auth";
import { fetchSpotifyGetWithRetry } from "@/lib/spotify/fetchWithRetry";
import type {
  SearchAlbumResult,
  SearchArtistResult,
  SearchEntityType,
  SearchTrackResult,
  SmartSearchResponse,
} from "@/types/studio-search";

export const dynamic = "force-dynamic";

export type { SearchTrackResult, SearchArtistResult, SearchAlbumResult, SmartSearchResponse };

type SpotifyArtistRef = { name?: string; id?: string };
type SpotifyAlbumRef = {
  name?: string;
  images?: SpotifyImage[];
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
type SpotifyAlbumItem = {
  id?: string;
  name?: string;
  images?: SpotifyImage[];
  release_date?: string;
  total_tracks?: number;
  artists?: SpotifyArtistRef[];
};

type SpotifySearchResponse = {
  tracks?: { items?: SpotifyTrackItem[] };
  artists?: { items?: SpotifyArtistItem[] };
  albums?: { items?: SpotifyAlbumItem[] };
};

const ALL_TYPES: SearchEntityType[] = ["track", "artist", "album"];

function parseTypes(raw: string | null): SearchEntityType[] {
  if (!raw?.trim()) return ALL_TYPES;
  const parts = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const mapped: SearchEntityType[] = [];
  for (const part of parts) {
    if (part === "track" || part === "tracks") mapped.push("track");
    else if (part === "artist" || part === "artists") mapped.push("artist");
    else if (part === "album" || part === "albums") mapped.push("album");
  }

  return mapped.length ? [...new Set(mapped)] : ALL_TYPES;
}

function releaseYearFromDate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : null;
}

function mapSpotifyTracks(
  items: SpotifyTrackItem[] | undefined,
  q: string,
): SearchTrackResult[] {
  const tracks: SearchTrackResult[] = [];
  for (const item of items ?? []) {
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

    const artworkUrl = pickSpotifyArtwork(item.album?.images);
    if (artworkUrl) track.artworkUrl = artworkUrl;

    if (typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms)) {
      track.durationSec = Math.round(item.duration_ms / 1000);
    }

    const previewUrl = item.preview_url?.trim();
    if (previewUrl && itunesTrackMatchesQuery(track, q)) {
      track.previewUrl = previewUrl;
    }

    tracks.push(track);
  }
  return tracks;
}

function mapSpotifyArtists(items: SpotifyArtistItem[] | undefined): SearchArtistResult[] {
  const artists: SearchArtistResult[] = [];
  for (const item of items ?? []) {
    const name = item.name?.trim();
    if (!name || !item.id) continue;

    const artist: SearchArtistResult = {
      id: `spotify-artist:${item.id}`,
      name,
      spotifyId: item.id,
    };

    const imageUrl = pickSpotifyArtwork(item.images);
    if (imageUrl) artist.imageUrl = imageUrl;

    const genres = (item.genres ?? [])
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (genres.length) artist.genres = genres;

    artists.push(artist);
  }
  return artists;
}

function mapSpotifyAlbums(items: SpotifyAlbumItem[] | undefined): SearchAlbumResult[] {
  const albums: SearchAlbumResult[] = [];
  for (const item of items ?? []) {
    const title = item.name?.trim();
    const artist = item.artists
      ?.map((a) => a.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ");
    if (!title || !artist || !item.id) continue;

    const album: SearchAlbumResult = {
      id: `spotify-album:${item.id}`,
      title,
      artist,
      spotifyId: item.id,
      releaseYear: releaseYearFromDate(item.release_date),
      trackCount:
        typeof item.total_tracks === "number" && Number.isFinite(item.total_tracks)
          ? item.total_tracks
          : null,
    };

    const artworkUrl = pickSpotifyArtwork(item.images);
    if (artworkUrl) album.artworkUrl = artworkUrl;

    albums.push(album);
  }
  return albums;
}

async function searchSpotifyMulti(
  q: string,
  types: SearchEntityType[],
  limit: number,
): Promise<SmartSearchResponse | null> {
  const token = await getSpotifyAppToken();
  if (!token) return null;

  const params = new URLSearchParams({
    q,
    type: types.join(","),
    limit: String(limit),
  });

  const res = await fetchSpotifyGetWithRetry(
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
  const wantsTrack = types.includes("track");
  const wantsArtist = types.includes("artist");
  const wantsAlbum = types.includes("album");

  return {
    tracks: wantsTrack ? mapSpotifyTracks(data.tracks?.items, q) : [],
    artists: wantsArtist ? mapSpotifyArtists(data.artists?.items) : [],
    albums: wantsAlbum ? mapSpotifyAlbums(data.albums?.items) : [],
    source: "spotify",
  };
}

/**
 * iTunes fallback when Spotify app credentials are unavailable.
 */
async function searchITunesFallback(
  q: string,
  types: SearchEntityType[],
  limit: number,
): Promise<SmartSearchResponse> {
  const wantsTrack = types.includes("track");
  const wantsArtist = types.includes("artist");
  const wantsAlbum = types.includes("album");

  const [songs, artists, albums] = await Promise.all([
    wantsTrack ? searchITunesSongs(q, limit) : Promise.resolve([]),
    wantsArtist ? searchITunesArtistsDetailed(q, limit) : Promise.resolve([]),
    wantsAlbum ? searchITunesAlbums(q, limit) : Promise.resolve([]),
  ]);

  const tracks: SearchTrackResult[] = songs.map((song, index) => {
    const id = song.trackId
      ? `itunes:${song.trackId}`
      : `itunes:${song.artist}::${song.title}::${index}`;

    const track: SearchTrackResult = {
      id,
      title: song.title,
      artist: song.artist,
    };

    if (song.album) track.album = song.album;
    if (typeof song.durationMs === "number") {
      track.durationSec = Math.round(song.durationMs / 1000);
    }
    if (song.previewUrl && itunesTrackMatchesQuery(track, q)) {
      track.previewUrl = song.previewUrl;
    }

    return track;
  });

  const artistResults: SearchArtistResult[] = artists.map((artist, index) => ({
    id: artist.artistId
      ? `itunes-artist:${artist.artistId}`
      : `itunes-artist:${artist.name}::${index}`,
    name: artist.name,
  }));

  const albumResults: SearchAlbumResult[] = albums.map((album) => ({
    id: `itunes-album:${album.collectionId}`,
    title: album.albumTitle,
    artist: album.artist,
    artworkUrl: album.coverArtUrl,
    releaseYear: album.releaseYear ?? null,
    trackCount: album.trackCount ?? null,
  }));

  return {
    tracks,
    artists: artistResults,
    albums: albumResults,
    source: "itunes",
  };
}

/** Rank-0 is never a seed. Limit-1 track search returns only an equality hit. */
function gateTrackSeeds(
  payload: SmartSearchResponse,
  q: string,
  types: SearchEntityType[],
  limit: number,
): SmartSearchResponse {
  if (!types.includes("track")) return payload;

  const exact = payload.tracks.filter((track) => itunesTrackMatchesQuery(track, q));
  if (limit === 1) {
    return { ...payload, tracks: exact.slice(0, 1) };
  }
  if (!exact.length) return payload;

  const seen = new Set(exact.map((track) => track.id));
  return {
    ...payload,
    tracks: [...exact, ...payload.tracks.filter((track) => !seen.has(track.id))],
  };
}

/**
 * GET /api/search?q=…&type=track,artist,album
 * Multi-entity Spotify search (iTunes fallback) for Smart Search + Studio.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const types = parseTypes(searchParams.get("type"));
  const limitRaw = Number(searchParams.get("limit") ?? "8");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(25, Math.max(1, Math.floor(limitRaw)))
    : 8;

  if (q.length < 2) {
    return NextResponse.json({
      tracks: [],
      artists: [],
      albums: [],
    } satisfies SmartSearchResponse);
  }

  try {
    const spotify = await searchSpotifyMulti(q, types, limit);
    if (spotify) {
      return NextResponse.json(gateTrackSeeds(spotify, q, types, limit));
    }

    const itunes = await searchITunesFallback(q, types, limit);
    return NextResponse.json(gateTrackSeeds(itunes, q, types, limit));
  } catch (err) {
    console.error("[api/search] Search failed:", err);
    return NextResponse.json(
      {
        error: "Track search failed",
        detail: err instanceof Error ? err.message : String(err),
        tracks: [],
        artists: [],
        albums: [],
      },
      { status: 500 },
    );
  }
}
