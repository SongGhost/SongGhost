import { NextResponse } from "next/server";
import { browseMusicBrainzRecordings, lookupMusicBrainzArtist } from "@/lib/catalog/musicbrainz";
import { recallNeighborhoodPool } from "@/lib/mix-neighbors";
import {
  findITunesArtistDetailed,
  itunesArtistsMatch,
  itunesTitlesMatch,
  itunesTrackMatchesQuery,
  lookupArtistSongs,
  searchITunesSongsPage,
  type ITunesSong,
} from "@/lib/itunes";
import {
  loadSongCatalogPage,
  type RawCatalogSong,
  type SongCatalogCursor,
  type SongCatalogPhase,
} from "@/lib/song-search-catalog";
import { artistNamesMatch, isAcceptableArtistRadioTrack } from "@/lib/track-quality";

export const dynamic = "force-dynamic";

const PHASES: readonly SongCatalogPhase[] = [
  "itunes-search",
  "itunes-lookup",
  "musicbrainz",
  "similar",
  "done",
];

function clampInt(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parseCursor(value: unknown): SongCatalogCursor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SongCatalogCursor>;
  if (!PHASES.includes(row.phase as SongCatalogPhase)) return null;
  const artistName = typeof row.artistName === "string" ? row.artistName.trim() : "";
  if (!artistName) return null;
  const neighbors = Array.isArray(row.neighbors)
    ? row.neighbors
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        .map((name) => name.trim())
        .slice(0, 40)
    : [];
  const artistId =
    typeof row.artistId === "number" && Number.isFinite(row.artistId) && row.artistId > 0
      ? Math.floor(row.artistId)
      : undefined;
  const mbid = typeof row.mbid === "string" ? row.mbid.trim().slice(0, 64) : "";
  return {
    phase: row.phase as SongCatalogPhase,
    offset: clampInt(row.offset, 0, 100_000),
    artistName: artistName.slice(0, 200),
    ...(artistId ? { artistId } : {}),
    ...(mbid ? { mbid } : {}),
    lookupCapped: row.lookupCapped === true,
    neighborsReady: row.neighborsReady === true,
    neighbors,
    neighborIndex: clampInt(row.neighborIndex, 0, neighbors.length),
    neighborOffset: clampInt(row.neighborOffset, 0, 100_000),
  };
}

function parseSeen(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 300))
    .slice(0, 5000);
}

function fromItunes(song: ITunesSong): RawCatalogSong {
  return {
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    ...(song.artworkUrl ? { artworkUrl: song.artworkUrl } : {}),
    ...(typeof song.durationMs === "number" ? { durationMs: song.durationMs } : {}),
    ...(song.previewUrl ? { previewUrl: song.previewUrl } : {}),
    ...(song.trackId ? { trackId: song.trackId } : {}),
  };
}

async function findCatalogArtist(
  query: string,
): Promise<{ name: string; artistId?: number } | null> {
  const named = await findITunesArtistDetailed(query);
  if (named && itunesArtistsMatch(named.name, query)) {
    return {
      name: named.name,
      ...(named.artistId ? { artistId: named.artistId } : {}),
    };
  }

  const page = await searchITunesSongsPage(query, 8, 0);
  const titled = page.songs.find(
    (song) => itunesTrackMatchesQuery(song, query) || itunesTitlesMatch(song.title, query),
  );
  const song =
    titled ??
    page.songs.find((row) =>
      isAcceptableArtistRadioTrack(row.title, { durationMs: row.durationMs }),
    );
  if (!song) return null;

  const detailed = await findITunesArtistDetailed(song.artist);
  if (detailed && artistNamesMatch(detailed.name, song.artist)) {
    return {
      name: detailed.name,
      ...(detailed.artistId ? { artistId: detailed.artistId } : {}),
    };
  }
  return { name: song.artist };
}

/**
 * POST /api/search/songs
 * One page of the Songs filter. `cursor: null` is the fast first page.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const q = typeof record.q === "string" ? record.q.trim() : "";
  if (q.length < 2) {
    return NextResponse.json({
      artistName: null,
      tracks: [],
      cursor: null,
      exhausted: true,
      similarOpen: false,
    });
  }

  const cursor = record.cursor == null ? null : parseCursor(record.cursor);
  if (record.cursor != null && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  try {
    const page = await loadSongCatalogPage({
      query: q,
      cursor,
      seen: parseSeen(record.seen),
      deps: {
        findArtist: findCatalogArtist,
        searchSongs: async (term, limit, offset) => {
          const result = await searchITunesSongsPage(term, limit, offset);
          return { songs: result.songs.map(fromItunes), rawCount: result.rawCount };
        },
        lookupSongs: async (artistId) => {
          const songs = await lookupArtistSongs(artistId);
          return songs.map(fromItunes);
        },
        resolveMbid: async (artistName) => (await lookupMusicBrainzArtist(artistName))?.id ?? null,
        browseRecordings: async (mbid, limit, offset) => {
          const page = await browseMusicBrainzRecordings(mbid, limit, offset);
          if (!page) return null;
          return {
            rawCount: page.rawCount,
            total: page.total,
            songs: page.songs.map((song) => ({
              title: song.title,
              artist: song.artist,
              recordingId: song.recordingId,
              ...(song.disambiguation ? { disambiguation: song.disambiguation } : {}),
              ...(typeof song.durationMs === "number" ? { durationMs: song.durationMs } : {}),
            })),
          };
        },
        neighbors: async (artistName) => {
          const cached = recallNeighborhoodPool(artistName);
          if (cached?.length) return cached.map((entry) => entry.name);
          const sent = Array.isArray(record.pool) ? record.pool : [];
          const clientPool = sent
            .map((row) => {
              if (!row || typeof row !== "object" || !("name" in row)) return "";
              return typeof row.name === "string" ? row.name.trim() : "";
            })
            .filter(Boolean);
          if (clientPool.length && artistNamesMatch(artistName, q)) return clientPool;
          return [];
        },
      },
    });
    return NextResponse.json(page);
  } catch (error) {
    console.error("[api/search/songs] failed:", error);
    return NextResponse.json(
      { error: "Song search failed", tracks: [], exhausted: true, similarOpen: false },
      { status: 500 },
    );
  }
}
