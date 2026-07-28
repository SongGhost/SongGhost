"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PersonaId } from "@/data/personas";
import { getStationById, type StationTrack } from "@/data/stations";
import { filterTracksByGenre } from "@/lib/genre-match";
import { playDjIntro } from "@/lib/dj-intro";
import {
  addToPlayedHistory,
  filterUnplayedTracks,
  loadPlayedHistory,
} from "@/lib/played-history";
import type { TtsProvider } from "@/types/voice";

const QUEUE_REPLENISH_THRESHOLD = 3;
const REPLENISH_FETCH_COUNT = 20;
const MAX_ERROR_SKIP_DEPTH = 5;

type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  loadPlaylist: (config: {
    listType: string;
    list: string;
    index?: number;
    startSeconds?: number;
  }) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
  isMuted: () => boolean;
  getVolume: () => number;
  getVideoData: () => { title: string; author: string; video_id: string };
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  nextVideo: () => void;
  previousVideo: () => void;
  destroy: () => void;
};

type YouTubePlayerConstructor = new (
  element: HTMLElement | null,
  config: {
    videoId?: string;
    playerVars?: Record<string, number | string>;
    events?: {
      onReady?: () => void;
      onStateChange?: (event: { data: number }) => void;
      onError?: (event: { data: number }) => void;
    };
  },
) => YouTubePlayer;

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type AudioPlayerProps = {
  youtubeId?: string;
  youtubePlaylistId?: string;
  stationId: string;
  songTitle?: string;
  artistName?: string;
  personaId?: PersonaId;
  ttsProvider?: TtsProvider;
  djPacingFrequency: number;
  maxDurationInSeconds?: number;
  isPlaying: boolean;
  volume: number;
  onTrackChange?: (track: { title: string; artist: string; youtubeId: string }) => void;
  onEnded?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  incrementSongCounter: () => number;
  addToPlayHistory: (entry: {
    id: string;
    title: string;
    artist: string;
    stationId: string;
    youtubeId: string;
  }) => void;
  /** When true, skip/queue/end are managed internally from stationTracks. */
  stationQueueMode?: boolean;
  /** Seed tracks for the active station — shuffled on each queueGeneration bump. */
  stationTracks?: StationTrack[];
  /** Increment to hard-flush the queue and rebuild for a new station session. */
  queueGeneration?: number;
  /** Optional callback to record played track IDs for history buffer (max 100). */
  onPlayedTrackId?: (youtubeId: string) => void;
};

export type AudioPlayerHandle = {
  skipNext: () => void;
  skipPrev: () => void;
};

let apiLoading = false;
let apiReady = false;
const readyCallbacks: Array<() => void> = [];

function loadYouTubeAPI() {
  if (typeof window === "undefined") return;
  if (window.YT?.Player) {
    apiReady = true;
    return;
  }
  if (apiLoading) return;

  apiLoading = true;
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.body.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    apiReady = true;
    readyCallbacks.splice(0).forEach((cb) => cb());
  };
}

function onAPIReady(callback: () => void) {
  if (apiReady && window.YT?.Player) {
    callback();
    return;
  }
  readyCallbacks.push(callback);
}

function logPlayback(event: string, data: Record<string, unknown>) {
  console.log(`[SongGhost Audio] ${event}`, data);
}

/** Fisher-Yates shuffle — randomizes station track order on every listen. */
export function shuffleTracks<T>(tracks: readonly T[]): T[] {
  const shuffled = [...tracks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Pick a random starting index within a shuffled queue. */
export function randomTrackIndex(trackCount: number): number {
  if (trackCount <= 0) return 0;
  return Math.floor(Math.random() * trackCount);
}

/** Filter played IDs, then shuffle — falls back to full pool when all are played. */
export function prepareQueue(tracks: StationTrack[], playedIds: string[]): StationTrack[] {
  const unplayed = filterUnplayedTracks(tracks, playedIds);
  const pool = unplayed.length > 0 ? unplayed : tracks;
  return avoidBackToBackShuffle(shuffleTracks(pool), playedIds[0]);
}

/** Move the first track if it would repeat the last played ID back-to-back. */
export function avoidBackToBackShuffle(
  tracks: StationTrack[],
  lastPlayedId?: string,
): StationTrack[] {
  if (!lastPlayedId || tracks.length <= 1 || tracks[0]?.youtubeId !== lastPlayedId) {
    return tracks;
  }
  const swapIndex = tracks.findIndex((track, index) => index > 0 && track.youtubeId !== lastPlayedId);
  if (swapIndex <= 0) return tracks;
  const next = [...tracks];
  [next[0], next[swapIndex]] = [next[swapIndex], next[0]];
  return next;
}

/** Append incoming tracks without duplicating queue IDs or repeating the tail back-to-back. */
export function appendQueueTracks(
  queue: StationTrack[],
  incoming: StationTrack[],
  lastPlayedId?: string,
): StationTrack[] {
  const inQueue = new Set(queue.map((track) => track.youtubeId));
  const unique = incoming.filter((track) => !inQueue.has(track.youtubeId));
  if (unique.length === 0) return queue;
  const shuffled = avoidBackToBackShuffle(
    shuffleTracks(unique),
    queue[queue.length - 1]?.youtubeId ?? lastPlayedId,
  );
  return [...queue, ...shuffled];
}

function isValidTrack(track: StationTrack | undefined): track is StationTrack {
  return Boolean(track?.youtubeId?.trim());
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  {
    youtubeId,
    youtubePlaylistId,
    stationId,
    songTitle,
    artistName,
    personaId,
    ttsProvider = "openai",
    djPacingFrequency,
    maxDurationInSeconds = 5,
    isPlaying,
    volume,
    onTrackChange,
    onEnded,
    onPlayingChange,
    incrementSongCounter,
    addToPlayHistory,
    stationQueueMode = true,
    stationTracks = [],
    queueGeneration = 0,
    onPlayedTrackId,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const isScrubbingRef = useRef(false);

  const [activeQueue, setActiveQueue] = useState<StationTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playedHistory, setPlayedHistory] = useState<string[]>(() => loadPlayedHistory());
  const activeQueueRef = useRef(activeQueue);
  const queueIndexRef = useRef(queueIndex);
  const playedHistoryRef = useRef(playedHistory);
  const replenishPromiseRef = useRef<Promise<void> | null>(null);
  const stationGenerationRef = useRef(0);
  const errorSkipDepthRef = useRef(0);
  const advanceQueueRef = useRef<(direction: "next" | "prev") => Promise<void>>(
    async () => {},
  );
  const handleNextTrackRef = useRef<() => Promise<void>>(async () => {});

  activeQueueRef.current = activeQueue;
  queueIndexRef.current = queueIndex;
  playedHistoryRef.current = playedHistory;

  const volumeRef = useRef(volume);
  const isDuckedRef = useRef(false);
  const introAbortRef = useRef<AbortController | null>(null);
  const lastVideoIdRef = useRef<string | null>(null);
  const introRunningRef = useRef(false);

  const songTitleRef = useRef(songTitle);
  const artistNameRef = useRef(artistName);
  const maxDurationRef = useRef(maxDurationInSeconds);
  const personaIdRef = useRef(personaId);
  const ttsProviderRef = useRef(ttsProvider);
  const djPacingRef = useRef(djPacingFrequency);
  const stationIdRef = useRef(stationId);
  const playlistIdRef = useRef(youtubePlaylistId);
  const singleVideoIdRef = useRef(youtubeId);
  const stationQueueModeRef = useRef(stationQueueMode);
  const onTrackChangeRef = useRef(onTrackChange);
  const stationTracksRef = useRef(stationTracks);
  stationTracksRef.current = stationTracks;

  const playbackYoutubeId = stationQueueMode
    ? activeQueue[queueIndex]?.youtubeId
    : youtubeId;

  songTitleRef.current = songTitle;
  artistNameRef.current = artistName;
  maxDurationRef.current = maxDurationInSeconds;
  personaIdRef.current = personaId;
  ttsProviderRef.current = ttsProvider;
  djPacingRef.current = djPacingFrequency;
  stationIdRef.current = stationId;
  playlistIdRef.current = youtubePlaylistId;
  singleVideoIdRef.current = playbackYoutubeId;
  stationQueueModeRef.current = stationQueueMode;
  onTrackChangeRef.current = onTrackChange;
  volumeRef.current = volume;
  isPlayingRef.current = isPlaying;

  const recordPlayedId = useCallback(
    (trackId: string) => {
      const updated = addToPlayedHistory(trackId);
      setPlayedHistory(updated);
      onPlayedTrackId?.(trackId);
    },
    [onPlayedTrackId],
  );

  const notifyQueueTrack = useCallback((track: StationTrack) => {
    if (!isValidTrack(track)) {
      logPlayback("notifySkipped", { reason: "invalidTrack", track });
      return;
    }
    onTrackChangeRef.current?.({
      title: track.title,
      artist: track.artist,
      youtubeId: track.youtubeId,
    });
  }, []);

  const filterPoolForStation = useCallback((pool: StationTrack[]): StationTrack[] => {
    const station = getStationById(stationIdRef.current);
    if (!station) return pool;
    const filtered = filterTracksByGenre(pool, station);
    return filtered.length > 0 ? filtered : pool;
  }, []);

  const applyReplenishmentFallback = useCallback((): boolean => {
    const seeds = stationTracksRef.current;
    if (seeds.length === 0) return false;

    const lastPlayedId =
      activeQueueRef.current[activeQueueRef.current.length - 1]?.youtubeId ??
      playedHistoryRef.current[0];
    const recycled = avoidBackToBackShuffle(shuffleTracks(seeds), lastPlayedId);

    const prev = activeQueueRef.current;
    let next: StationTrack[];
    if (prev.length === 0) {
      next = recycled;
    } else {
      const inQueue = new Set(prev.map((track) => track.youtubeId));
      const unique = recycled.filter((track) => !inQueue.has(track.youtubeId));
      next = [...prev, ...(unique.length > 0 ? unique : recycled)];
    }

    activeQueueRef.current = next;
    setActiveQueue(next);
    return next.length > 0;
  }, []);

  const restoreQueueFromStationTracks = useCallback((): boolean => {
    const seeds = stationTracksRef.current;
    if (seeds.length === 0) return false;

    const shuffled = filterPoolForStation(prepareQueue(seeds, playedHistoryRef.current));
    if (shuffled.length === 0) return false;

    let startIndex = randomTrackIndex(shuffled.length);
    const lastPlayedId = playedHistoryRef.current[0];
    if (
      lastPlayedId &&
      shuffled.length > 1 &&
      shuffled[startIndex]?.youtubeId === lastPlayedId
    ) {
      const alternateIndex = shuffled.findIndex(
        (track, index) => index !== startIndex && track.youtubeId !== lastPlayedId,
      );
      if (alternateIndex >= 0) startIndex = alternateIndex;
    }

    setActiveQueue(shuffled);
    setQueueIndex(startIndex);
    activeQueueRef.current = shuffled;
    queueIndexRef.current = startIndex;

    const first = shuffled[startIndex];
    if (isValidTrack(first)) {
      notifyQueueTrack(first);
      return true;
    }
    return false;
  }, [notifyQueueTrack, filterPoolForStation]);

  const applyQueueIndex = useCallback(
    (track: StationTrack | undefined, index: number): boolean => {
      if (!isValidTrack(track)) {
        logPlayback("advanceSkipped", { reason: "invalidTrack", index });
        return false;
      }
      queueIndexRef.current = index;
      setQueueIndex(index);
      lastVideoIdRef.current = null;
      notifyQueueTrack(track);
      return true;
    },
    [notifyQueueTrack],
  );

  const replenishQueue = useCallback(async (): Promise<void> => {
    if (!stationQueueModeRef.current) return;
    if (replenishPromiseRef.current) return replenishPromiseRef.current;

    const generation = stationGenerationRef.current;
    const run = async () => {
      try {
        const exclude = playedHistoryRef.current.join(",");
        const station = getStationById(stationIdRef.current);
        const genre = station?.name ?? stationIdRef.current;
        const res = await fetch(
          `/api/station-tracks?stationId=${encodeURIComponent(stationIdRef.current)}&genre=${encodeURIComponent(genre)}&exclude=${encodeURIComponent(exclude)}`,
        );
        if (!res.ok || generation !== stationGenerationRef.current) return;

        const data = (await res.json()) as { tracks: StationTrack[] };
        if (generation !== stationGenerationRef.current) return;

        let pool = filterUnplayedTracks(data.tracks ?? [], playedHistoryRef.current);
        pool = filterPoolForStation(pool);
        if (pool.length === 0) {
          pool = filterPoolForStation(
            filterUnplayedTracks(stationTracksRef.current, playedHistoryRef.current),
          );
        }
        if (pool.length === 0) {
          pool = filterPoolForStation(stationTracksRef.current);
        }

        const newTracks = pool.slice(0, REPLENISH_FETCH_COUNT);
        if (newTracks.length === 0) {
          applyReplenishmentFallback();
          return;
        }

        const lastPlayedId = playedHistoryRef.current[0];
        const prev = activeQueueRef.current;
        const next = appendQueueTracks(prev, newTracks, lastPlayedId);
        activeQueueRef.current = next;
        setActiveQueue(next);
      } catch (error) {
        logPlayback("replenishFailed", {
          error: error instanceof Error ? error.message : String(error),
          stationId: stationIdRef.current,
        });
        applyReplenishmentFallback();
      }
    };

    const promise = run();
    replenishPromiseRef.current = promise;
    void promise.finally(() => {
      if (replenishPromiseRef.current === promise) {
        replenishPromiseRef.current = null;
      }
    });
    return promise;
  }, [applyReplenishmentFallback, filterPoolForStation]);

  const ensureQueueReplenished = useCallback(async () => {
    if (replenishPromiseRef.current) return;
    const remaining = activeQueueRef.current.length - queueIndexRef.current;
    if (remaining < QUEUE_REPLENISH_THRESHOLD) {
      await replenishQueue();
    }
  }, [replenishQueue]);

  const hardFlushQueue = useCallback(
    (tracks: StationTrack[]) => {
      stationGenerationRef.current += 1;
      replenishPromiseRef.current = null;
      lastVideoIdRef.current = null;

      setActiveQueue([]);
      activeQueueRef.current = [];
      setQueueIndex(0);
      queueIndexRef.current = 0;

      const shuffled = avoidBackToBackShuffle(
        filterPoolForStation(shuffleTracks(tracks)),
        playedHistoryRef.current[0],
      );
      if (shuffled.length === 0) return;

      let startIndex = randomTrackIndex(shuffled.length);
      const lastPlayedId = playedHistoryRef.current[0];
      if (
        lastPlayedId &&
        shuffled.length > 1 &&
        shuffled[startIndex]?.youtubeId === lastPlayedId
      ) {
        const alternateIndex = shuffled.findIndex(
          (track, index) => index !== startIndex && track.youtubeId !== lastPlayedId,
        );
        if (alternateIndex >= 0) startIndex = alternateIndex;
      }

      setActiveQueue(shuffled);
      setQueueIndex(startIndex);
      activeQueueRef.current = shuffled;
      queueIndexRef.current = startIndex;

      const first = shuffled[startIndex];
      if (isValidTrack(first)) {
        notifyQueueTrack(first);
      }

      void replenishQueue();
    },
    [notifyQueueTrack, replenishQueue, filterPoolForStation],
  );

  const handleNextTrack = useCallback(async () => {
    if (!stationQueueModeRef.current) return;

    if (activeQueueRef.current.length === 0 && !restoreQueueFromStationTracks()) {
      logPlayback("advanceHalted", { reason: "emptyQueueNoFallback" });
      return;
    }

    const currentIndex = queueIndexRef.current;

    await ensureQueueReplenished();

    let nextIndex = currentIndex + 1;
    let updatedQueue = activeQueueRef.current;

    if (nextIndex >= updatedQueue.length) {
      await replenishQueue();
      updatedQueue = activeQueueRef.current;
    }

    if (nextIndex >= updatedQueue.length) {
      applyReplenishmentFallback();
      updatedQueue = activeQueueRef.current;
    }

    if (nextIndex >= updatedQueue.length) {
      nextIndex = 0; // Safely wrap to start of queue
    }

    if (updatedQueue.length === 0) {
      logPlayback("advanceHalted", { reason: "emptyQueueAfterReplenish" });
      return;
    }

    const track = updatedQueue[nextIndex];
    if (!applyQueueIndex(track, nextIndex)) {
      if (errorSkipDepthRef.current >= MAX_ERROR_SKIP_DEPTH) {
        logPlayback("advanceHalted", { reason: "maxSkipDepth", nextIndex });
        errorSkipDepthRef.current = 0;
        return;
      }
      errorSkipDepthRef.current += 1;
      await handleNextTrackRef.current();
      return;
    }

    errorSkipDepthRef.current = 0;
  }, [
    applyQueueIndex,
    applyReplenishmentFallback,
    ensureQueueReplenished,
    replenishQueue,
    restoreQueueFromStationTracks,
  ]);

  handleNextTrackRef.current = handleNextTrack;

  const advanceQueue = useCallback(
    async (direction: "next" | "prev") => {
      if (!stationQueueModeRef.current) return;

      if (activeQueueRef.current.length === 0 && !restoreQueueFromStationTracks()) {
        logPlayback("advanceHalted", { reason: "emptyQueueNoFallback", direction });
        return;
      }

      const currentQueue = activeQueueRef.current;
      const currentIndex = queueIndexRef.current;

      if (direction === "prev") {
        if (currentIndex <= 0) return;
        const prevIndex = currentIndex - 1;
        const track = currentQueue[prevIndex];
        applyQueueIndex(track, prevIndex);
        return;
      }

      await handleNextTrack();
    },
    [applyQueueIndex, handleNextTrack, restoreQueueFromStationTracks],
  );

  advanceQueueRef.current = advanceQueue;

  useEffect(() => {
    if (!stationQueueMode || stationTracksRef.current.length === 0) return;
    hardFlushQueue(stationTracksRef.current);
  }, [stationId, queueGeneration, stationQueueMode, hardFlushQueue]);

  const getTargetVolume = useCallback(() => {
    const multiplier = isDuckedRef.current ? 0.25 : 1;
    return Math.round(volumeRef.current * 100 * multiplier);
  }, []);

  const restoreFullVolume = useCallback(
    (reason: string) => {
      if (!playerRef.current || !readyRef.current) return;

      isDuckedRef.current = false;
      const player = playerRef.current;
      player.unMute();
      const targetVolume = Math.round(volumeRef.current * 100);
      player.setVolume(targetVolume);

      logPlayback("restoreFullVolume", {
        reason,
        targetVolume,
        masterVolume: volumeRef.current,
      });
    },
    [],
  );

  const ensureAudible = useCallback(
    (reason: string) => {
      if (!playerRef.current || !readyRef.current) return;

      const player = playerRef.current;
      const wasMuted = player.isMuted?.() ?? false;
      const beforeVolume = player.getVolume?.() ?? -1;

      player.unMute();
      const targetVolume = getTargetVolume();
      player.setVolume(targetVolume);

      logPlayback("ensureAudible", {
        reason,
        wasMuted,
        beforeVolume,
        targetVolume,
        masterVolume: volumeRef.current,
        isDucked: isDuckedRef.current,
        stationId: stationIdRef.current,
      });
    },
    [getTargetVolume],
  );

  const applyMasterVolume = useCallback(() => {
    if (!playerRef.current || !readyRef.current) return;
    const targetVolume = getTargetVolume();
    playerRef.current.unMute();
    playerRef.current.setVolume(targetVolume);
    logPlayback("applyMasterVolume", {
      targetVolume,
      masterVolume: volumeRef.current,
      isDucked: isDuckedRef.current,
    });
  }, [getTargetVolume]);

  const handleNewTrack = useCallback(
    async (videoId: string, title: string, author: string) => {
      if (lastVideoIdRef.current === videoId) return;
      lastVideoIdRef.current = videoId;

      logPlayback("trackChange", {
        videoId,
        title,
        artist: author,
        stationId: stationIdRef.current,
      });

      ensureAudible("trackChange");
      restoreFullVolume("trackChange");

      onTrackChange?.({ title, artist: author, youtubeId: videoId });
      recordPlayedId(videoId);
      addToPlayHistory({
        id: `${videoId}-${Date.now()}`,
        title,
        artist: author,
        stationId: stationIdRef.current,
        youtubeId: videoId,
      });

      const count = incrementSongCounter();
      const shouldDjIntro = count % djPacingRef.current === 0;

      logPlayback("djPacingCheck", {
        songCounter: count,
        djPacingFrequency: djPacingRef.current,
        shouldDjIntro,
      });

      if (!shouldDjIntro) {
        applyMasterVolume();
        return;
      }

      if (introRunningRef.current) return;

      introAbortRef.current?.abort();
      const controller = new AbortController();
      introAbortRef.current = controller;
      introRunningRef.current = true;
      isDuckedRef.current = true;

      try {
        await playDjIntro({
          songTitle: title,
          artistName: author,
          maxDurationInSeconds: maxDurationRef.current,
          personaId: personaIdRef.current,
          provider: ttsProviderRef.current,
          getMasterVolume: () => volumeRef.current,
          setPlayerVolume: (percent) => {
            playerRef.current?.unMute();
            playerRef.current?.setVolume(Math.round(percent));
            logPlayback("duckingVolume", { percent });
          },
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[SongGhost Audio] DJ intro failed:", error);
        }
      } finally {
        introRunningRef.current = false;
        isDuckedRef.current = false;
        restoreFullVolume("djIntroComplete");
        applyMasterVolume();
      }
    },
    [
      applyMasterVolume,
      ensureAudible,
      restoreFullVolume,
      incrementSongCounter,
      onTrackChange,
      addToPlayHistory,
      recordPlayedId,
    ],
  );

  const onPlayingState = useCallback(() => {
    if (!playerRef.current) return;

    try {
      const data = playerRef.current.getVideoData();
      const title = data.title || songTitleRef.current || "Unknown Track";
      const author = data.author || artistNameRef.current || "Unknown Artist";
      const videoId = data.video_id || singleVideoIdRef.current || "";
      if (videoId) {
        handleNewTrack(videoId, title, author);
      }
    } catch {
      if (singleVideoIdRef.current) {
        handleNewTrack(
          singleVideoIdRef.current,
          songTitleRef.current || "Unknown Track",
          artistNameRef.current || "Unknown Artist",
        );
      }
    }
  }, [handleNewTrack]);

  const loadSource = useCallback(
    (reason: string) => {
      if (!playerRef.current || !readyRef.current) return;

      lastVideoIdRef.current = null;
      introAbortRef.current?.abort();
      introRunningRef.current = false;
      isDuckedRef.current = false;

      ensureAudible(`beforeLoad:${reason}`);

      if (youtubePlaylistId) {
        logPlayback("loadPlaylist", { playlistId: youtubePlaylistId, reason });
        playerRef.current.loadPlaylist({
          listType: "playlist",
          list: youtubePlaylistId,
          index: 0,
          startSeconds: 0,
        });
      } else if (playbackYoutubeId) {
        logPlayback("loadVideoById", { videoId: playbackYoutubeId, reason });
        playerRef.current.loadVideoById(playbackYoutubeId, 0);
      } else {
        logPlayback("loadSkipped", { reason: "noVideoId", loadReason: reason });
        return;
      }

      if (isPlayingRef.current) {
        setTimeout(() => {
          restoreFullVolume(`afterLoad:${reason}`);
          playerRef.current?.playVideo();
          logPlayback("playAfterLoad", {
            reason,
            videoId: playbackYoutubeId,
            playlistId: youtubePlaylistId,
          });
        }, 250);
      }
    },
    [youtubePlaylistId, playbackYoutubeId, ensureAudible, restoreFullVolume],
  );

  useEffect(() => {
    lastVideoIdRef.current = null;
    introAbortRef.current?.abort();
    introRunningRef.current = false;
    isDuckedRef.current = false;
    setCurrentTime(0);
    setDuration(0);
    ensureAudible("stationOrSourceChange");
  }, [youtubePlaylistId, playbackYoutubeId, stationId, ensureAudible]);

  useEffect(() => {
    if (!readyRef.current || !isPlaying) return;

    const tick = () => {
      if (!playerRef.current || isScrubbingRef.current) return;
      try {
        const time = playerRef.current.getCurrentTime?.() ?? 0;
        const total = playerRef.current.getDuration?.() ?? 0;
        setCurrentTime(Number.isFinite(time) ? time : 0);
        if (Number.isFinite(total) && total > 0) {
          setDuration(total);
        }
      } catch {
        // Player not ready yet
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 500);
    return () => window.clearInterval(intervalId);
  }, [isPlaying, playbackYoutubeId, youtubePlaylistId, stationId]);

  useEffect(() => {
    loadYouTubeAPI();

    onAPIReady(() => {
      if (!containerRef.current || playerRef.current) return;

      const initialVideoId = singleVideoIdRef.current || "fJ9rUzIMcZQ";

      const playerVars: Record<string, number | string> = {
        autoplay: 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        fs: 0,
        disablekb: 1,
        enablejsapi: 1,
        origin: window.location.origin,
      };

      playerRef.current = new window.YT!.Player(containerRef.current, {
        videoId: initialVideoId,
        playerVars,
        events: {
          onReady: () => {
            readyRef.current = true;
            ensureAudible("onReady");
            loadSource("onReady");
          },
          onStateChange: (event) => {
            const { ENDED, PLAYING, PAUSED, CUED, BUFFERING } = window.YT!.PlayerState;

            logPlayback("stateChange", {
              state: event.data,
              stateLabel: {
                [-1]: "UNSTARTED",
                0: "ENDED",
                1: "PLAYING",
                2: "PAUSED",
                3: "BUFFERING",
                5: "CUED",
              }[event.data] ?? event.data,
              videoId: singleVideoIdRef.current,
              isPlaying: isPlayingRef.current,
            });

            if (event.data === ENDED) {
              if (stationQueueModeRef.current) {
                lastVideoIdRef.current = null;
                void handleNextTrackRef.current();
              } else {
                onEnded?.();
              }
            }
            if (event.data === CUED && isPlayingRef.current) {
              ensureAudible("cued");
              playerRef.current?.playVideo();
            }
            if (event.data === PLAYING) {
              errorSkipDepthRef.current = 0;
              ensureAudible("playing");
              onPlayingChange?.(true);
              onPlayingState();
            }
            if (event.data === PAUSED) {
              onPlayingChange?.(false);
            }
            if (event.data === BUFFERING) {
              ensureAudible("buffering");
            }
          },
          onError: (event) => {
            const errorLabels: Record<number, string> = {
              2: "invalidParameter",
              5: "html5Error",
              100: "videoNotFound",
              101: "embedNotAllowed",
              150: "embedNotAllowed",
            };
            logPlayback("playerError", {
              code: event.data,
              label: errorLabels[event.data] ?? "unknown",
              videoId: singleVideoIdRef.current,
              stationId: stationIdRef.current,
            });
            if (stationQueueModeRef.current) {
              if (errorSkipDepthRef.current >= MAX_ERROR_SKIP_DEPTH) {
                logPlayback("advanceHalted", { reason: "maxErrorSkipDepthReached" });
                return;
              }
              lastVideoIdRef.current = null;
              setTimeout(() => {
                void handleNextTrackRef.current();
              }, 500);
            }
          },
        },
      });
    });

    return () => {
      introAbortRef.current?.abort();
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!readyRef.current) return;
    loadSource("sourcePropChange");
  }, [youtubePlaylistId, playbackYoutubeId, loadSource]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    if (isPlaying) {
      ensureAudible("isPlayingTrue");
      playerRef.current.playVideo();
      logPlayback("playVideo", { videoId: playbackYoutubeId, playlistId: youtubePlaylistId });
    } else {
      playerRef.current.pauseVideo();
      logPlayback("pauseVideo", {});
    }
  }, [isPlaying, playbackYoutubeId, youtubePlaylistId, ensureAudible]);

  useEffect(() => {
    applyMasterVolume();
  }, [volume, applyMasterVolume]);

  useImperativeHandle(ref, () => ({
    skipNext: () => {
      if (stationQueueModeRef.current) {
        lastVideoIdRef.current = null;
        restoreFullVolume("skipNext");
        void handleNextTrackRef.current();
        logPlayback("skipNext", { mode: "stationQueue" });
        return;
      }
      lastVideoIdRef.current = null;
      restoreFullVolume("skipNext");
      playerRef.current?.nextVideo();
      logPlayback("skipNext", { mode: "native" });
    },
    skipPrev: () => {
      if (stationQueueModeRef.current) {
        lastVideoIdRef.current = null;
        restoreFullVolume("skipPrev");
        void advanceQueue("prev");
        logPlayback("skipPrev", { mode: "stationQueue" });
        return;
      }
      lastVideoIdRef.current = null;
      restoreFullVolume("skipPrev");
      playerRef.current?.previousVideo();
      logPlayback("skipPrev", { mode: "native" });
    },
  }));

  const handleSeek = (value: number) => {
    if (!playerRef.current || !readyRef.current || duration <= 0) return;
    playerRef.current.seekTo(value, true);
    setCurrentTime(value);
  };

  return (
    <>
      <div ref={containerRef} className="hidden" aria-hidden="true" />
      <div className="song-progress w-full max-w-full min-w-0 overflow-hidden space-y-1">
        <div className="flex items-center justify-between text-[10px] sm:text-xs tabular-nums text-amber-200/70">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div className="relative w-full max-w-full overflow-hidden rounded-full">
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 1}
            step={0.5}
            value={duration > 0 ? currentTime : 0}
            disabled={duration <= 0}
            onPointerDown={() => {
              isScrubbingRef.current = true;
            }}
            onPointerUp={() => {
              isScrubbingRef.current = false;
            }}
            onChange={(event) => handleSeek(Number(event.target.value))}
            className="song-progress-slider block w-full max-w-full"
            aria-label="Song progress"
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          />
        </div>
      </div>
    </>
  );
});
