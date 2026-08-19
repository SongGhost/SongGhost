import { NextResponse } from "next/server";
import type { StationTrack } from "@/data/stations";
import { parseFailedYoutubeIdsParam } from "@/lib/failed-youtube-ids";
import {
  itunesArtistsMatch,
  itunesSongToStationTrack,
  itunesTitlesMatch,
  lookupITunesSongById,
  lookupITunesTrack,
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
import {
  fetchSpotifyRecommendationPool,
  RECOMMENDATION_POOL_SIZE,
  type SpotifyRecommendationTrack,
} from "@/lib/spotify/recommendations";
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
  itunesTrackId?: number;
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

function recommendationToCandidate(
  track: SpotifyRecommendationTrack,
): CatalogCandidate {
  const year = releaseYearFromDate(track.releaseDate);
  return {
    title: track.name,
    artist: track.artists.join(", "),
    album: track.album,
    durationMs: track.durationMs,
    previewUrl: track.previewUrl,
    releaseYear: year,
    spotifyId: track.id,
  };
}

/**
 * Anti-repetition Song Radio pool: 50 Spotify candidates, exclude recent ids,
 * random target_popularity [45–85], Fisher–Yates shuffle (inside the helper),
 * then trim to the delivery count.
 */
async function fetchSongRadioRecommendations(
  seedTrackId: string,
  excludeIds: readonly string[],
): Promise<CatalogCandidate[]> {
  const pool = await fetchSpotifyRecommendationPool({
    seedTracks: [seedTrackId],
    excludeIds,
    limit: RECOMMENDATION_POOL_SIZE,
  });
  return pool
    .map(recommendationToCandidate)
    .slice(0, SONG_RADIO_RECOMMENDATION_COUNT);
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
      itunesTrackId: song.trackId,
    }));
}

function catalogPreviewUrl(
  candidate: CatalogCandidate,
  expected: { title: string; artist: string },
): string | undefined {
  const preview = candidate.previewUrl?.trim();
  if (!preview) return undefined;
  if (
    !itunesTitlesMatch(candidate.title, expected.title) ||
    !itunesArtistsMatch(candidate.artist, expected.artist)
  ) {
    return undefined;
  }
  return preview;
}

async function resolveCandidate(
  candidate: CatalogCandidate,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
  expectedIdentity?: { title: string; artist: string },
): Promise<StationTrack | null> {
  if (
    !isAcceptableArtistRadioTrack(candidate.title, {
      durationMs: candidate.durationMs,
    })
  ) {
    return null;
  }

  const identity = expectedIdentity ?? {
    title: candidate.title,
    artist: candidate.artist,
  };

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
    previewUrl: catalogPreviewUrl(candidate, identity),
    trackId: candidate.itunesTrackId,
    durationMs: candidate.durationMs,
    releaseYear: candidate.releaseYear,
  };

  let track: StationTrack | null = null;
  if (youtubeId && !seen.has(youtubeId)) {
    track = itunesSongToStationTrack(asITunes, youtubeId, identity);
  } else {
    track = itunesSongToStationTrack(asITunes, undefined, identity);
  }

  if (!track) return null;

  const key =
    track.youtubeId ||
    `preview:${candidate.itunesTrackId ?? candidate.spotifyId ?? `${track.artist}::${track.title}`}`;
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
  const itunesTrackIdRaw = Number(searchParams.get("itunesTrackId") ?? "");
  const itunesTrackId =
    Number.isFinite(itunesTrackIdRaw) && itunesTrackIdRaw > 0
      ? itunesTrackIdRaw
      : undefined;
  const excludeYoutubeIds = parseFailedYoutubeIdsParam(
    searchParams.get("excludeYoutubeIds"),
  );
  /** Session recentTrackIds — Spotify ids (and other keys) to keep out of the pool. */
  const recentTrackIds = (searchParams.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!title || !artist) {
    return NextResponse.json(
      { error: "title and artist are required" },
      { status: 400 },
    );
  }

  try {
    const token = await getSpotifyAppToken();

    const seedIdentity = { title, artist };
    const seedCandidate: CatalogCandidate = {
      title,
      artist,
      spotifyId: spotifyTrackId || undefined,
      itunesTrackId,
    };

    const attachSeedCatalog = (row: {
      album?: string;
      durationMs?: number;
      previewUrl?: string;
      releaseYear?: number;
      spotifyId?: string;
      itunesTrackId?: number;
      title: string;
      artist: string;
    }) => {
      if (
        !itunesTitlesMatch(row.title, title) ||
        !itunesArtistsMatch(row.artist, artist)
      ) {
        return;
      }
      seedCandidate.album = row.album;
      seedCandidate.durationMs = row.durationMs;
      seedCandidate.previewUrl = catalogPreviewUrl(row, seedIdentity);
      seedCandidate.releaseYear = row.releaseYear;
      if (row.spotifyId) seedCandidate.spotifyId = row.spotifyId;
      if (row.itunesTrackId) seedCandidate.itunesTrackId = row.itunesTrackId;
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
        if (mapped) attachSeedCatalog(mapped);
      }
    }

    if (!seedCandidate.previewUrl || !seedCandidate.itunesTrackId) {
      const pinned =
        (itunesTrackId
          ? await lookupITunesSongById(itunesTrackId, seedIdentity)
          : null) ?? (await lookupITunesTrack(artist, title));
      if (pinned) {
        attachSeedCatalog({
          title: pinned.title,
          artist: pinned.artist,
          album: pinned.album,
          durationMs: pinned.durationMs,
          previewUrl: pinned.previewUrl,
          releaseYear: pinned.releaseYear,
          itunesTrackId: pinned.trackId,
        });
      }
    }

    const seedSpotifyKey = seedCandidate.spotifyId || spotifyTrackId;
    const excludeIds = [
      ...recentTrackIds,
      ...(seedSpotifyKey ? [seedSpotifyKey] : []),
    ];

    let recommended: CatalogCandidate[] = [];
    if (token && seedSpotifyKey) {
      recommended = await fetchSongRadioRecommendations(
        seedSpotifyKey,
        excludeIds,
      );
    }

    if (!recommended.length) {
      recommended = await fetchArtistFallbackCandidates(
        artist,
        title,
        SONG_RADIO_RECOMMENDATION_COUNT,
      );
      // Client-side recent filter for the iTunes fallback path.
      if (recentTrackIds.length) {
        const banned = new Set(recentTrackIds);
        recommended = recommended.filter(
          (c) => !c.spotifyId || !banned.has(c.spotifyId),
        );
      }
    }

    const seen = new Set<string>();
    const seedTrack = await resolveCandidate(
      seedCandidate,
      seen,
      excludeYoutubeIds,
      seedIdentity,
    );

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
