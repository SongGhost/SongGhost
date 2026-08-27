import { NextResponse } from "next/server";
import type { StationTrack } from "@/data/stations";
import {
  fetchLastFmTopTracks,
  filterGreatSongs,
} from "@/lib/catalog/lastfm";
import { parseFailedYoutubeIdsParam } from "@/lib/failed-youtube-ids";
import {
  itunesArtistsMatch,
  itunesSongToStationTrack,
  itunesTitlesMatch,
  lookupITunesSongById,
  lookupITunesTrack,
  type ITunesSong,
} from "@/lib/itunes";
import { applyArtistCap } from "@/lib/queue/builder";
import { primaryArtistName } from "@/lib/queue/statutory-rules";
import { resolveInPool } from "@/lib/resolve-pool";
import { fetchSimilarArtistsScored } from "@/lib/similar-artists";
import {
  buildSongRadioResult,
  SONG_RADIO_RECOMMENDATION_COUNT,
} from "@/lib/song-radio";
import { getSpotifyAppToken, type SpotifyImage } from "@/lib/spotify/app-auth";
import {
  fetchSpotifyRecommendationPool,
  RECOMMENDATION_POOL_SIZE,
  type SpotifyRecommendationTrack,
} from "@/lib/spotify/recommendations";
import { shuffle } from "@/lib/station/catalog-builder";
import { isAcceptableArtistRadioTrack } from "@/lib/track-quality";
import { normalizeArtistKey } from "@/lib/user/feedback";
import { catalogDurationFromMs, resolveTrackVideoId } from "@/lib/youtube-search";

export const dynamic = "force-dynamic";

/** Delivery target after resolving the ~30-candidate pull. */
const SONG_RADIO_DELIVERY_COUNT = 25;
const SEED_ARTIST_CAP = 6;
const OTHER_ARTIST_CAP = 2;
const SEED_ARTIST_EXTRA_PICKS = 4;
const SIMILAR_ARTIST_FETCH_LIMIT = 12;
const SIMILAR_ARTIST_MATCH_THRESHOLD = 0.4;
const GREAT_SONGS_THIN_POOL = 4;

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

function titlesMatchSeed(title: string, seedTitle: string): boolean {
  return title.toLowerCase() === seedTitle.toLowerCase();
}

function pickGreatSongCandidates(
  tracks: { title: string; playcount: number }[],
  artist: string,
  seedTitle: string,
  pickCount: number,
): CatalogCandidate[] {
  const out: CatalogCandidate[] = [];
  for (const track of shuffle(tracks)) {
    if (titlesMatchSeed(track.title, seedTitle)) continue;
    out.push({ title: track.title, artist });
    if (out.length >= pickCount) break;
  }
  return out;
}

/**
 * Seed-artist great songs (Last.fm play-count ranked, 20% cutoff), shuffled
 * per build. Up to 4 extras excluding the searched title.
 */
async function fetchSeedArtistCandidates(
  seedArtist: string,
  seedTitle: string,
): Promise<CatalogCandidate[]> {
  const top = await fetchLastFmTopTracks(seedArtist, 30);
  const great = filterGreatSongs(top);
  return pickGreatSongCandidates(great, seedArtist, seedTitle, SEED_ARTIST_EXTRA_PICKS);
}

/**
 * Similar-artist great songs. Match-score filter lives in
 * `fetchSimilarArtistsScored`. Thin catalogs (< 4 great songs) contribute 1
 * track; everyone else contributes 2. Never include the seed artist.
 */
async function fetchSimilarArtistCandidates(
  seedArtist: string,
  seedTitle: string,
): Promise<CatalogCandidate[]> {
  const similarArtists = await fetchSimilarArtistsScored(
    seedArtist,
    SIMILAR_ARTIST_FETCH_LIMIT,
    SIMILAR_ARTIST_MATCH_THRESHOLD,
  );
  // TEMP T34-diag: see how many similar artists pass the 0.4 match filter.
  console.log("[song-radio-diag] similarArtists passed match>=", SIMILAR_ARTIST_MATCH_THRESHOLD, "=", similarArtists.length, similarArtists.map((a) => `${a.name}:${a.match ?? "?"}`).join(" | "));
  if (!similarArtists.length) return [];

  const seedKey = normalizeArtistKey(primaryArtistName(seedArtist));
  const pools = await Promise.all(
    similarArtists.map(async ({ name: related }) => {
      if (normalizeArtistKey(primaryArtistName(related)) === seedKey) return [];
      const top = await fetchLastFmTopTracks(related, 30);
      const great = filterGreatSongs(top);
      // TEMP T34-diag: per-artist great-song pool size.
      console.log("[song-radio-diag]   ", related, "greatSongs=", great.length, "top=", top.length);
      const pickCount = great.length < GREAT_SONGS_THIN_POOL ? 1 : 2;
      return pickGreatSongCandidates(great, related, seedTitle, pickCount);
    }),
  );
  return pools.flat();
}

/**
 * Song Radio artist-frequency pass: seed artist may appear up to 6 times so
 * the searched act stays anchored; every other act stays at 2. Walks in order
 * so index 0 (the searched song) is never dropped.
 */
function applySongRadioArtistCap<T extends { artist?: string }>(
  tracks: readonly T[],
  seedArtist: string,
): T[] {
  const seedKey = normalizeArtistKey(primaryArtistName(seedArtist));
  const counts = new Map<string, number>();
  const accepted: T[] = [];

  for (const track of tracks) {
    const key = normalizeArtistKey(primaryArtistName(track.artist));
    if (!key) {
      accepted.push(track);
      continue;
    }
    const cap = seedKey && key === seedKey ? SEED_ARTIST_CAP : OTHER_ARTIST_CAP;
    const seen = counts.get(key) ?? 0;
    if (seen >= cap) continue;
    counts.set(key, seen + 1);
    accepted.push(track);
  }

  return accepted;
}

/** Round-robin similar-artist rows ahead of same-pool recs so the tail is not stacked. */
function interleaveAfterSeed(
  spotify: readonly CatalogCandidate[],
  similar: readonly CatalogCandidate[],
): CatalogCandidate[] {
  if (!similar.length) return [...spotify];
  if (!spotify.length) return [...similar];
  const out: CatalogCandidate[] = [];
  const max = Math.max(spotify.length, similar.length);
  for (let i = 0; i < max; i++) {
    const related = similar[i];
    if (related) out.push(related);
    const rec = spotify[i];
    if (rec) out.push(rec);
  }
  return out;
}

function uniquePrimaryArtists(
  tracks: readonly { artist?: string }[],
): Set<string> {
  const names = new Set<string>();
  for (const track of tracks) {
    const name = primaryArtistName(track.artist).toLowerCase();
    if (name) names.add(name);
  }
  return names;
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

type ResolveTransport = {
  youtubeFallback: boolean;
  excludeYoutubeIds: ReadonlySet<string>;
};

async function resolveCandidate(
  candidate: CatalogCandidate,
  seen: Set<string>,
  expectedIdentity?: { title: string; artist: string },
  transport: ResolveTransport = {
    youtubeFallback: false,
    excludeYoutubeIds: new Set(),
  },
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

  // Production Pocket Mode: never stamp a YouTube video ID. Resolve an HTTP
  // preview from Spotify `preview_url` or iTunes, then drop the row if neither
  // streamUrl nor previewUrl is present. Dev `youtubeFallback` is the only
  // path that may call `resolveTrackVideoId` for full-length iframe testing.
  let previewUrl = catalogPreviewUrl(candidate, identity);
  let itunesRow: ITunesSong | null = null;
  if (!previewUrl) {
    itunesRow =
      (candidate.itunesTrackId
        ? await lookupITunesSongById(candidate.itunesTrackId, identity)
        : null) ?? (await lookupITunesTrack(identity.artist, identity.title));
    if (itunesRow) {
      previewUrl = catalogPreviewUrl(
        {
          title: itunesRow.title,
          artist: itunesRow.artist,
          previewUrl: itunesRow.previewUrl,
        },
        identity,
      );
    }
  }

  const asITunes: ITunesSong = {
    title: itunesRow?.title ?? candidate.title,
    artist: itunesRow?.artist ?? candidate.artist,
    album: itunesRow?.album ?? candidate.album,
    previewUrl,
    trackId: itunesRow?.trackId ?? candidate.itunesTrackId,
    durationMs: itunesRow?.durationMs ?? candidate.durationMs,
    releaseYear: itunesRow?.releaseYear ?? candidate.releaseYear,
    ...(itunesRow?.explicit === true ? { explicit: true } : {}),
  };

  let youtubeId: string | undefined;
  if (transport.youtubeFallback) {
    const resolved = await resolveTrackVideoId(
      identity.artist,
      identity.title,
      transport.excludeYoutubeIds,
      catalogDurationFromMs(itunesRow?.durationMs ?? candidate.durationMs),
    );
    if (resolved) {
      if (seen.has(resolved)) return null;
      youtubeId = resolved;
    }
  }

  const track = itunesSongToStationTrack(asITunes, youtubeId, identity);
  if (!track) return null;
  const hasHttpMedia = Boolean(
    track.streamUrl?.trim() || track.previewUrl?.trim(),
  );
  const hasYoutube = Boolean(track.youtubeId?.trim());
  if (transport.youtubeFallback) {
    if (!hasHttpMedia && !hasYoutube) return null;
  } else if (!hasHttpMedia) {
    return null;
  }

  const key = youtubeId
    ? youtubeId
    : `preview:${
        candidate.itunesTrackId ??
        candidate.spotifyId ??
        itunesRow?.trackId ??
        `${track.artist}::${track.title}`
      }`;
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
 * GET /api/song-radio?spotifyTrackId=…&title=…&artist=…&youtubeFallback=true
 *
 * Builds a seeded Song Radio queue: requested track at index 0, then 4–5
 * more of that artist's Last.fm great songs, then a match-score-filtered
 * similar-artist mix (Last.fm top tracks, play-count ranked). Never returns
 * a single-artist payload — empty similar pool or < 2 unique primary
 * artists is 404. Pulls ~30 candidates and delivers up to 25.
 *
 * `youtubeFallback=true` is development-only (`NODE_ENV=development` or
 * `NEXT_PUBLIC_ENABLE_DEV_TOGGLE=true`). Production always stamps
 * `youtubeId: ""` so Pocket Mode binds `DirectStreamProvider`.
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
  /** Session recentTrackIds — Spotify ids (and other keys) to keep out of the pool. */
  const recentTrackIds = (searchParams.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const youtubeFallbackRequested = searchParams.get("youtubeFallback") === "true";
  const youtubeFallback =
    youtubeFallbackRequested &&
    (process.env.NODE_ENV === "development" ||
      process.env.NEXT_PUBLIC_ENABLE_DEV_TOGGLE === "true");
  const excludeYoutubeIds = parseFailedYoutubeIdsParam(
    searchParams.get("excludeYoutubeIds"),
  );
  const transport: ResolveTransport = { youtubeFallback, excludeYoutubeIds };

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

    let similarCandidates = await fetchSimilarArtistCandidates(artist, title);
    let seedArtistCandidates = await fetchSeedArtistCandidates(artist, title);

    if (recentTrackIds.length) {
      const banned = new Set(recentTrackIds);
      const notBanned = (c: CatalogCandidate) => {
        if (c.spotifyId && banned.has(c.spotifyId)) return false;
        if (c.itunesTrackId && banned.has(`itunes:${c.itunesTrackId}`)) {
          return false;
        }
        return true;
      };
      recommended = recommended.filter(
        (c) => !c.spotifyId || !banned.has(c.spotifyId),
      );
      similarCandidates = similarCandidates.filter(notBanned);
      seedArtistCandidates = seedArtistCandidates.filter(notBanned);
    }

    if (
      !similarCandidates.length &&
      uniquePrimaryArtists([seedCandidate, ...recommended]).size < 2
    ) {
      return NextResponse.json(
        {
          error: `Could not expand Song Radio for "${title}" by ${artist} into a multi-artist mix.`,
        },
        { status: 404 },
      );
    }

    const mixedTail = applyArtistCap(
      interleaveAfterSeed(recommended, similarCandidates),
      OTHER_ARTIST_CAP,
    );

    const seen = new Set<string>();
    const seedTrack = await resolveCandidate(
      seedCandidate,
      seen,
      seedIdentity,
      transport,
    );

    // Seed-artist great songs land at indices 1–N and occupy `seen` before
    // similar-artist / Spotify rows resolve, so the searched act is not duplicated.
    const seedExtraTracks = await resolveInPool(
      seedArtistCandidates,
      (candidate) => resolveCandidate(candidate, seen, undefined, transport),
      { concurrency: 8 },
    );

    const resolvedSeedCount = (seedTrack ? 1 : 0) + seedExtraTracks.length;
    const tailLimit = Math.max(
      0,
      SONG_RADIO_RECOMMENDATION_COUNT - resolvedSeedCount,
    );

    const resolvedRecommended = await resolveInPool(
      mixedTail,
      (candidate) => resolveCandidate(candidate, seen, undefined, transport),
      { concurrency: 8, limit: tailLimit },
    );

    let tracks: StationTrack[] = [];
    if (seedTrack) {
      tracks = applySongRadioArtistCap(
        [seedTrack, ...seedExtraTracks, ...resolvedRecommended],
        artist,
      );
      if (
        tracks[0]?.title !== seedTrack.title ||
        tracks[0]?.artist !== seedTrack.artist
      ) {
        tracks = [
          seedTrack,
          ...applySongRadioArtistCap(
            tracks.filter((t) => t !== seedTrack),
            artist,
          ),
        ];
      }
    } else if (seedExtraTracks.length || resolvedRecommended.length) {
      tracks = applySongRadioArtistCap(
        [...seedExtraTracks, ...resolvedRecommended],
        artist,
      );
    }

    if (!tracks.length || uniquePrimaryArtists(tracks).size < 2) {
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

    tracks = tracks.slice(0, SONG_RADIO_DELIVERY_COUNT);

    // TEMP T34-diag: full pipeline counts for Song Radio tuning.
    console.log("[song-radio-diag] summary", {
      seedArtist: artist,
      recommendedPull: recommended.length,
      similarCandidates: similarCandidates.length,
      seedArtistCandidates: seedArtistCandidates.length,
      resolvedSeedCount,
      tailLimit,
      resolvedRecommended: resolvedRecommended.length,
      finalTracks: tracks.length,
      uniqueArtists: uniquePrimaryArtists(tracks).size,
    });

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
