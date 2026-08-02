"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type StationTrack } from "@/data/stations";
import { reorderQueueItems } from "@/lib/audio/queue-reorder";
import { buildOrderedStationQueue, toRanked } from "@/lib/track-shuffle";

const REPLENISH_THRESHOLD = 3;
const FETCH_COOLDOWN_MS = 5000;
const LAST_STARTER_KEY_PREFIX = "songghost:last-starter:";

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

function readLastStarterId(stationId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(`${LAST_STARTER_KEY_PREFIX}${stationId}`);
  } catch {
    return null;
  }
}

function writeLastStarterId(stationId: string, trackId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${LAST_STARTER_KEY_PREFIX}${stationId}`, trackId);
  } catch {
    // Private-mode or quota failures are non-fatal — we just lose anti-repeat.
  }
}

/**
 * Preset seed pools hold only 2-4 hand-curated tracks, so a plain random pick
 * repeats constantly. Excluding the previous launch's opener guarantees rotation.
 */
function pickStarter(stationId: string, seeds: readonly StationTrack[]): StationTrack | undefined {
  if (!seeds.length) return undefined;

  const lastId = readLastStarterId(stationId);
  const candidates =
    seeds.length > 1 && lastId
      ? seeds.filter((track) => trackDedupeId(track) !== lastId)
      : [...seeds];

  const starter = shuffle(candidates.length ? candidates : seeds)[0];
  const starterId = starter ? trackDedupeId(starter) : "";
  if (starterId) writeLastStarterId(stationId, starterId);

  return starter;
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
    if (isArtistRadioStation(stationIdRef.current) || isCuratorStation(stationIdRef.current)) {
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

  const resetQueue = useCallback(async () => {
    playedIdsRef.current.clear();
    isFetchingRef.current = false;
    lastFetchTimeRef.current = 0;
    replenishPromiseRef.current = null;
    isInitialFetchRef.current = true;

    if (isArtistRadioStation(stationIdRef.current)) {
      applyQueue([...initialTracksRef.current]);
      applyIndex(0);
      setReady(true);
      return;
    }

    if (isCuratorStation(stationIdRef.current)) {
      applyQueue(shuffle(initialTracksRef.current));
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

  const currentTrack = ready ? queue[currentIndex] : queue[0];
  const validTrack =
    currentTrack && (currentTrack.youtubeId?.trim() || currentTrack.previewUrl?.trim())
      ? currentTrack
      : undefined;

  useEffect(() => {
    if (validTrack) onTrackChangeRef.current?.(validTrack);
  }, [validTrack]);

  return {
    currentTrack: validTrack,
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
