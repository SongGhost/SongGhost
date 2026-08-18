"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { type StationTrack } from "@/data/stations";
import { reorderQueueItems } from "@/lib/audio/queue-reorder";
import {
  getSharedDjBreakPrefetchEngine,
  type DjPrefetchContext,
  type PrefetchedDjBreak,
} from "@/lib/dj/prefetchEngine";
import { isHeavyRotationStation } from "@/lib/heavy-rotation";
import { updateCurrentTrackState } from "@/lib/audio/legacy/webOrchestrator";
import {
  cloneSessionTrack,
  findQueueIndexForPlayingTrack,
  isSessionPlayableTrack,
  readPersistedSessionQueue,
  writePersistedSessionQueue,
  type PlayingTrackAlignTo,
} from "@/lib/queue/session-persistence";
import { isSavedStationId } from "@/lib/saved-stations";
import { isSongRadioStation } from "@/lib/song-radio";
import { isPersistedLaunchStationId } from "@/lib/user/preferences";
import { getYouTubeThumbnail } from "@/lib/youtube";
import {
  isStarterHistoryReady,
  moveToFront,
  readStarterHistory,
  rememberStarter,
  selectFreshStarterIndex,
} from "@/lib/starter-history";
import {
  buildStationQueue,
  filterBlockedTracks,
  filterTracksByEra,
  isTrackBlocked,
  toPreferenceRanked,
  trackIdentity,
} from "@/lib/queue/builder";
import {
  getRecentTrackIds,
  rememberRecentTrackId,
} from "@/lib/queue/recent-tracks";
import { fisherYatesShuffle, shuffleRemainingTracks as shuffleTail } from "@/lib/queue/shuffle";
import {
  hasBans,
  loadTrackFeedback,
  registerListenOutcome,
} from "@/lib/user/feedback";
import { buildOrderedStationQueue, repairArtistAdjacency } from "@/lib/track-shuffle";
import {
  DEFAULT_ERA_LOCK,
  DEFAULT_STATION_MODE,
  isEraLocked,
  resolveEraLock,
  resolveStationMode,
  type AlbumContext,
  type EraLock,
  type StationMode,
} from "@/types/station";

/** Stable identity for DJ prefetch slots (spotify URI → youtube → title/artist). */
function prefetchTrackKey(track: StationTrack): string {
  const spotifyId = track.spotifyId?.trim();
  if (spotifyId) {
    return spotifyId.startsWith("spotify:track:")
      ? spotifyId
      : `spotify:track:${spotifyId}`;
  }
  return (
    track.youtubeId?.trim()
    || trackIdentity(track)
    || `${track.artist}:${track.title}`
  );
}

const REPLENISH_THRESHOLD = 3;
const FETCH_COOLDOWN_MS = 5000;
const RECENT_TRACK_IDS_MAX = 100;

function bootQueueFromSession(stationId: string): {
  queue: StationTrack[];
  currentIndex: number;
} {
  const persisted = readPersistedSessionQueue();
  if (!stationId || !persisted || persisted.stationId !== stationId) {
    return { queue: [], currentIndex: 0 };
  }
  const queue =
    persisted.queue.length > 0
      ? persisted.queue
      : persisted.nowPlayingTrack
        ? [persisted.nowPlayingTrack]
        : [];
  if (!queue.length) return { queue: [], currentIndex: 0 };
  return {
    queue,
    currentIndex: Math.min(
      Math.max(0, persisted.currentIndex),
      queue.length - 1,
    ),
  };
}

/** Restored Connect sessions carry catalog ids; YouTube-only queues do not. */
function sessionRestoreIsSpotifyCompanion(queue: readonly StationTrack[]): boolean {
  return queue.some((track) => Boolean(track.spotifyId?.trim()));
}

function recommendationToStationTrack(track: {
  id: string;
  name: string;
  artists: string[];
  album?: string;
  previewUrl?: string;
  releaseDate?: string;
  explicit?: boolean;
}): StationTrack | null {
  const id = track.id?.trim();
  const title = track.name?.trim();
  const artist = (track.artists ?? []).map((a) => a.trim()).filter(Boolean).join(", ");
  if (!id || !title || !artist) return null;

  const yearRaw = track.releaseDate?.trim().slice(0, 4);
  const releaseYear = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;

  const out: StationTrack = {
    youtubeId: "",
    title,
    artist,
    spotifyId: id,
  };
  if (track.album?.trim()) out.album = track.album.trim();
  if (track.previewUrl?.trim()) out.previewUrl = track.previewUrl.trim();
  if (Number.isInteger(releaseYear) && releaseYear > 0) out.releaseYear = releaseYear;
  if (track.explicit === true) out.explicit = true;
  return out;
}

/**
 * Curator stations get a timestamped id per generation, so a per-id history would
 * always be empty. All curator launches share one bucket instead: a genuinely new
 * playlist has nothing in common with the history and is left untouched, while a
 * re-run of the same prompt rotates its opener.
 */
const CURATOR_HISTORY_BUCKET = "ai-curator";

function shuffle<T>(tracks: readonly T[]): T[] {
  return fisherYatesShuffle([...tracks]);
}

/**
 * Song Radio / Artist Radio anti-repetition: drop anything already heard this
 * session, then Fisher–Yates the survivors. Song Radio keeps index 0 (seed).
 */
function applyAntiRepetitionQueue(
  tracks: readonly StationTrack[],
  options?: { preserveSeed?: boolean },
): StationTrack[] {
  const recent = new Set(getRecentTrackIds());
  const seed = options?.preserveSeed ? tracks[0] : undefined;
  const body = options?.preserveSeed ? tracks.slice(1) : [...tracks];

  const filtered = body.filter((track) => {
    const id = trackDedupeId(track);
    const spotifyId = track.spotifyId?.trim();
    if (spotifyId && recent.has(spotifyId)) return false;
    if (id && recent.has(id)) return false;
    return true;
  });

  // Prefer a fresh pool; if every candidate was already heard, reshuffle the raw body
  // rather than leaving Song/Artist Radio empty mid-session.
  const pool = filtered.length ? filtered : body;
  const shuffled = fisherYatesShuffle([...pool]);
  if (seed) return [seed, ...shuffled.filter((t) => t !== seed)];
  return shuffled;
}

/**
 * Stamp orchestrator UI now-playing from the live queue track so the deck shows
 * title/artist/art before the first Web Playback SDK `player_state_changed`
 * event — and again on every skip / advance so chrome never sticks on the opener.
 */
function stampQueueOpener(track: StationTrack | undefined): void {
  const title = track?.title?.trim() ?? "";
  const artist = track?.artist?.trim() ?? "";
  if (!title || !artist) return;

  const youtubeId = track?.youtubeId?.trim() || "";
  const spotifyId = track?.spotifyId?.trim() || "";
  const albumArtUrl = youtubeId ? getYouTubeThumbnail(youtubeId) : undefined;

  updateCurrentTrackState({
    id: spotifyId || youtubeId || null,
    title,
    artist,
    album: track?.album?.trim() || undefined,
    albumArtUrl,
  });
}

/**
 * Weighted ordering with the no-back-to-back-same-artist rule, applied to incoming
 * catalog batches only. Never reorders the live queue — that would change
 * `queue[currentIndex]` and yank the playing track.
 *
 * Implicit preference weights reshape the popularity ranks first so frequently
 * skipped artists/genres fall back and completed listens surface sooner.
 */
function orderIncoming(
  tracks: readonly StationTrack[],
  genreKey?: string,
): StationTrack[] {
  return buildOrderedStationQueue(
    toPreferenceRanked(tracks, loadTrackFeedback(), { genreKey }),
  );
}

export type ListenAdvanceState = {
  positionSeconds: number;
  durationSeconds: number;
  reason: "skip" | "ended" | "progress";
};

/**
 * Draws the opener from a preset station's seed pool: shuffle, then skip past
 * anything that opened this station recently.
 *
 * The shuffle alone is not enough — over a session's worth of relaunches a
 * plain random draw revisits the same handful of tracks — and the recent-opener
 * skip alone would walk the pool in its authored order.
 */
function pickStarter(stationId: string, seeds: readonly StationTrack[]): StationTrack | undefined {
  if (!seeds.length) return undefined;

  const pool = shuffle(seeds);

  // Without readable history there is nothing to rotate against. Take the head
  // of the shuffled pool — still a random draw — rather than letting an empty
  // history masquerade as "nothing has played", and skip the write so a draw
  // made without memory cannot poison the rotation for later launches.
  if (!isStarterHistoryReady()) return pool[0];

  const index = selectFreshStarterIndex(pool, trackDedupeId, readStarterHistory(stationId));
  const starter = index >= 0 ? pool[index] : undefined;
  if (starter) rememberStarter(stationId, trackDedupeId(starter));

  return starter;
}

/**
 * Promotes the first track that has not opened this station recently.
 *
 * For fixed playlists the incoming order is already meaningful — artist radio
 * front-loads hits, the curator playlist is freshly shuffled — so the opener is
 * rotated in place rather than reshuffled. Adjacency is repaired afterwards
 * because promoting a track creates two new neighbor pairs; the repair pins index
 * 0, so the promoted opener stays put.
 */
function rotateStarter(bucket: string, tracks: readonly StationTrack[]): StationTrack[] {
  if (tracks.length <= 1) return [...tracks];

  // Pre-hydration the history reads empty, which would promote index 0 — the
  // track that was already going to open. Leave the incoming order alone.
  if (!isStarterHistoryReady()) return [...tracks];

  const index = selectFreshStarterIndex(tracks, trackDedupeId, readStarterHistory(bucket));
  const rotated = repairArtistAdjacency(moveToFront(tracks, Math.max(0, index)));

  const starterId = rotated[0] ? trackDedupeId(rotated[0]) : "";
  if (starterId) rememberStarter(bucket, starterId);

  return rotated;
}

/**
 * Shared with the blacklist, so a ban recorded from the deck matches the same
 * track when the catalog serves it up again.
 */
function trackDedupeId(track: StationTrack): string {
  return trackIdentity(track);
}

/**
 * Removes tracks the listener has banned.
 *
 * Unlike the era filter this has no "rather than empty the station" escape: a
 * ban is absolute, so an empty result is honored and the queue refills from the
 * catalog instead.
 */
function withoutBannedTracks(tracks: StationTrack[]): StationTrack[] {
  return filterBlockedTracks(tracks, loadTrackFeedback());
}

function isArtistRadioStation(stationId: string): boolean {
  return stationId.startsWith("artist-radio-");
}

function isCuratorStation(stationId: string): boolean {
  return stationId.startsWith("ai-curator-");
}

/**
 * Stations with a fixed playlist: the seed tracks are the whole session, so the
 * catalog replenish path must never touch them.
 *
 * Includes persisted dynamic ids (`artist-radio-*`, `song-radio-*`, …) relaunched
 * from `savedStations` after a reboot — same contract as a named custom mix.
 */
function isFixedPlaylistStation(stationId: string): boolean {
  return isPersistedLaunchStationId(stationId) || isHeavyRotationStation(stationId);
}

export function useStationQueue({
  stationId,
  initialTracks,
  onTrackChange,
  eraLock = DEFAULT_ERA_LOCK,
  mode = DEFAULT_STATION_MODE,
  albumContext = null,
}: {
  stationId: string;
  initialTracks: StationTrack[];
  onTrackChange?: (track: StationTrack) => void;
  /** Decade lock sent with every catalog fetch and applied to seed pools */
  eraLock?: EraLock;
  /** Listening format — `album_deep_dive` plays the record in order via `buildStationQueue()` */
  mode?: StationMode;
  /** Sleeve metadata for an `album_deep_dive` station; ignored on a standard one */
  albumContext?: AlbumContext | null;
}) {
  const { allowExplicit } = useUserPreferences();
  const stationIdRef = useRef(stationId);
  const initialTracksRef = useRef(initialTracks);
  const onTrackChangeRef = useRef(onTrackChange);
  const eraLockRef = useRef(resolveEraLock(eraLock));
  const modeRef = useRef(resolveStationMode(mode));
  const albumContextRef = useRef(albumContext);
  const allowExplicitRef = useRef(allowExplicit);
  const prevStationIdRef = useRef(stationId);
  const isFetchingRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const playedIdsRef = useRef<Set<string>>(new Set());
  const replenishPromiseRef = useRef<Promise<void> | null>(null);
  const isInitialFetchRef = useRef(true);
  /** Track identities already credited with a completed listen this play-through. */
  const completedThisPlayRef = useRef<Set<string>>(new Set());
  /**
   * Zero-latency DJ warmup — progress clock kicks `/api/generate-script` +
   * `/api/generate-voice` when remaining time drops below 30s.
   */
  const djPrefetchEngineRef = useRef(getSharedDjBreakPrefetchEngine());

  useEffect(() => {
    stationIdRef.current = stationId;
    initialTracksRef.current = initialTracks;
    onTrackChangeRef.current = onTrackChange;
    eraLockRef.current = resolveEraLock(eraLock);
    modeRef.current = resolveStationMode(mode);
    albumContextRef.current = albumContext ?? null;
    allowExplicitRef.current = allowExplicit;
  });

  // Station / era / mode changes invalidate warmed clips (different host tone).
  useEffect(() => {
    djPrefetchEngineRef.current.clear();
  }, [stationId, eraLock, mode]);

  /** Deep dive is only "live" once both the mode and a usable sleeve agree. */
  const isAlbumDeepDiveActive = useCallback(
    () => modeRef.current === "album_deep_dive" && Boolean(albumContextRef.current),
    [],
  );

  const [queue, setQueue] = useState<StationTrack[]>(
    () => bootQueueFromSession(stationId).queue,
  );
  const [currentIndex, setCurrentIndex] = useState(
    () => bootQueueFromSession(stationId).currentIndex,
  );
  const [ready, setReady] = useState(
    () => bootQueueFromSession(stationId).queue.length > 0,
  );
  /**
   * Spotify companion session restore: keep the queue in memory for instant
   * `syncIndexToPlayingTrack` lookup, but do not stamp ControlDeck metadata
   * until the SDK handshake lands. YouTube restores paint immediately.
   */
  const [isSpotifySyncPending, setIsSpotifySyncPending] = useState(() => {
    const boot = bootQueueFromSession(stationId);
    return boot.queue.length > 0 && sessionRestoreIsSpotifyCompanion(boot.queue);
  });
  const spotifySyncPendingRef = useRef(isSpotifySyncPending);
  /** Last 100 track ids played this page session (shared with radio launch APIs). */
  const [recentTrackIds, setRecentTrackIds] = useState<string[]>(() => [
    ...getRecentTrackIds(),
  ]);
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  /**
   * Prefer a one-shot session hydrate from sessionStorage on the first matching
   * station reset after boot. Later relaunches rebuild from seeds as usual.
   * `requestSessionHydrate()` re-arms this after a Spotify/React queue desync.
   */
  const sessionHydratedRef = useRef(false);

  const applyQueue = useCallback((next: StationTrack[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const applyIndex = useCallback((index: number) => {
    currentIndexRef.current = index;
    setCurrentIndex(index);
    // Keep shared WebPlayer / ControlDeck metadata in lockstep with the queue
    // cursor — next/prev/skip used to advance index without re-stamping, which
    // left title/artist stuck on the opener while album art fell through to props.
    // Session restore holds this stamp until the Spotify SDK handshake completes.
    if (!spotifySyncPendingRef.current) {
      stampQueueOpener(queueRef.current[index]);
    }
  }, []);

  useEffect(() => {
    if (prevStationIdRef.current === stationId) return;
    playedIdsRef.current.clear();
    lastFetchTimeRef.current = 0;
    // Restore re-arms `sessionHydratedRef` before stationId lands, so boot
    // hydrate may keep its cached cursor. Explicit selects already hydrated
    // once — force the playhead to the opener and drop the prior offset.
    const isExplicitSwitch = sessionHydratedRef.current;
    prevStationIdRef.current = stationId;
    if (isExplicitSwitch) applyIndex(0);
  }, [stationId, applyIndex]);

  /** Persist live queue + now-playing so Play-after-refresh / new-tab can restore context. */
  const persistSessionQueue = useCallback(() => {
    const stationId = stationIdRef.current?.trim();
    if (!stationId || !ready) return;
    const liveQueue = queueRef.current;
    if (!liveQueue.length) return;
    const index = Math.min(
      Math.max(0, currentIndexRef.current),
      liveQueue.length - 1,
    );
    const nowPlayingTrack = liveQueue[index] ?? null;
    if (!isSessionPlayableTrack(nowPlayingTrack)) return;

    const existing = readPersistedSessionQueue();
    writePersistedSessionQueue({
      stationId,
      queue: liveQueue.map(cloneSessionTrack),
      currentIndex: index,
      nowPlayingTrack: cloneSessionTrack(nowPlayingTrack),
      station: existing?.stationId === stationId ? existing.station : undefined,
    });
  }, [ready]);

  const buildExcludeList = useCallback(() => {
    // The launch fetch must send an empty exclude list: any exclusion makes the
    // server skip *and never write* its 15-minute catalog cache, so every launch
    // would pay for a full catalog rebuild. The starter is filtered client-side
    // during the merge below instead.
    if (isInitialFetchRef.current) return "";

    const ids = new Set<string>(playedIdsRef.current);
    for (const track of queueRef.current) {
      const id = trackDedupeId(track);
      if (id) ids.add(id);
    }
    return [...ids].slice(-100).join(",");
  }, []);

  /**
   * Background refill when a reboot restored only `nowPlayingTrack`.
   * Prefer Spotify `/api/recommendations` seeded by the restored track id.
   */
  const replenishFromRecommendations = useCallback(
    async (seed: StationTrack) => {
      const seedId = seed.spotifyId?.trim();
      if (!seedId) return false;

      try {
        const exclude = [
          seedId,
          ...getRecentTrackIds(),
          ...queueRef.current.map((t) => t.spotifyId?.trim() || trackDedupeId(t)),
        ]
          .filter(Boolean)
          .slice(-100)
          .join(",");

        const res = await fetch(
          `/api/recommendations?seed_tracks=${encodeURIComponent(seedId)}&exclude=${encodeURIComponent(exclude)}&limit=40&allowExplicit=${allowExplicitRef.current ? "true" : "false"}`,
        );
        if (!res.ok) throw new Error("recommendations replenish failed");

        const body = (await res.json()) as {
          tracks?: Array<{
            id: string;
            name: string;
            artists: string[];
            album?: string;
            previewUrl?: string;
            releaseDate?: string;
            explicit?: boolean;
          }>;
        };

        const ids = new Set(
          queueRef.current.map((t) => trackDedupeId(t)).filter(Boolean),
        );
        for (const id of playedIdsRef.current) ids.add(id);

        const mapped = (body.tracks ?? [])
          .map(recommendationToStationTrack)
          .filter((t): t is StationTrack => Boolean(t))
          .filter((t) => {
            const id = trackDedupeId(t);
            return id && !ids.has(id);
          });

        const unique = orderIncoming(
          withoutBannedTracks(filterTracksByEra(mapped, eraLockRef.current)),
          stationIdRef.current,
        );

        if (unique.length) {
          applyQueue([...queueRef.current, ...unique]);
          return true;
        }
      } catch (error) {
        console.warn("[useStationQueue] Recommendations replenish failed:", error);
      }
      return false;
    },
    [applyQueue],
  );

  const replenishQueue = useCallback(async (urgent = false) => {
    // A deep dive has no catalog behind it — the sleeve is the whole session —
    // so there is nothing to replenish from, same as a fixed playlist station.
    if (isFixedPlaylistStation(stationIdRef.current) || isAlbumDeepDiveActive()) {
      return;
    }

    if (replenishPromiseRef.current) return replenishPromiseRef.current;

    const now = Date.now();
    if (!urgent && now - lastFetchTimeRef.current < FETCH_COOLDOWN_MS) {
      return;
    }

    const promise = (async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      lastFetchTimeRef.current = Date.now();

      try {
        const exclude = buildExcludeList();
        const era = eraLockRef.current;
        const res = await fetch(
          `/api/station-tracks?stationId=${encodeURIComponent(stationIdRef.current)}&exclude=${encodeURIComponent(exclude)}&era=${encodeURIComponent(era)}&allowExplicit=${allowExplicitRef.current ? "true" : "false"}`,
        );
        if (!res.ok) throw new Error("replenish failed");

        const { tracks = [] } = (await res.json()) as { tracks?: StationTrack[] };
        const ids = new Set(queueRef.current.map((t) => trackDedupeId(t)).filter(Boolean));
        for (const id of playedIdsRef.current) ids.add(id);

        // Re-checked client-side: the era is enforced server-side too, but the
        // 15-minute catalog cache and the seed fallback both predate this filter.
        // The blacklist is client-only and has to be applied here or a banned
        // track walks straight back into the queue on the next refill.
        const unique = orderIncoming(
          withoutBannedTracks(filterTracksByEra(tracks, era)).filter((t) => {
            const id = trackDedupeId(t);
            return id && !ids.has(id);
          }),
          stationIdRef.current,
        );

        if (unique.length) {
          applyQueue([...queueRef.current, ...unique]);
        }
      } catch (error) {
        console.warn("[useStationQueue] Replenish failed:", error);
      } finally {
        isInitialFetchRef.current = false;
        isFetchingRef.current = false;
        replenishPromiseRef.current = null;
      }
    })();

    replenishPromiseRef.current = promise;
    return promise;
  }, [applyQueue, buildExcludeList, isAlbumDeepDiveActive]);

  const maybeReplenish = useCallback(() => {
    const remaining = queueRef.current.length - currentIndexRef.current - 1;
    if (remaining < REPLENISH_THRESHOLD) {
      void replenishQueue();
    }
  }, [replenishQueue]);

  const markPlayed = useCallback((track?: StationTrack) => {
    const id = track ? trackDedupeId(track) : "";
    if (id) playedIdsRef.current.add(id);

    const spotifyId = track?.spotifyId?.trim();
    const recentKey = spotifyId || id;
    if (!recentKey) return;

    rememberRecentTrackId(recentKey);
    if (spotifyId && id && spotifyId !== id) rememberRecentTrackId(id);

    setRecentTrackIds([...getRecentTrackIds()].slice(-RECENT_TRACK_IDS_MAX));
  }, []);

  const listenSignalFor = useCallback((track?: StationTrack) => {
    if (!track) return null;
    const trackId = trackDedupeId(track);
    if (!trackId) return null;
    return {
      trackId,
      artist: track.artist,
      genreKey: stationIdRef.current,
    };
  }, []);

  /**
   * Implicit preference signal from live playback.
   *
   * A skip before 30s is a negative signal; crossing 80% of duration is a
   * completed listen. Progress reports only fire the complete path once per
   * play-through so a long linger after 80% does not inflate the weight.
   *
   * Also drives zero-latency DJ prefetch: when remaining time drops below 30s,
   * the shared {@link DjBreakPrefetchEngine} warms script + TTS for the
   * upcoming track into `prefetchedBreaksMap`.
   */
  const notePlaybackProgress = useCallback(
    (listen: ListenAdvanceState) => {
      const track = queueRef.current[currentIndexRef.current];
      const upcoming = queueRef.current[currentIndexRef.current + 1];
      if (upcoming) {
        const previousTrack =
          track?.title?.trim() && track?.artist?.trim()
            ? { title: track.title.trim(), artist: track.artist.trim() }
            : undefined;
        djPrefetchEngineRef.current.observeProgress(
          {
            positionSeconds: listen.positionSeconds,
            durationSeconds: listen.durationSeconds,
          },
          {
            trackKey: prefetchTrackKey(upcoming),
            title: upcoming.title,
            artist: upcoming.artist,
          },
          previousTrack,
        );
        // Keep only the on-air + up-next slots warm after queue edits.
        djPrefetchEngineRef.current.retain([
          track ? prefetchTrackKey(track) : undefined,
          prefetchTrackKey(upcoming),
          queueRef.current[currentIndexRef.current + 2]
            ? prefetchTrackKey(queueRef.current[currentIndexRef.current + 2]!)
            : undefined,
        ]);
      }

      const signal = listenSignalFor(track);
      if (!signal) return;

      // One credit per play-through: a complete already recorded wins over a
      // later skip-at-90% or a duplicate ended event.
      if (completedThisPlayRef.current.has(signal.trackId)) return;

      const { outcome } = registerListenOutcome(
        signal,
        listen.positionSeconds,
        listen.durationSeconds,
        listen.reason,
      );
      if (outcome === "complete") completedThisPlayRef.current.add(signal.trackId);
    },
    [listenSignalFor],
  );

  /** Stamp persona / station knobs used by the 30s background warmup. */
  const setDjPrefetchContext = useCallback((context: DjPrefetchContext) => {
    djPrefetchEngineRef.current.setContext(context);
  }, []);

  /** Claim a warmed break for `trackKey` (removes it from the in-memory cache). */
  const takePrefetchedDjBreak = useCallback(
    (trackKey: string): PrefetchedDjBreak | null =>
      djPrefetchEngineRef.current.take(trackKey),
    [],
  );

  const clearPrefetchedDjBreaks = useCallback(() => {
    djPrefetchEngineRef.current.clear();
  }, []);

  const nextTrack = useCallback(async (listen?: ListenAdvanceState) => {
    if (!queueRef.current.length) return;

    const current = queueRef.current[currentIndexRef.current];
    if (listen) notePlaybackProgress(listen);
    markPlayed(current);
    completedThisPlayRef.current.clear();
    maybeReplenish();

    let nextIndex = currentIndexRef.current + 1;
    if (nextIndex >= queueRef.current.length) {
      await replenishQueue(true);
      nextIndex = currentIndexRef.current + 1;
      if (nextIndex >= queueRef.current.length) {
        playedIdsRef.current.clear();
        await replenishQueue(true);
        nextIndex = currentIndexRef.current + 1;
        if (nextIndex >= queueRef.current.length) nextIndex = 0;
      }
    }

    applyIndex(nextIndex);
  }, [applyIndex, markPlayed, maybeReplenish, notePlaybackProgress, replenishQueue]);

  /**
   * Pure observer: align the station queue cursor to a track Spotify is
   * already playing (multi-URI auto-advance). Moves `currentIndex` via
   * {@link applyIndex} and may replenish — does **not** mark vacated
   * intermediate rows as heard (Search misses never aired), does **not**
   * treat the hop as an "ended" advance, and does not re-issue play().
   *
   * If the SDK track is missing from `queueRef.current`, log `[QueueSync]`
   * and return `-1` so the page can steer Spotify back onto the station
   * queue. Never unshift, prepend, splice, or otherwise mutate
   * `queueRef.current` on a miss.
   *
   * @returns Matching queue index, or `-1` when no match.
   */
  const syncIndexToPlayingTrack = useCallback(
    (alignTo: PlayingTrackAlignTo): number => {
      const alignIndex = findQueueIndexForPlayingTrack(queueRef.current, alignTo);
      if (alignIndex === -1) {
        // Rogue Spotify Autoplay / unrecognized URI: keep the station queue
        // unmodified. Callers MUST playTrack the intended station item instead.
        console.warn(
          "[QueueSync] Playing track not found in active station queue",
          {
            spotifyId: alignTo.spotifyId ?? null,
            title: alignTo.title ?? null,
            artist: alignTo.artist ?? null,
            stationId: stationIdRef.current,
            queueLength: queueRef.current.length,
          },
        );
        return -1;
      }

      if (alignIndex === currentIndexRef.current) return alignIndex;

      // Do not mark vacated rows as played. Unresolvable Spotify Search misses
      // jump the cursor to the next playable URI; those intermediate rows never
      // aired and must not poison replenish excludes or DJ recaps.
      completedThisPlayRef.current.clear();
      applyIndex(alignIndex);
      maybeReplenish();
      return alignIndex;
    },
    [applyIndex, maybeReplenish],
  );

  /**
   * Release the Spotify SDK handshake gate so ControlDeck may paint live
   * metadata. Stamps the current queue opener once (skipped during pending).
   */
  const clearSpotifySyncPending = useCallback(() => {
    if (!spotifySyncPendingRef.current) return;
    spotifySyncPendingRef.current = false;
    setIsSpotifySyncPending(false);
    stampQueueOpener(queueRef.current[currentIndexRef.current]);
  }, []);

  /**
   * Re-arm one-shot sessionStorage hydrate so the next `resetQueue` restores
   * the persisted station queue instead of shuffling preset seeds.
   */
  const requestSessionHydrate = useCallback(() => {
    sessionHydratedRef.current = false;
  }, []);

  /**
   * Align the playhead when the live Spotify item is already in the station
   * queue. Unrecognized tracks are **not** prepended — Spotify Autoplay
   * hijacks are steered back via `playTrack` in `page.tsx` instead.
   */
  const adoptPlayingTrack = useCallback(
    (playing: PlayingTrackAlignTo): boolean => {
      const existing = findQueueIndexForPlayingTrack(queueRef.current, playing);
      if (existing >= 0) {
        applyIndex(existing);
        setReady(true);
        return true;
      }
      return false;
    },
    [applyIndex],
  );

  /**
   * Autopilot advance after a track completes (Spotify SDK end / poll `isEnded`
   * / standalone playback ended).
   *
   * When Spotify drained a multi-URI launch while the station index was still
   * stuck on the opener, pass `alignTo` so we jump to the finished item first,
   * then move to index N + 1. Stamps the new opener for WebPlayer.
   */
  const playNextTrack = useCallback(
    async (
      listen?: ListenAdvanceState,
      alignTo?: {
        spotifyId?: string | null;
        title?: string;
        artist?: string;
      },
    ) => {
      if (!queueRef.current.length) return;

      if (alignTo) {
        syncIndexToPlayingTrack(alignTo);
      }

      await nextTrack(
        listen ?? {
          positionSeconds: 0,
          durationSeconds: 0,
          reason: "ended",
        },
      );
      stampQueueOpener(queueRef.current[currentIndexRef.current]);
    },
    [nextTrack, syncIndexToPlayingTrack],
  );

  const prevTrack = useCallback(() => {
    applyIndex(Math.max(0, currentIndexRef.current - 1));
  }, [applyIndex]);

  const removeTrack = useCallback(
    (index: number) => {
      const q = queueRef.current;
      if (index < 0 || index >= q.length) return;

      const next = q.filter((_, i) => i !== index);
      if (!next.length) {
        applyQueue([]);
        applyIndex(0);
        setReady(false);
        void replenishQueue(true).then(() => {
          if (queueRef.current.length) {
            applyQueue(shuffle(queueRef.current));
            applyIndex(0);
            setReady(true);
          } else {
            const seeds = withoutBannedTracks(initialTracksRef.current);
            if (!seeds.length) return;
            applyQueue(shuffle(seeds));
            applyIndex(0);
            setReady(true);
          }
        });
        return;
      }

      let nextIndex = currentIndexRef.current;
      if (index < currentIndexRef.current) nextIndex -= 1;
      else if (index === currentIndexRef.current && nextIndex >= next.length) {
        nextIndex = Math.max(0, next.length - 1);
      }

      applyQueue(next);
      applyIndex(nextIndex);
    },
    [applyIndex, applyQueue, replenishQueue],
  );

  /**
   * Listener-driven drag reorder. Both the queue and the index land in the same
   * React batch, so `queue[currentIndex]` never momentarily points at a
   * different track — the active player keeps the same key and plays through.
   */
  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      const result = reorderQueueItems(
        queueRef.current,
        fromIndex,
        toIndex,
        currentIndexRef.current,
      );
      if (!result) return;

      applyQueue(result.queue);
      if (result.currentIndex !== currentIndexRef.current) applyIndex(result.currentIndex);
    },
    [applyIndex, applyQueue],
  );

  /**
   * Jump the playhead to an absolute queue index. Marks the vacated track as
   * heard (same as a skip), then moves `currentIndex` so AudioPlayer's track-key
   * effect starts the new song immediately.
   */
  const jumpToTrack = useCallback(
    (index: number, listen?: ListenAdvanceState) => {
      const q = queueRef.current;
      if (!Number.isInteger(index) || index < 0 || index >= q.length) return;
      if (index === currentIndexRef.current) return;

      const current = q[currentIndexRef.current];
      if (listen) notePlaybackProgress(listen);
      markPlayed(current);
      completedThisPlayRef.current.clear();
      maybeReplenish();
      applyIndex(index);
    },
    [applyIndex, markPlayed, maybeReplenish, notePlaybackProgress],
  );

  /**
   * Fisher–Yates the unplayed tail only. The on-air track stays put — no
   * `applyIndex`, so the active player key is untouched and audio continues.
   */
  const shuffleRemainingTracks = useCallback(() => {
    const q = queueRef.current;
    const index = currentIndexRef.current;
    // Need at least two unplayed tracks for a shuffle to mean anything.
    if (q.length - index - 1 < 2) return;
    applyQueue(shuffleTail(q, index));
  }, [applyQueue]);

  const insertTrackNext = useCallback(
    (track: StationTrack) => {
      const id = trackDedupeId(track);
      if (!id) return;

      const q = queueRef.current;
      const exists = q.some((t) => trackDedupeId(t) === id);
      if (exists) return;

      const insertAt = currentIndexRef.current + 1;
      const next = [...q.slice(0, insertAt), track, ...q.slice(insertAt)];
      applyQueue(next);
    },
    [applyQueue],
  );

  const appendTrack = useCallback(
    (track: StationTrack) => {
      const id = trackDedupeId(track);
      if (!id) return;

      const q = queueRef.current;
      if (q.some((t) => trackDedupeId(t) === id)) return;

      applyQueue([...q, track]);
    },
    [applyQueue],
  );

  const updateTrackAt = useCallback(
    (index: number, track: StationTrack) => {
      const q = queueRef.current;
      if (index < 0 || index >= q.length) return;

      const next = [...q];
      next[index] = track;
      applyQueue(next);
    },
    [applyQueue],
  );

  /**
   * Admission filter for a fixed playlist.
   *
   * The blacklist always applies. The era lock does not: unlike a preset station
   * there is no catalog behind these tracks to refill from, so a lock that would
   * empty the session is left unapplied — a silent station is a worse answer
   * than an unfiltered one. A ban gets no such reprieve, which is why it is
   * applied first and never reconsidered.
   */
  const admitFixedPlaylist = useCallback((tracks: StationTrack[]): StationTrack[] => {
    const allowed = withoutBannedTracks(tracks);
    const era = eraLockRef.current;
    if (!isEraLocked(era)) return allowed;
    const filtered = filterTracksByEra(allowed, era);
    return filtered.length ? filtered : allowed;
  }, []);

  /**
   * Drops every banned track from the live queue.
   *
   * The queue is assembled once per launch and refilled in batches, so a ban
   * placed mid-session leaves matching tracks already sitting downstream — for
   * an artist ban, potentially several. Reports whether the on-air track was one
   * of them so the caller can tear down the break playing over it.
   */
  const dropBlockedTracks = useCallback((): { removed: number; droppedCurrent: boolean } => {
    const feedback = loadTrackFeedback();
    if (!hasBans(feedback)) return { removed: 0, droppedCurrent: false };

    const queued = queueRef.current;
    const current = currentIndexRef.current;
    const kept: StationTrack[] = [];
    let droppedCurrent = false;
    let removedBeforeCurrent = 0;

    queued.forEach((track, index) => {
      if (!isTrackBlocked(track, feedback)) {
        kept.push(track);
        return;
      }
      if (index === current) droppedCurrent = true;
      else if (index < current) removedBeforeCurrent += 1;
    });

    const removed = queued.length - kept.length;
    if (!removed) return { removed: 0, droppedCurrent: false };

    if (!kept.length) {
      applyQueue([]);
      applyIndex(0);
      setReady(false);
      void replenishQueue(true);
      return { removed, droppedCurrent };
    }

    // Survivors keep their order, so the track that should play next is the one
    // that shifted into the on-air slot — clamped for a ban that took the tail.
    applyQueue(kept);
    applyIndex(Math.min(Math.max(0, current - removedBeforeCurrent), kept.length - 1));

    return { removed, droppedCurrent };
  }, [applyIndex, applyQueue, replenishQueue]);

  const runReset = useCallback(async () => {
    playedIdsRef.current.clear();
    isFetchingRef.current = false;
    lastFetchTimeRef.current = 0;
    replenishPromiseRef.current = null;
    isInitialFetchRef.current = true;

    /**
     * One-shot hydrate after page reboot: restore nowPlaying + surrounding queue
     * from sessionStorage when the station id matches. If only nowPlaying survived,
     * seed `[nowPlayingTrack]` and refill via `/api/recommendations`.
     */
    if (!sessionHydratedRef.current) {
      sessionHydratedRef.current = true;
      const persisted = readPersistedSessionQueue();
      if (persisted && persisted.stationId === stationIdRef.current) {
        const sparseRestore =
          persisted.queue.length === 0 && persisted.nowPlayingTrack
            ? [persisted.nowPlayingTrack]
            : [];
        const restoredQueue =
          persisted.queue.length > 0
            ? withoutBannedTracks(persisted.queue)
            : withoutBannedTracks(sparseRestore);

        if (restoredQueue.length) {
          const index = Math.min(
            Math.max(0, persisted.currentIndex),
            restoredQueue.length - 1,
          );
          if (sessionRestoreIsSpotifyCompanion(restoredQueue)) {
            spotifySyncPendingRef.current = true;
            setIsSpotifySyncPending(true);
          }
          applyQueue(restoredQueue);
          applyIndex(index);
          if (!spotifySyncPendingRef.current) {
            stampQueueOpener(restoredQueue[index]);
          }
          setReady(true);
          console.log("[useStationQueue] Restored session queue from storage", {
            stationId: persisted.stationId,
            queueLength: restoredQueue.length,
            currentIndex: index,
            sparse: persisted.queue.length === 0,
          });

          if (persisted.queue.length === 0 && persisted.nowPlayingTrack) {
            void replenishFromRecommendations(persisted.nowPlayingTrack).then(
              (ok) => {
                if (!ok) void replenishQueue(true);
              },
            );
          } else {
            maybeReplenish();
          }
          return;
        }
      }
    }

    // Non-hydrate relaunch: drop a leftover handshake mask so Heavy Rotation
    // / preset launches cannot inherit "Tuning in…" from a prior restore.
    spotifySyncPendingRef.current = false;
    setIsSpotifySyncPending(false);

    // A deep dive plays one record start to finish, regardless of what kind of
    // station is carrying it — the sleeve overrides the seed-pool shuffle and
    // catalog replenish that every other branch below assembles a queue from.
    const album = albumContextRef.current;
    if (modeRef.current === "album_deep_dive" && album) {
      const result = buildStationQueue({
        tracks: initialTracksRef.current,
        mode: "album_deep_dive",
        albumContext: album,
        eraLock: eraLockRef.current,
        feedback: loadTrackFeedback(),
        genreKey: stationIdRef.current,
      });
      applyQueue(result.tracks);
      applyIndex(0);
      stampQueueOpener(queueRef.current[0]);
      setReady(true);
      return;
    }

    // Saved custom mixes keep the exact order the listener arranged before saving —
    // the first track is a deliberate choice, not a draw to rotate.
    if (isSavedStationId(stationIdRef.current)) {
      applyQueue(admitFixedPlaylist([...initialTracksRef.current]));
      applyIndex(0);
      stampQueueOpener(queueRef.current[0]);
      setReady(true);
      return;
    }

    // Song Radio: seed stays at index 0; recommendation tail is anti-repetition shuffled.
    // Also covers song-radio-* ids relaunched from savedStations after a reboot.
    if (isSongRadioStation(stationIdRef.current)) {
      applyQueue(
        applyAntiRepetitionQueue(admitFixedPlaylist([...initialTracksRef.current]), {
          preserveSeed: true,
        }),
      );
      applyIndex(0);
      stampQueueOpener(queueRef.current[0]);
      setReady(true);
      return;
    }

    // Heavy Rotation: Spotify top-listening order is the playlist — no reshuffle.
    if (isHeavyRotationStation(stationIdRef.current)) {
      applyQueue(admitFixedPlaylist([...initialTracksRef.current]));
      applyIndex(0);
      stampQueueOpener(queueRef.current[0]);
      setReady(true);
      return;
    }

    // Artist Radio — live launch and savedStations / memory-toolbar relaunch.
    // Seeds come from the API on first tune-in, or from the serialized manifest
    // hydrated out of savedStations after a browser reboot.
    if (isArtistRadioStation(stationIdRef.current)) {
      applyQueue(
        rotateStarter(
          stationIdRef.current,
          applyAntiRepetitionQueue(admitFixedPlaylist(initialTracksRef.current)),
        ),
      );
      applyIndex(0);
      stampQueueOpener(queueRef.current[0]);
      setReady(true);
      return;
    }

    if (isCuratorStation(stationIdRef.current)) {
      applyQueue(
        rotateStarter(
          CURATOR_HISTORY_BUCKET,
          shuffle(admitFixedPlaylist(initialTracksRef.current)),
        ),
      );
      applyIndex(0);
      stampQueueOpener(queueRef.current[0]);
      setReady(true);
      return;
    }

    setReady(false);

    /**
     * Under a lock the seed pool is skipped entirely rather than filtered: seeds
     * carry no release year, so every one of them fails strict validation. The
     * station opens on the first era-checked track the catalog fetch returns.
     */
    const starter = isEraLocked(eraLockRef.current)
      ? undefined
      : pickStarter(stationIdRef.current, withoutBannedTracks(initialTracksRef.current));
    applyQueue(starter ? [starter] : []);
    applyIndex(0);
    stampQueueOpener(queueRef.current[0]);

    await replenishQueue(true);

    applyIndex(0);
    // Catalog replenish may replace the seed opener — restamp the live head.
    stampQueueOpener(queueRef.current[0]);
    setReady(true);
  }, [
    applyIndex,
    applyQueue,
    admitFixedPlaylist,
    maybeReplenish,
    replenishFromRecommendations,
    replenishQueue,
  ]);

  // Keep reboot hydrate payload fresh whenever the live queue advances.
  useEffect(() => {
    if (!ready || !queue.length) return;
    persistSessionQueue();
  }, [ready, queue, currentIndex, persistSessionQueue]);

  /**
   * Collapses repeat resets for one launch.
   *
   * StrictMode double-invokes mount effects in development and Fast Refresh
   * re-runs them on every edit, so the same launch reaches `resetQueue` more
   * than once. Each run would otherwise draw *and record* its own opener,
   * spending several slots of rotation memory on a single launch and making the
   * next relaunch repeat sooner. A genuine relaunch carries a new key —
   * `beginStationSession` bumps `queueGeneration` every time — so only the
   * duplicates collapse.
   */
  const launchRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  /**
   * A reset that lands before the client can read `sessionStorage` would draw its
   * opener with no rotation memory. It waits for the mount effect below
   * instead — once, so a browser that permanently refuses storage still starts.
   */
  const hydratedRef = useRef(false);
  const deferredLaunchRef = useRef<string | null>(null);

  const resetQueue = useCallback(
    (launchKey?: string): Promise<void> => {
      if (!hydratedRef.current && !isStarterHistoryReady()) {
        deferredLaunchRef.current = launchKey ?? "";
        return Promise.resolve();
      }

      if (!launchKey) return runReset();

      const active = launchRef.current;
      if (active?.key === launchKey) return active.promise;

      const promise = runReset();
      launchRef.current = { key: launchKey, promise };
      return promise;
    },
    [runReset],
  );

  const resetQueueRef = useRef(resetQueue);
  resetQueueRef.current = resetQueue;

  useEffect(() => {
    hydratedRef.current = true;
    const deferred = deferredLaunchRef.current;
    if (deferred === null) return;
    deferredLaunchRef.current = null;
    void resetQueueRef.current(deferred || undefined);
  }, []);

  const currentTrack = ready ? queue[currentIndex] : queue[0];
  const validTrack =
    currentTrack &&
    (currentTrack.youtubeId?.trim() ||
      currentTrack.streamUrl?.trim() ||
      currentTrack.previewUrl?.trim() ||
      currentTrack.spotifyId?.trim())
      ? currentTrack
      : undefined;

  /**
   * The slot the DJ lookahead warms against. Held back until the queue is ready
   * so a break is never planned for a track a pending reset is about to replace.
   */
  const upcomingTrack = ready ? queue[currentIndex + 1] : undefined;

  useEffect(() => {
    if (validTrack) onTrackChangeRef.current?.(validTrack);
  }, [validTrack]);

  return {
    currentTrack: validTrack,
    /** Alias for deck chrome — same live queue cursor as `currentTrack`. */
    nowPlayingTrack: validTrack ?? null,
    upcomingTrack,
    queue,
    currentIndex,
    /** Session-scoped ids (max 100) for Song/Artist Radio anti-repetition. */
    recentTrackIds,
    nextTrack,
    /** Natural end-of-track advance (Spotify SDK / poll / standalone). */
    playNextTrack,
    /**
     * Sync `currentIndex` to an already-playing Spotify item (multi-URI
     * auto-advance). UI / Broadcast Log only — no play() / session flush.
     * Returns `-1` on miss without mutating the queue (rogue Autoplay).
     */
    syncIndexToPlayingTrack,
    /**
     * Spotify companion session restore: true until the SDK handshake
     * (`syncIndexToPlayingTrack` / `onTrackStarted`) lands live cloud state.
     * YouTube sessions are always false.
     */
    isSpotifySyncPending,
    /** Paint ControlDeck after Spotify SDK reconciliation. */
    clearSpotifySyncPending,
    /**
     * Re-arm sessionStorage hydrate for the next `resetQueue` (queue desync).
     */
    requestSessionHydrate,
    /**
     * Align the playhead when the live Spotify item is already in queue.
     * Does not inject unrecognized tracks.
     */
    adoptPlayingTrack,
    prevTrack,
    resetQueue,
    ready,
    removeTrack,
    reorderQueue,
    jumpToTrack,
    shuffleRemainingTracks,
    insertTrackNext,
    appendTrack,
    updateTrackAt,
    dropBlockedTracks,
    notePlaybackProgress,
    /** Update generate-script / generate-voice context for the 30s prefetch window. */
    setDjPrefetchContext,
    /** Claim a zero-latency warmed DJ clip from `prefetchedBreaksMap`. */
    takePrefetchedDjBreak,
    clearPrefetchedDjBreaks,
    /** Stable key helper matching the prefetch cache. */
    prefetchTrackKeyFor: prefetchTrackKey,
  };
}
