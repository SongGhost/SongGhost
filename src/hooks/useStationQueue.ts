"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type StationTrack } from "@/data/stations";

const REPLENISH_THRESHOLD = 3;
const FETCH_COOLDOWN_MS = 5000;

function shuffle<T>(tracks: readonly T[]): T[] {
  const out = [...tracks];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function trackDedupeId(track: StationTrack): string {
  return (
    track.youtubeId?.trim() ||
    (track.itunesTrackId ? `preview:${track.itunesTrackId}` : "") ||
    track.previewUrl?.trim() ||
    ""
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
    const ids = new Set<string>(playedIdsRef.current);
    for (const track of queueRef.current) {
      const id = trackDedupeId(track);
      if (id) ids.add(id);
    }
    return [...ids].slice(-100).join(",");
  }, []);

  const replenishQueue = useCallback(async (urgent = false) => {
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
        const unique = shuffle(
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

  const resetQueue = useCallback(async () => {
    playedIdsRef.current.clear();
    isFetchingRef.current = false;
    lastFetchTimeRef.current = 0;
    replenishPromiseRef.current = null;
    setReady(false);

    applyQueue([]);
    applyIndex(0);

    await replenishQueue(true);

    if (queueRef.current.length) {
      applyQueue(shuffle(queueRef.current));
    } else if (initialTracksRef.current.length) {
      applyQueue(shuffle(initialTracksRef.current));
    }

    applyIndex(0);
    setReady(true);
  }, [applyIndex, applyQueue, replenishQueue]);

  const currentTrack = ready ? queue[currentIndex] : undefined;
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
    insertTrackNext,
    appendTrack,
  };
}
