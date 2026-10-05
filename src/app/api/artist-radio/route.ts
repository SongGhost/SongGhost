import { NextResponse } from "next/server";
import {
  ARTIST_RADIO_PAYLOAD_SIZE,
  buildArtistRadioResult,
  finalizeArtistRadioTracks,
  findTracksInLibrary,
  orderArtistRadioTracks,
  type ArtistRadioMode,
  type ArtistRadioResult,
} from "@/lib/artist-radio";
import {
  buildDeepArtistPool,
  findITunesArtistDetailed,
  searchSongsByArtistStrict,
  itunesSongToStationTrack,
  type ITunesSong,
} from "@/lib/itunes";
import {
  MIX_SEED_SONGS,
  MIX_SONGS_PER_NEIGHBOR,
  mergeMixNeighbors,
  mixOpensOnSeed,
  openOnPlayableSeed,
  parseMixNeighborParam,
  recallMixNeighbors,
  rememberMixNeighbors,
  selectFreshNeighbors,
  trackIsSeedArtist,
} from "@/lib/artist-mix";
import { assembleMixNeighbors } from "@/lib/mix-neighbors";
import { isLastFmConfigured } from "@/lib/similar-artists";
import type { StationTrack } from "@/data/stations";
import { isAcceptableArtistRadioTrack } from "@/lib/track-quality";
import { parseFailedYoutubeIdsParam } from "@/lib/failed-youtube-ids";
import { preferPlayableCandidates } from "@/lib/youtube/playability";
import { isValidYouTubeVideoId } from "@/lib/youtube";
import { resolveTrackVideoId } from "@/lib/youtube-search";
import { classifyYouTubePlayback } from "@/lib/youtube/youtube-search";
import { resolveInPool } from "@/lib/resolve-pool";
import { splitTiers, TIER_1_SIZE, type Ranked } from "@/lib/track-shuffle";

/** Ordering is randomized per request, so responses must never be statically cached. */
export const dynamic = "force-dynamic";

/** Deep pool fetched from iTunes before ordering and trimming to the payload size. */
const CATALOG_POOL_TARGET = 100;
/** Resolve headroom above the payload so YouTube misses don't shrink the delivered queue. */
const RESOLVE_CANDIDATES = 40;

function parseArtistRadioMode(value: string | null): ArtistRadioMode {
  return value === "artist-only" ? "artist-only" : "mixed";
}

async function resolveSong(
  song: ITunesSong,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack | null> {
  if (!isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs })) return null;

  const youtubeId = await resolveTrackVideoId(
    song.artist,
    song.title,
    excludeYoutubeIds,
    song.durationMs != null ? song.durationMs / 1000 : undefined,
  );
  if (!youtubeId || seen.has(youtubeId)) return null;
  seen.add(youtubeId);
  return itunesSongToStationTrack(song, youtubeId);
}

/**
 * Similar-artist tracks are ranked below the primary artist's Tier 1 so they mix into
 * the tail as deep cuts and can never win the opening slot.
 */
async function buildSimilarPool(
  similarArtists: string[],
  perArtist: number,
): Promise<Ranked<ITunesSong>[]> {
  const pools = await Promise.all(
    similarArtists.map(async (related) => {
      const songs = await searchSongsByArtistStrict(related, perArtist + 2);
      return songs
        .filter((song) =>
          isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs }),
        )
        .slice(0, perArtist);
    }),
  );

  // Rank within each neighbor, not down the whole list. Otherwise the first
  // handful still crowds out later artists who share the same genre and era.
  // They stay below Tier 1, so a neighbor still cannot open the show.
  const ranked: Ranked<ITunesSong>[] = [];
  for (const songs of pools) {
    songs.forEach((song, index) => {
      ranked.push({
        item: song,
        rank: TIER_1_SIZE + index,
        tier: 2 as const,
        isPrimaryArtist: false,
      });
    });
  }
  return ranked;
}

/**
 * Local library entries have no popularity signal — they backfill the tail only.
 * Known-dead ids are left out. A listing that says the embed will not start is
 * left out. If the listing check does not answer, the backfill still plays.
 */
async function libraryFallbackTracks(
  artistName: string,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack[]> {
  const out: StationTrack[] = [];
  const queued = new Set<string>();

  for (const track of findTracksInLibrary(artistName)) {
    if (!isAcceptableArtistRadioTrack(track.title)) continue;
    if (!track.youtubeId || !isValidYouTubeVideoId(track.youtubeId)) continue;
    if (seen.has(track.youtubeId) || excludeYoutubeIds.has(track.youtubeId)) continue;
    if (queued.has(track.youtubeId)) continue;
    queued.add(track.youtubeId);
    out.push(track);
  }

  let kept = out;
  try {
    const verdicts = await classifyYouTubePlayback(out.map((track) => track.youtubeId));
    if (verdicts.size > 0) {
      kept = preferPlayableCandidates(out, verdicts, excludeYoutubeIds);
    }
  } catch {
    kept = out;
  }

  for (const track of kept) seen.add(track.youtubeId);
  return kept;
}

function songIdentity(song: ITunesSong): string {
  return song.trackId
    ? `id:${song.trackId}`
    : `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
}

async function buildArtistRadioTracks(
  artistName: string,
  mode: ArtistRadioMode,
  excludeYoutubeIds: ReadonlySet<string>,
  previousNeighbors: readonly string[],
): Promise<StationTrack[]> {
  const seen = new Set<string>();
  const matched = await findITunesArtistDetailed(artistName);
  const matchedArtist = matched?.name ?? artistName;

  let similarArtists: string[] = [];
  let similarPool: Ranked<ITunesSong>[] = [];
  // Neighbors run while the seed catalog loads. A slow model must not hold
  // the seed song. If the neighbor step fails, the seed can still open.
  const neighborTask =
    mode === "mixed"
      ? assembleMixNeighbors(matchedArtist, previousNeighbors).catch((error) => {
          console.warn("[artist-radio] mix neighbors skipped:", error);
          return [] as string[];
        })
      : Promise.resolve([] as string[]);

  const primaryPool = await buildDeepArtistPool(matchedArtist, {
    artistId: matched?.artistId,
    target: CATALOG_POOL_TARGET,
  });

  if (mode === "mixed") {
    // The model names this launch. Last.fm is only a small backup inside
    // that step. Names already used are skipped when others still fit.
    const sameFeel = await neighborTask;
    similarArtists = selectFreshNeighbors(sameFeel, previousNeighbors);
    if (similarArtists.length) {
      similarPool = await buildSimilarPool(similarArtists, MIX_SONGS_PER_NEIGHBOR);
    }
  }

  // Shuffle the seed and the neighbors apart. A combined draw let a
  // neighbor win the opener when it had a preview or resolved first.
  const orderedSeed = orderArtistRadioTracks(splitTiers(primaryPool), {
    identify: songIdentity,
    payloadSize: RESOLVE_CANDIDATES,
  });
  if (mode === "mixed" && !orderedSeed.some((song) => trackIsSeedArtist(song.artist, matchedArtist))) {
    return [];
  }

  const orderedNeighbors =
    mode === "mixed"
      ? orderArtistRadioTracks(splitTiers(similarPool), {
          identify: songIdentity,
          payloadSize: RESOLVE_CANDIDATES,
        })
      : [];

  const resolve = (song: ITunesSong) => resolveSong(song, seen, excludeYoutubeIds);

  // Resolve the seed before any neighbor. The shared resolve budget used to
  // fill up on neighbors when the first seed video missed.
  const seedResolved = await resolveInPool(orderedSeed, resolve, {
    concurrency: mode === "mixed" ? 4 : 10,
    limit: mode === "mixed" ? MIX_SEED_SONGS : ARTIST_RADIO_PAYLOAD_SIZE,
  });
  if (mode === "mixed" && !seedResolved.some((track) => trackIsSeedArtist(track.artist, matchedArtist))) {
    return [];
  }

  const room = Math.max(0, ARTIST_RADIO_PAYLOAD_SIZE - seedResolved.length);
  const neighborResolved =
    mode === "mixed" && room > 0
      ? await resolveInPool(orderedNeighbors, resolve, { concurrency: 10, limit: room })
      : [];

  if (mode !== "mixed" && seedResolved.length < 8) {
    seedResolved.push(...(await libraryFallbackTracks(artistName, seen, excludeYoutubeIds)));
  }

  const seedCanPlay = (track: StationTrack) => Boolean(track.youtubeId?.trim());
  const tracks = openOnPlayableSeed(
    finalizeArtistRadioTracks([...seedResolved, ...neighborResolved], matchedArtist),
    matchedArtist,
    seedCanPlay,
  ).slice(0, ARTIST_RADIO_PAYLOAD_SIZE);

  // A mix with no playable song by the seed cannot open honestly.
  // Fewer neighbors is still a station. A neighbor must not open it.
  if (mode === "mixed" && !mixOpensOnSeed(tracks, matchedArtist)) {
    return [];
  }

  if (mode === "mixed" && tracks.length > 0) {
    rememberMixNeighbors(matchedArtist, similarArtists);
  }

  return tracks;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get("artist")?.trim();
  const mode = parseArtistRadioMode(searchParams.get("mode"));
  const excludeYoutubeIds = parseFailedYoutubeIdsParam(searchParams.get("excludeYoutubeIds"));
  const previousNeighbors = mergeMixNeighbors(
    artist ? recallMixNeighbors(artist) : [],
    parseMixNeighborParam(searchParams.get("excludeNeighbors")),
  );

  if (!artist) {
    return NextResponse.json({ error: "artist query parameter is required" }, { status: 400 });
  }

  const tracks = await buildArtistRadioTracks(
    artist,
    mode,
    excludeYoutubeIds,
    mode === "mixed" ? previousNeighbors : [],
  );

  if (tracks.length === 0) {
    const error =
      mode === "mixed"
        ? `No playable seed track for "${artist}".`
        : `No tracks found for "${artist}". Try another artist name.`;
    return NextResponse.json({ error }, { status: 404 });
  }

  const result: ArtistRadioResult = buildArtistRadioResult(artist, tracks, mode);

  return NextResponse.json({
    ...result,
    similarArtistsConfigured: isLastFmConfigured(),
  });
}
