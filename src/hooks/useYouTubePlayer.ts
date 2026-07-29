"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  clearAudioUnlockRequest,
  isAudioUnlockPending,
  markAudioUnlockRequested,
} from "@/lib/audio-unlock";

type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
  isMuted: () => boolean;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
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
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
        UNSTARTED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading = false;
let apiReady = false;
const readyCallbacks: Array<() => void> = [];
const ERROR_COOLDOWN_MS = 2000;
const UNLOCK_RETRY_MS = 400;
const UNLOCK_RETRY_MAX = 12;

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

export function useYouTubePlayer({
  containerRef,
  videoId,
  isPlaying,
  volume,
  onEnded,
  onError,
  onPlaying,
  onPaused,
}: {
  containerRef: RefObject<HTMLElement | null>;
  videoId?: string;
  isPlaying: boolean;
  volume: number;
  onEnded?: () => void;
  onError?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
}) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const loadedVideoIdRef = useRef<string | null>(null);
  const lastErrorAtRef = useRef(0);
  const loadingVideoRef = useRef(false);
  const unlockRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const videoIdRef = useRef(videoId);
  const volumeRef = useRef(volume);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onPausedRef = useRef(onPaused);
  const pendingUnlockRef = useRef(isAudioUnlockPending());

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);

  isPlayingRef.current = isPlaying;
  videoIdRef.current = videoId;
  volumeRef.current = volume;
  onEndedRef.current = onEnded;
  onErrorRef.current = onError;
  onPlayingRef.current = onPlaying;
  onPausedRef.current = onPaused;

  const stopUnlockRetry = useCallback(() => {
    if (unlockRetryRef.current) {
      clearInterval(unlockRetryRef.current);
      unlockRetryRef.current = null;
    }
  }, []);

  const syncPlayerAudio = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    const level = Math.max(1, Math.round(volumeRef.current * 100));
    player.unMute();
    player.setVolume(level);
  }, []);

  const applyUnlock = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return false;

    syncPlayerAudio();
    player.unMute();
    syncPlayerAudio();

    if (isPlayingRef.current) {
      player.playVideo();
    }

    const stillMuted = player.isMuted?.() ?? false;
    if (!stillMuted) {
      pendingUnlockRef.current = false;
      clearAudioUnlockRequest();
      stopUnlockRetry();
    }
    return !stillMuted;
  }, [syncPlayerAudio, stopUnlockRetry]);

  const startUnlockRetry = useCallback(() => {
    if (unlockRetryRef.current) return;
    let attempts = 0;

    unlockRetryRef.current = setInterval(() => {
      attempts += 1;
      if (!pendingUnlockRef.current && !isAudioUnlockPending()) {
        stopUnlockRetry();
        return;
      }
      pendingUnlockRef.current = true;
      const unlocked = applyUnlock();
      if (unlocked || attempts >= UNLOCK_RETRY_MAX) {
        stopUnlockRetry();
      }
    }, UNLOCK_RETRY_MS);
  }, [applyUnlock, stopUnlockRetry]);

  const unlockAudio = useCallback(() => {
    markAudioUnlockRequested();
    pendingUnlockRef.current = true;
    const unlocked = applyUnlock();
    if (!unlocked) startUnlockRetry();
  }, [applyUnlock, startUnlockRetry]);

  const ensurePlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current || !videoIdRef.current) return;

    syncPlayerAudio();

    if (!isPlayingRef.current) return;

    const state = player.getPlayerState?.();
    const YT = window.YT?.PlayerState;
    const needsPlay =
      state === YT?.PAUSED ||
      state === YT?.CUED ||
      state === YT?.UNSTARTED ||
      state === undefined;

    if (needsPlay) {
      player.playVideo();
    }

    if (pendingUnlockRef.current || isAudioUnlockPending()) {
      applyUnlock();
    }
  }, [syncPlayerAudio, applyUnlock]);

  const loadVideo = useCallback(
    (nextVideoId: string, autoplay: boolean) => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return false;

      if (loadedVideoIdRef.current === nextVideoId) {
        if (autoplay) ensurePlayback();
        return true;
      }

      loadingVideoRef.current = true;
      lastErrorAtRef.current = 0;
      loadedVideoIdRef.current = nextVideoId;
      player.loadVideoById(nextVideoId, 0);
      syncPlayerAudio();
      setCurrentTime(0);
      setDuration(0);

      if (autoplay) {
        player.playVideo();
        window.setTimeout(() => {
          if (playerRef.current && isPlayingRef.current && loadedVideoIdRef.current === nextVideoId) {
            ensurePlayback();
          }
          loadingVideoRef.current = false;
        }, 400);
      } else {
        loadingVideoRef.current = false;
      }

      return true;
    },
    [syncPlayerAudio, ensurePlayback],
  );

  useEffect(() => {
    loadYouTubeAPI();

    onAPIReady(() => {
      if (!containerRef.current || playerRef.current) return;

      if (isAudioUnlockPending()) {
        pendingUnlockRef.current = true;
      }

      playerRef.current = new window.YT!.Player(containerRef.current, {
        videoId: videoIdRef.current || undefined,
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          disablekb: 1,
          enablejsapi: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            setPlayerReady(true);

            if (videoIdRef.current) {
              if (loadedVideoIdRef.current !== videoIdRef.current) {
                loadVideo(videoIdRef.current, isPlayingRef.current);
              } else {
                ensurePlayback();
              }
            } else {
              syncPlayerAudio();
              if (isPlayingRef.current) {
                playerRef.current?.playVideo();
              }
            }

            if (pendingUnlockRef.current || isAudioUnlockPending()) {
              pendingUnlockRef.current = true;
              if (!applyUnlock()) startUnlockRetry();
            }
          },
          onStateChange: (event) => {
            if (event.data === window.YT!.PlayerState.PLAYING) {
              syncPlayerAudio();

              const player = playerRef.current;
              if (player?.isMuted?.()) {
                player.unMute();
                syncPlayerAudio();
              }

              if (pendingUnlockRef.current || isAudioUnlockPending()) {
                applyUnlock();
              }

              onPlayingRef.current?.();
            }
            if (event.data === window.YT!.PlayerState.PAUSED) {
              if (!loadingVideoRef.current) {
                onPausedRef.current?.();
              }
            }
            if (event.data === window.YT!.PlayerState.ENDED) {
              onEndedRef.current?.();
            }
          },
          onError: (event) => {
            const now = Date.now();
            if (now - lastErrorAtRef.current < ERROR_COOLDOWN_MS) return;
            lastErrorAtRef.current = now;
            console.error("[useYouTubePlayer] Player error:", event.data);
            onErrorRef.current?.();
          },
        },
      });
    });

    return () => {
      stopUnlockRetry();
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
      setPlayerReady(false);
      loadedVideoIdRef.current = null;
    };
  }, [
    containerRef,
    loadVideo,
    syncPlayerAudio,
    applyUnlock,
    ensurePlayback,
    startUnlockRetry,
    stopUnlockRetry,
  ]);

  useEffect(() => {
    if (!videoId) return;

    if (loadVideo(videoId, isPlayingRef.current)) return;

    const intervalId = window.setInterval(() => {
      if (loadVideo(videoId, isPlayingRef.current)) {
        window.clearInterval(intervalId);
      }
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [videoId, loadVideo]);

  useEffect(() => {
    if (!playerReady) return;
    if (isPlaying) {
      ensurePlayback();
      if (pendingUnlockRef.current || isAudioUnlockPending()) {
        if (!applyUnlock()) startUnlockRetry();
      }
    } else {
      playerRef.current?.pauseVideo();
    }
  }, [isPlaying, playerReady, ensurePlayback, applyUnlock, startUnlockRetry]);

  useEffect(() => {
    if (!playerReady || !isPlaying || !videoId) return;
    ensurePlayback();
  }, [playerReady, isPlaying, videoId, ensurePlayback]);

  useEffect(() => {
    syncPlayerAudio();
  }, [volume, syncPlayerAudio]);

  useEffect(() => {
    if (!isPlaying) return;

    const tick = () => {
      if (!playerRef.current || !readyRef.current) return;
      try {
        const time = playerRef.current.getCurrentTime() ?? 0;
        const total = playerRef.current.getDuration() ?? 0;
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
  }, [isPlaying, videoId]);

  useEffect(() => () => stopUnlockRetry(), [stopUnlockRetry]);

  const seekTo = useCallback((seconds: number) => {
    if (!playerRef.current || !readyRef.current) return;
    playerRef.current.seekTo(seconds, true);
    setCurrentTime(seconds);
  }, []);

  const setPlayerVolume = useCallback((percent: number) => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    player.unMute();
    player.setVolume(Math.round(Math.max(1, percent)));
  }, []);

  return { currentTime, duration, seekTo, setPlayerVolume, unlockAudio, playerReady };
}
