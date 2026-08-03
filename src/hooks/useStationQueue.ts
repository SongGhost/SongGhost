"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type StationTrack } from "@/data/stations";
import { reorderQueueItems } from "@/lib/audio/queue-reorder";
import { isSavedStationId } from "@/lib/saved-stations";
import {
  isStarterHistoryReady,
  moveToFront,
  readStarterHistory,
  rememberStarter,
  selectFreshStarterIndex,
} from "@/lib/starter-history";
import { buildOrderedStationQueue, repairArtistAdjacency, toRanked } from "@/lib/track-shuffle";

const REPLENISH_THRESHOLD = 3;
const FETCH_COOLDOWN_MS = 5000;

/**
 * Curator stations get a timestamped id per generation, so a per-id history would
 * always be empty. All curator launches share one bucket instead: a genuinely new
 * playlist has nothing in common with the history and is left untouched, while a
 * re-run of the same prompt rotates its opener.
 */
const CURATOR_HISTORY_BUCKET = "ai-curator";

function shuffle<T>(tracks: readonly T[]): T[] {
  const out = [...tracks];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Weighted ordering with the no-back-to-back-same-artist rule, applied to incoming
 * catalog batches only. Never reorders the live queue — that would change
 * `queue[currentIndex]` and yank the playing track.
 */
function orderIncoming(tracks: readonly StationTrack[]): StationTrack[] {
  return buildOrderedStationQueue(toRanked(tracks));
}

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

function trackDedupeId(track: StationTrack): string {
  return (
    track.youtubeId?.trim() ||
    (track.itunesTrackId ? `preview:${track.itunesTrackId}` : "") ||
    track.previewUrl?.trim() ||
    ""
  );
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
 */
function isFixedPlaylistStation(stationId: string): boolean {
  return (
    isArtistRadioStation(stationId) ||
    isCuratorStation(stationId) ||
    isSavedStationId(stationId)
  );
}

export function useStationQueue({
  stationId,
  initialTracks,
  onTrackChange,
}: {
  stationId: string;
  initialTracks: StationTrack[];
  onTrackChange?: (track: StationTrack) => void;
}) {
  const stationIdRef = useRef(stationId);
  const initialTracksRef = useRef(initialTracks);
  const onTrackChangeRef = useRef(onTrackChange);
  const prevStationIdRef = useRef(stationId);
  const isFetchingRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const playedIdsRef = useRef<Set<string>>(new Set());
  const replenishPromiseRef = useRef<Promise<void> | null>(null);
  const isInitialFetchRef = useRef(true);

  useEffect(() => {
    stationIdRef.current = stationId;
    initialTracksRef.current = initialTracks;
    onTrackChangeRef.current = onTrackChange;
  });

  useEffect(() => {
    if (prevStationIdRef.current !== stationId) {
      playedIdsRef.current.clear();
      lastFetchTimeRef.current = 0;
      prevStationIdRef.current = stationId;
    }
  }, [stationId]);

  const [queue, setQueue] = useState<StationTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);

  const applyQueue = useCallback((next: StationTrack[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const applyIndex = useCallback((index: number) => {
    currentIndexRef.current = index;
    setCurrentIndex(index);
  }, []);

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

  const replenishQueue = useCallback(async (urgent = false) => {
    if (isFixedPlaylistStation(stationIdRef.current)) {
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
        const res = await fetch(
          `/api/station-tracks?stationId=${encodeURIComponent(stationIdRef.current)}&exclude=${encodeURIComponent(exclude)}`,
        );
        if (!res.ok) throw new Error("replenish failed");

        const { tracks = [] } = (await res.json()) as { tracks?: StationTrack[] };
        const ids = new Set(queueRef.current.map((t) => trackDedupeId(t)).filter(Boolean));
        for (const id of playedIdsRef.current) ids.add(id);

        const unique = orderIncoming(
          tracks.filter((t) => {
            const id = trackDedupeId(t);
            return id && !ids.has(id);
          }),
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
  }, [applyQueue, buildExcludeList]);

  const maybeReplenish = useCallback(() => {
    const remaining = queueRef.current.length - currentIndexRef.current - 1;
    if (remaining < REPLENISH_THRESHOLD) {
      void replenishQueue();
    }
  }, [replenishQueue]);

  const markPlayed = useCallback((track?: StationTrack) => {
    const id = track ? trackDedupeId(track) : "";
    if (id) playedIdsRef.current.add(id);
  }, []);

  const nextTrack = useCallback(async () => {
    if (!queueRef.current.length) return;

    markPlayed(queueRef.current[currentIndexRef.current]);
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
  }, [applyIndex, markPlayed, maybeReplenish, replenishQueue]);

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
          } else if (initialTracksRef.current.length) {
            applyQueue(shuffle(initialTracksRef.current));
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

  const runReset = useCallback(async () => {
    playedIdsRef.current.clear();
    isFetchingRef.current = false;
    lastFetchTimeRef.current = 0;
    replenishPromiseRef.current = null;
    isInitialFetchRef.current = true;

    // Saved stations keep the exact order the listener arranged before saving —
    // the first track is a deliberate choice, not a draw to rotate.
    if (isSavedStationId(stationIdRef.current)) {
      applyQueue([...initialTracksRef.current]);
      applyIndex(0);
      setReady(true);
      return;
    }

    if (isArtistRadioStation(stationIdRef.current)) {
      applyQueue(rotateStarter(stationIdRef.current, initialTracksRef.current));
      applyIndex(0);
      setReady(true);
      return;
    }

    if (isCuratorStation(stationIdRef.current)) {
      applyQueue(rotateStarter(CURATOR_HISTORY_BUCKET, shuffle(initialTracksRef.current)));
      applyIndex(0);
      setReady(true);
      return;
    }

    setReady(false);

    const starter = pickStarter(stationIdRef.current, initialTracksRef.current);
    applyQueue(starter ? [starter] : []);
    applyIndex(0);

    await replenishQueue(true);

    applyIndex(0);
    setReady(true);
  }, [applyIndex, applyQueue, replenishQueue]);

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
   * A reset that lands before the client can read `localStorage` would draw its
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
    currentTrack && (currentTrack.youtubeId?.trim() || currentTrack.previewUrl?.trim())
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
    upcomingTrack,
    queue,
    currentIndex,
    nextTrack,
    prevTrack,
    resetQueue,
    ready,
    removeTrack,
    reorderQueue,
    insertTrackNext,
    appendTrack,
    updateTrackAt,
  };
}
