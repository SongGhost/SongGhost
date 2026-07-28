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
    for (const track of queueRef.current) ids.add(track.youtubeId);
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
        const ids = new Set(queueRef.current.map((t) => t.youtubeId));
        const unique = shuffle(tracks.filter((t) => t.youtubeId && !ids.has(t.youtubeId)));

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
    if (track?.youtubeId) playedIdsRef.current.add(track.youtubeId);
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

  const resetQueue = useCallback(async () => {
    playedIdsRef.current.clear();
    isFetchingRef.current = false;
    lastFetchTimeRef.current = 0;
    replenishPromiseRef.current = null;
    setReady(false);

    const starter = shuffle(initialTracksRef.current)[0];
    applyQueue(starter ? [starter] : []);
    applyIndex(0);

    await replenishQueue(true);
    setReady(true);
  }, [applyIndex, applyQueue, replenishQueue]);

  const currentTrack = ready ? queue[currentIndex] : queue[0];
  const validTrack = currentTrack?.youtubeId?.trim() ? currentTrack : undefined;

  useEffect(() => {
    if (validTrack) onTrackChangeRef.current?.(validTrack);
  }, [validTrack]);

  return { currentTrack: validTrack, queue, currentIndex, nextTrack, prevTrack, resetQueue, ready };
}
