import { NextResponse } from "next/server";
import type { StationTrack } from "@/data/stations";
import { parseFailedYoutubeIdsParam } from "@/lib/failed-youtube-ids";
import {
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  searchITunesSongs,
  searchSongsByArtistStrict,
  type ITunesSong,
} from "@/lib/itunes";
import { resolveInPool } from "@/lib/resolve-pool";
import {
  buildSongRadioResult,
  findLibrarySongRadioTracks,
  SONG_RADIO_RECOMMENDATION_COUNT,
} from "@/lib/song-radio";
import { getSpotifyAppToken, type SpotifyImage } from "@/lib/spotify/app-auth";
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

type CatalogCandidate = {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  previewUrl?: string;
  releaseYear?: number;
  spotifyId?: string;
};

function releaseYearFromDate(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : undefined;
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

async function fetchSpotifyRecommendations(
  token: string,
  seedTrackId: string,
  limit: number,
): Promise<CatalogCandidate[]> {
  const params = new URLSearchParams({
    seed_tracks: seedTrackId,
    limit: String(limit),
  });

  const res = await fetch(
    `https://api.spotify.com/v1/recommendations?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    },
  );

  if (!res.ok) {
    console.warn("[api/song-radio] Spotify recommendations failed:", res.status);
    return [];
  }

  const data = (await res.json()) as { tracks?: SpotifyTrackItem[] };
  const out: CatalogCandidate[] = [];
  for (const item of data.tracks ?? []) {
    const candidate = spotifyTrackToCandidate(item);
    if (candidate) out.push(candidate);
  }
  return out;
}

/**
 * When recommendations are unavailable, pull the seed artist's catalog tracks
 * as a matching-radio substitute (still places the seed at index 0).
 */
async function fetchArtistFallbackCandidates(
  artist: string,
  seedTitle: string,
  limit: number,
): Promise<CatalogCandidate[]> {
  const songs = await searchSongsByArtistStrict(artist, limit + 4);
  const seedLower = seedTitle.toLowerCase();
  return songs
    .filter((song) =>
      isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs }),
    )
    .filter((song) => song.title.toLowerCase() !== seedLower)
    .slice(0, limit)
    .map((song) => ({
      title: song.title,
      artist: song.artist,
      album: song.album,
      durationMs: song.durationMs,
      previewUrl: song.previewUrl,
      releaseYear: song.releaseYear,
    }));
}

async function resolveCandidate(
  candidate: CatalogCandidate,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
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
    excludeYoutubeIds,
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
    return {
      ...track,
      spotifyId: candidate.spotifyId,
    };
  }

  return track;
}

/**
 * GET /api/song-radio?spotifyTrackId=…&title=…&artist=…
 *
 * Builds a seeded Song Radio queue: requested track at index 0, then up to 15
 * Spotify recommendations (artist/iTunes fallback when APIs fail).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim() ?? "";
  const artist = searchParams.get("artist")?.trim() ?? "";
  const spotifyTrackId = searchParams.get("spotifyTrackId")?.trim() ?? "";
  const excludeYoutubeIds = parseFailedYoutubeIdsParam(
    searchParams.get("excludeYoutubeIds"),
  );

  if (!title || !artist) {
    return NextResponse.json(
      { error: "title and artist are required" },
      { status: 400 },
    );
  }

  try {
    const token = await getSpotifyAppToken();

    const seedCandidate: CatalogCandidate = {
      title,
      artist,
      spotifyId: spotifyTrackId || undefined,
    };

    // Prefer a fresher Spotify catalog row for the seed when we have an id.
    if (token && spotifyTrackId) {
      const seedRes = await fetch(
        `https://api.spotify.com/v1/tracks/${encodeURIComponent(spotifyTrackId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 0 },
        },
      );
      if (seedRes.ok) {
        const seedJson = (await seedRes.json()) as SpotifyTrackItem;
        const mapped = spotifyTrackToCandidate(seedJson);
        if (mapped) {
          seedCandidate.album = mapped.album;
          seedCandidate.durationMs = mapped.durationMs;
          seedCandidate.previewUrl = mapped.previewUrl;
          seedCandidate.releaseYear = mapped.releaseYear;
          seedCandidate.spotifyId = mapped.spotifyId;
        }
      }
    } else if (!spotifyTrackId) {
      // Best-effort iTunes metadata for duration / preview when no Spotify id.
      const hits = await searchITunesSongs(`${artist} ${title}`, 5);
      const match = hits.find(
        (song) =>
          song.title.toLowerCase() === title.toLowerCase() &&
          song.artist.toLowerCase().includes(artist.toLowerCase().slice(0, 12)),
      );
      if (match) {
        seedCandidate.album = match.album;
        seedCandidate.durationMs = match.durationMs;
        seedCandidate.previewUrl = match.previewUrl;
        seedCandidate.releaseYear = match.releaseYear;
      }
    }

    let recommended: CatalogCandidate[] = [];
    if (token && (seedCandidate.spotifyId || spotifyTrackId)) {
      recommended = await fetchSpotifyRecommendations(
        token,
        seedCandidate.spotifyId || spotifyTrackId,
        SONG_RADIO_RECOMMENDATION_COUNT,
      );
    }

    if (!recommended.length) {
      recommended = await fetchArtistFallbackCandidates(
        artist,
        title,
        SONG_RADIO_RECOMMENDATION_COUNT,
      );
    }

    const seen = new Set<string>();
    const seedTrack = await resolveCandidate(seedCandidate, seen, excludeYoutubeIds);

    const resolvedRecommended = await resolveInPool(
      recommended,
      (candidate) => resolveCandidate(candidate, seen, excludeYoutubeIds),
      { concurrency: 8, limit: SONG_RADIO_RECOMMENDATION_COUNT },
    );

    let tracks: StationTrack[] = [];
    if (seedTrack) {
      tracks = [seedTrack, ...resolvedRecommended];
    } else if (resolvedRecommended.length) {
      tracks = resolvedRecommended;
    } else {
      tracks = findLibrarySongRadioTracks(title, artist);
    }

    if (!tracks.length) {
      return NextResponse.json(
        { error: `Could not build Song Radio for "${title}" by ${artist}` },
        { status: 404 },
      );
    }

    // Invariant: requested seed stays at index 0 when we resolved it.
    if (
      seedTrack &&
      (tracks[0]?.title !== seedTrack.title || tracks[0]?.artist !== seedTrack.artist)
    ) {
      tracks = [seedTrack, ...tracks.filter((t) => t !== seedTrack)];
    }

    const result = buildSongRadioResult(
      title,
      artist,
      tracks,
      seedCandidate.spotifyId || spotifyTrackId || undefined,
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/song-radio] Failed:", err);
    return NextResponse.json(
      {
        error: "Song Radio launch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
