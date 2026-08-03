"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  clearAudioUnlockRequest,
  isAudioUnlockPending,
  markAudioUnlockRequested,
} from "@/lib/audio-unlock";
import { musicVolumePercent, UNDUCKED_GAIN } from "@/lib/audio/mix-bus";

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
  element: HTMLElement | string,
  config: {
    videoId?: string;
    width?: string | number;
    height?: string | number;
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
const UNLOCK_RETRY_MAX = 30;
const LOAD_SETTLE_MS = 600;
/** `setVolume(0)` fights the unMute path on some embeds, so never floor to zero. */
const MIN_PLAYER_PERCENT = 1;

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

function unlockNeeded(): boolean {
  return isAudioUnlockPending();
}

export function useYouTubePlayer({
  wrapperRef,
  videoId,
  isPlaying,
  volume,
  duckGainRef,
  onEnded,
  onError,
  onPlaying,
  onPaused,
}: {
  /** Stable outer wrapper — React manages this; we imperatively add a mount child. */
  wrapperRef: RefObject<HTMLElement | null>;
  videoId?: string;
  isPlaying: boolean;
  volume: number;
  /**
   * Live sidechain duck gain for the music channel (1 = unducked). Folded into
   * every volume sync so a re-assert during a DJ break lands on the ducked
   * level instead of having to be skipped.
   */
  duckGainRef?: RefObject<number>;
  onEnded?: () => void;
  onError?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
}) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const mountRef = useRef<HTMLElement | null>(null);
  const readyRef = useRef(false);
  const loadedVideoIdRef = useRef<string | null>(null);
  const lastErrorAtRef = useRef(0);
  const loadingVideoRef = useRef(false);
  const loadStartedAtRef = useRef(0);
  const loadTokenRef = useRef(0);
  const unlockRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingUnlockRef = useRef(isAudioUnlockPending());
  const awaitingCleanStartRef = useRef(false);
  const onPlayingEmittedRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  const videoIdRef = useRef(videoId);
  const volumeRef = useRef(volume);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onPausedRef = useRef(onPaused);

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

  /**
   * Re-asserts the music channel level on the player. Safe to call at any time,
   * including mid-break: loading a video resets the embed to 100%, so every
   * ready / load / PLAYING transition has to push the context volume back or
   * the new track plays at full blast while the fader still reads low.
   */
  const syncPlayerAudio = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    const percent = musicVolumePercent(volumeRef.current, duckGainRef?.current ?? UNDUCKED_GAIN);
    player.unMute();
    player.setVolume(Math.max(MIN_PLAYER_PERCENT, percent));
  }, [duckGainRef]);

  const tryEmitOnPlaying = useCallback(() => {
    if (onPlayingEmittedRef.current) return;
    if (loadingVideoRef.current) return;
    if (pendingUnlockRef.current || unlockNeeded()) return;

    onPlayingEmittedRef.current = true;
    onPlayingRef.current?.();
  }, []);

  const beginPlaybackFromStart = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;

    awaitingCleanStartRef.current = false;

    try {
      player.seekTo(0, true);
      setCurrentTime(0);
    } catch {
      // Player not ready yet
    }

    syncPlayerAudio();

    if (isPlayingRef.current) {
      player.playVideo();
    }

    tryEmitOnPlaying();
  }, [syncPlayerAudio, tryEmitOnPlaying]);

  const applyUnlock = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return false;

    syncPlayerAudio();
    player.unMute();
    syncPlayerAudio();

    const stillMuted = player.isMuted?.() ?? false;
    const state = player.getPlayerState?.();
    const YT = window.YT?.PlayerState;
    const isPlayingState = state === YT?.PLAYING || state === YT?.BUFFERING;

    if (!stillMuted && (isPlayingState || state === YT?.CUED || state === YT?.PAUSED)) {
      pendingUnlockRef.current = false;
      clearAudioUnlockRequest();
      stopUnlockRetry();
    }

    if (isPlayingRef.current) {
      if (awaitingCleanStartRef.current) {
        beginPlaybackFromStart();
      } else if (
        state === YT?.PAUSED ||
        state === YT?.CUED ||
        state === YT?.UNSTARTED ||
        state === undefined
      ) {
        player.playVideo();
        tryEmitOnPlaying();
      } else {
        tryEmitOnPlaying();
      }
    }

    return !stillMuted;
  }, [syncPlayerAudio, stopUnlockRetry, beginPlaybackFromStart, tryEmitOnPlaying]);

  const startUnlockRetry = useCallback(() => {
    if (unlockRetryRef.current) return;
    let attempts = 0;

    unlockRetryRef.current = setInterval(() => {
      attempts += 1;
      if (!pendingUnlockRef.current && !unlockNeeded()) {
        stopUnlockRetry();
        tryEmitOnPlaying();
        return;
      }
      pendingUnlockRef.current = true;
      applyUnlock();
      if (attempts >= UNLOCK_RETRY_MAX) {
        pendingUnlockRef.current = false;
        clearAudioUnlockRequest();
        stopUnlockRetry();
        if (awaitingCleanStartRef.current) {
          beginPlaybackFromStart();
        } else {
          tryEmitOnPlaying();
        }
      }
    }, UNLOCK_RETRY_MS);
  }, [applyUnlock, stopUnlockRetry, beginPlaybackFromStart, tryEmitOnPlaying]);

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

    if (pendingUnlockRef.current || unlockNeeded()) {
      if (awaitingCleanStartRef.current) {
        try {
          player.pauseVideo();
        } catch {
          // Player not ready yet
        }
      }
      applyUnlock();
      return;
    }

    if (awaitingCleanStartRef.current) {
      beginPlaybackFromStart();
      return;
    }

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

    tryEmitOnPlaying();
  }, [syncPlayerAudio, applyUnlock, beginPlaybackFromStart, tryEmitOnPlaying]);

  const loadVideo = useCallback(
    (nextVideoId: string, autoplay: boolean) => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return false;

      if (loadedVideoIdRef.current === nextVideoId && !awaitingCleanStartRef.current) {
        if (autoplay) ensurePlayback();
        return true;
      }

      const loadToken = ++loadTokenRef.current;
      loadingVideoRef.current = true;
      loadStartedAtRef.current = Date.now();
      onPlayingEmittedRef.current = false;
      awaitingCleanStartRef.current = true;
      lastErrorAtRef.current = 0;
      loadedVideoIdRef.current = nextVideoId;

      player.loadVideoById(nextVideoId, 0);
      syncPlayerAudio();
      setCurrentTime(0);
      setDuration(0);

      const needsUnlock = pendingUnlockRef.current || unlockNeeded();

      if (autoplay && !needsUnlock) {
        player.playVideo();
      } else {
        try {
          player.pauseVideo();
        } catch {
          // Player not ready yet
        }
      }

      window.setTimeout(() => {
        if (loadTokenRef.current !== loadToken) return;
        loadingVideoRef.current = false;
        // The embed applies its own 100% default once the new module goes live,
        // which lands after the synchronous sync above.
        syncPlayerAudio();
        if (autoplay) ensurePlayback();
      }, LOAD_SETTLE_MS);

      return true;
    },
    [syncPlayerAudio, ensurePlayback],
  );

  // Create the YouTube player once on an imperative mount node inside wrapperRef.
  useEffect(() => {
    loadYouTubeAPI();

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let cancelled = false;

    const mount = document.createElement("div");
    mount.className = "yt-player-mount";
    wrapper.appendChild(mount);
    mountRef.current = mount;

    onAPIReady(() => {
      if (cancelled || playerRef.current) return;

      if (unlockNeeded()) {
        pendingUnlockRef.current = true;
      }

      playerRef.current = new window.YT!.Player(mount, {
        width: "320",
        height: "180",
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
            if (cancelled) return;
            readyRef.current = true;
            setPlayerReady(true);

            if (videoIdRef.current) {
              loadVideo(videoIdRef.current, isPlayingRef.current);
            } else {
              syncPlayerAudio();
            }

            if (pendingUnlockRef.current || unlockNeeded()) {
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

              if (pendingUnlockRef.current || unlockNeeded()) {
                applyUnlock();
                return;
              }

              if (!loadingVideoRef.current) {
                tryEmitOnPlaying();
              }
            }
            if (event.data === window.YT!.PlayerState.PAUSED) {
              if (!loadingVideoRef.current && !awaitingCleanStartRef.current) {
                onPausedRef.current?.();
              }
            }
            if (event.data === window.YT!.PlayerState.ENDED) {
              onEndedRef.current?.();
            }
          },
          onError: (event) => {
            const code = event.data;
            const elapsed = Date.now() - loadStartedAtRef.current;

            if (loadingVideoRef.current) return;
            if (code === 2 && elapsed < 2500) return;

            const now = Date.now();
            if (now - lastErrorAtRef.current < ERROR_COOLDOWN_MS) return;
            lastErrorAtRef.current = now;
            console.warn("[useYouTubePlayer] Skipping unplayable video:", code);
            onErrorRef.current?.();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      stopUnlockRetry();
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
      setPlayerReady(false);
      loadedVideoIdRef.current = null;
      awaitingCleanStartRef.current = false;
      onPlayingEmittedRef.current = false;
      mount.remove();
      mountRef.current = null;
    };
    // wrapperRef is stable for the lifetime of AudioPlayer — init once only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapperRef]);

  useEffect(() => {
    if (!videoId) {
      loadedVideoIdRef.current = null;
      loadingVideoRef.current = false;
      awaitingCleanStartRef.current = false;
      onPlayingEmittedRef.current = false;
      playerRef.current?.pauseVideo();
      return;
    }

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
      if (pendingUnlockRef.current || unlockNeeded()) {
        if (!applyUnlock()) startUnlockRetry();
      }
    } else {
      playerRef.current?.pauseVideo();
    }
  }, [isPlaying, playerReady, ensurePlayback, applyUnlock, startUnlockRetry]);

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

  const pausePlayback = useCallback(() => {
    playerRef.current?.pauseVideo();
  }, []);

  const playFromStart = useCallback(() => {
    beginPlaybackFromStart();
  }, [beginPlaybackFromStart]);

  return {
    currentTime,
    duration,
    seekTo,
    syncVolume: syncPlayerAudio,
    unlockAudio,
    playerReady,
    pausePlayback,
    playFromStart,
  };
}
