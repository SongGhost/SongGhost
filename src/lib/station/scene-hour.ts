/**
 * A catalog station hour is the scene mix search already uses.
 * No second judge. The pool is cached like an artist, keyed by station id.
 */

import type { Station, StationTrack } from "@/data/stations";
import { getStationById } from "@/data/stations";
import { getStationGenreProfile } from "@/lib/station-genre-profiles";
import {
  SCENE_CLOSE_SONGS,
  SCENE_DEEP_SONGS,
  SCENE_PEER_SONGS,
  drawSceneNeighborhood,
  plannedSceneCounts,
  weaveScene,
  type MixPoolName,
  type NeighborhoodCast,
  type PreviousCast,
} from "@/lib/artist-mix";
import type { Rng } from "@/lib/track-shuffle";
import {
  neighborhoodPoolIsFresh,
  recallNeighborhoodPool,
  rememberNeighborhoodPool,
  suggestSceneArtists,
} from "@/lib/mix-neighbors";
import {
  buildSceneNeighborhood,
  type PlannedSlot,
} from "@/lib/neighborhood-launch";
import { searchITunesSongs } from "@/lib/itunes";
import { applyArtistCap, isYearWithinEra } from "@/lib/queue/builder";
import { artistNamesMatch } from "@/lib/track-quality";
import { isEraLock, type EraLock } from "@/types/station";

const ERA_LOCK_BY_LABEL: Record<string, EraLock> = {
  "50s": "50s",
  "60s": "60s",
  "70s": "70s",
  "80s": "80s",
  "90s": "90s",
  y2k: "2000s",
  "2000s": "2000s",
  "2010s": "2010s",
  "2020s": "2020s",
};

export function stationPoolKey(stationId: string): string {
  return `station:${stationId.trim()}`;
}

export function eraLockForStation(station: Pick<Station, "era">): EraLock {
  const era = station.era?.trim().toLowerCase() ?? "";
  if (!era) return "all";
  return ERA_LOCK_BY_LABEL[era] ?? "all";
}

/**
 * A lane with an era keeps that wall. Otherwise the listener's lock applies.
 */
export function hourEraLock(station: Pick<Station, "era">, requested: EraLock = "all"): EraLock {
  const lane = eraLockForStation(station);
  if (lane !== "all") return lane;
  return isEraLock(requested) ? requested : "all";
}

export function anchorsForStation(station: Station): string[] {
  const seeds = (station.seedArtists ?? []).map((name) => name.trim()).filter(Boolean);
  if (seeds.length) return seeds.slice(0, 8);
  return getStationGenreProfile(station).anchorArtists.slice(0, 8);
}

/** Scene text for the existing judge. Anchors are evidence, not a second list. */
export function scenePromptForStation(station: Station): string {
  const anchors = anchorsForStation(station);
  const era = station.era?.trim()
    ? `Era: ${station.era}. Stay in that decade.`
    : "Era: any year, as long as the artist still belongs on this lane.";
  const evidence = anchors.length
    ? `Evidence artists a fan of this lane would expect. Drop any that fail the lane: ${anchors.join(", ")}.`
    : "";
  return [
    `Station: ${station.name}.`,
    station.description.trim(),
    station.family ? `Family: ${station.family}.` : "",
    era,
    evidence,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isStationShareable(stationId: string, savedIds: readonly string[] = []): boolean {
  const id = stationId.trim();
  if (!id) return false;
  if (getStationById(id)) return true;
  return savedIds.includes(id);
}

/**
 * Listen plays the scene hour. Song 1 is already pinned inside that hour.
 * An empty hour falls back to one authored starter, not the whole seed list.
 */
export function queueForListen(
  sceneTracks: readonly StationTrack[],
  authored: readonly StationTrack[],
): StationTrack[] {
  if (sceneTracks.length > 0) return [...sceneTracks];
  const starter = authored[0];
  return starter ? [starter] : [];
}

export function catalogCardSubtitle(station: Pick<Station, "description">): string {
  return station.description.trim();
}

type HourSong = {
  artist: string;
  title: string;
  releaseYear?: number;
};

function sameRecording(left: HourSong, right: HourSong): boolean {
  return (
    artistNamesMatch(left.artist, right.artist) &&
    left.title.trim().toLowerCase() === right.title.trim().toLowerCase()
  );
}

function starterFits(starter: HourSong | null | undefined, eraLock: EraLock): starter is HourSong {
  if (!starter?.artist?.trim() || !starter.title?.trim()) return false;
  return isYearWithinEra(starter.releaseYear, eraLock);
}

/**
 * Build one hour from a ranked pool and a fixture song list.
 * A short pool keeps the closest artists and drops the one-song shelf first.
 * The authored starter counts toward that artist's cap of 3.
 */
export function composeStationHour(input: {
  pool: readonly (string | MixPoolName)[];
  previous?: PreviousCast;
  starter?: HourSong | null;
  songsFor: (artist: string, count: number) => readonly HourSong[];
  eraLock: EraLock;
  rng?: Rng;
}): { tracks: HourSong[]; cast: NeighborhoodCast; counts: ReturnType<typeof plannedSceneCounts> } {
  const cast = drawSceneNeighborhood(input.pool, input.previous ?? {}, input.rng);
  const counts = plannedSceneCounts(cast);
  const starter = starterFits(input.starter, input.eraLock) ? input.starter : null;

  const take = (artist: string, count: number): { artist: string; titles: string[] } => {
    const dated = input
      .songsFor(artist, count)
      .filter((song) => song.title.trim() && isYearWithinEra(song.releaseYear, input.eraLock));
    const opener =
      starter && artistNamesMatch(starter.artist, artist) ? starter : null;
    const rest = dated.filter((song) => !opener || !sameRecording(song, opener));
    const chosen = opener ? [opener, ...rest].slice(0, count) : rest.slice(0, count);
    return {
      artist,
      titles: chosen.map((song) => song.title.trim()).filter(Boolean),
    };
  };

  const woven = weaveScene({
    close: cast.close.map((artist) => take(artist, SCENE_CLOSE_SONGS)),
    peer: cast.peer.map((artist) => take(artist, SCENE_PEER_SONGS)),
    deep: cast.deep.map((artist) => take(artist, SCENE_DEEP_SONGS)),
  });

  let tracks: HourSong[] = woven.map((song) => ({ artist: song.artist, title: song.title }));
  if (starter) {
    tracks = [starter, ...tracks.filter((song) => !sameRecording(song, starter))];
  }
  tracks = applyArtistCap(tracks, 3);

  return { tracks, cast, counts };
}

function trackPassesEra(track: StationTrack, eraLock: EraLock): boolean {
  return isYearWithinEra(track.releaseYear, eraLock);
}

function pinStarterTrack(tracks: StationTrack[], starter: StationTrack | null, eraLock: EraLock): StationTrack[] {
  const opener = starter && trackPassesEra(starter, eraLock) ? starter : null;
  let next = tracks.filter((track) => trackPassesEra(track, eraLock));
  if (opener) {
    next = [
      opener,
      ...next.filter(
        (track) =>
          !(
            artistNamesMatch(track.artist, opener.artist) &&
            track.title.trim().toLowerCase() === opener.title.trim().toLowerCase()
          ),
      ),
    ];
  }
  return applyArtistCap(next, 3);
}

async function anchorSleeves(anchors: readonly string[]): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  await Promise.all(
    anchors.slice(0, 8).map(async (artist) => {
      try {
        const songs = await searchITunesSongs(artist, 1);
        const url = songs[0]?.artworkUrl?.trim();
        if (!url || seen.has(url)) return;
        seen.add(url);
        urls.push(url);
      } catch {
        // A missing sleeve does not fail the hour.
      }
    }),
  );
  return urls;
}

function sleevesFromTracks(tracks: readonly StationTrack[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const url = track.artworkUrl?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export type StationSceneHour = {
  tracks: StationTrack[];
  pool: MixPoolName[];
  cast: NeighborhoodCast;
  art: string[];
  /** True when this draw used a fresh pool and did not call the model. */
  poolFresh: boolean;
};

/**
 * One station hour. A fresh pool skips the model.
 * Song 1 is an authored starter when that starter survives the era lock.
 * New lanes have no starter, so song 1 is the first close-tier song.
 */
export async function loadStationSceneHour(input: {
  station: Station;
  excludeYoutubeIds?: ReadonlySet<string>;
  eraLock?: EraLock;
  previous?: PreviousCast;
  cachedPool?: { names: readonly MixPoolName[]; at: number } | null;
  starter?: StationTrack | null;
  suggest?: typeof suggestSceneArtists;
  launch?: typeof buildSceneNeighborhood;
  now?: () => number;
}): Promise<StationSceneHour> {
  const station = input.station;
  const now = input.now ?? Date.now;
  const eraLock = hourEraLock(station, input.eraLock ?? "all");
  const previous = input.previous ?? {};
  const key = stationPoolKey(station.id);
  const launch = input.launch ?? buildSceneNeighborhood;

  let pool: MixPoolName[] = [];
  let poolFresh = false;
  const cached = input.cachedPool;
  if (cached && neighborhoodPoolIsFresh(cached.names, cached.at, now())) {
    pool = cached.names.map((entry) => ({ ...entry }));
    poolFresh = true;
  } else {
    const hit = recallNeighborhoodPool(key, now());
    if (hit) {
      pool = hit;
      poolFresh = true;
    }
  }

  if (!poolFresh) {
    const suggest = input.suggest ?? suggestSceneArtists;
    const names = await suggest(scenePromptForStation(station), previous.used ?? []);
    pool = names.map((name) => ({ name }));
    if (pool.length === 0) {
      pool = anchorsForStation(station).map((name) => ({ name }));
    }
    if (pool.length > 0 && !input.suggest) rememberNeighborhoodPool(key, pool, now());
  }

  const exclude = input.excludeYoutubeIds ?? new Set<string>();
  const launched = await launch({
    pool,
    previous,
    excludeYoutubeIds: exclude,
  });
  const tail = launched.tailPlan.length
    ? await launch({
        pool,
        previous,
        beat: "2",
        plan: launched.tailPlan,
        excludeYoutubeIds: exclude,
      })
    : { tracks: [] as StationTrack[], tailPlan: [] as PlannedSlot[], cast: launched.cast };

  const starter =
    input.starter ??
    (station.tracks.length > 0 ? station.tracks[0] ?? null : null);
  const tracks = pinStarterTrack([...launched.tracks, ...tail.tracks], starter, eraLock);
  const art = input.launch
    ? sleevesFromTracks(tracks)
    : [...new Set([...(await anchorSleeves(anchorsForStation(station))), ...sleevesFromTracks(tracks)])];

  return {
    tracks,
    pool,
    cast: launched.cast,
    art,
    poolFresh,
  };
}

/** Beat 2 of a plan already drawn. Does not call the model. */
export async function resumeStationPlan(
  plan: readonly PlannedSlot[],
  excludeYoutubeIds?: ReadonlySet<string>,
): Promise<StationTrack[]> {
  if (plan.length === 0) return [];
  const launched = await buildSceneNeighborhood({
    pool: [],
    beat: "2",
    plan,
    excludeYoutubeIds,
  });
  return launched.tracks;
}
