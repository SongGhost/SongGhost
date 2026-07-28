"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
  isMuted: () => boolean;
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
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading = false;
let apiReady = false;
const readyCallbacks: Array<() => void> = [];
const ERROR_COOLDOWN_MS = 2000;

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
  const isPlayingRef = useRef(isPlaying);
  const videoIdRef = useRef(videoId);
  const volumeRef = useRef(volume);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onPausedRef = useRef(onPaused);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  isPlayingRef.current = isPlaying;
  videoIdRef.current = videoId;
  volumeRef.current = volume;
  onEndedRef.current = onEnded;
  onErrorRef.current = onError;
  onPlayingRef.current = onPlaying;
  onPausedRef.current = onPaused;

  const syncPlayerAudio = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    const level = Math.round(volumeRef.current * 100);
    player.unMute();
    player.setVolume(level);
  }, []);

  const unlockAudio = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    syncPlayerAudio();
    if (isPlayingRef.current) {
      player.playVideo();
    }
  }, [syncPlayerAudio]);

  const loadVideo = useCallback(
    (nextVideoId: string, autoplay: boolean) => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return false;
      if (loadedVideoIdRef.current === nextVideoId) return true;

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
            syncPlayerAudio();
            playerRef.current.playVideo();
          }
          loadingVideoRef.current = false;
        }, 400);
      } else {
        loadingVideoRef.current = false;
      }

      return true;
    },
    [syncPlayerAudio],
  );

  useEffect(() => {
    loadYouTubeAPI();

    onAPIReady(() => {
      if (!containerRef.current || playerRef.current) return;

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
            if (videoIdRef.current) {
              if (loadedVideoIdRef.current !== videoIdRef.current) {
                loadVideo(videoIdRef.current, isPlayingRef.current);
              }
            } else {
              syncPlayerAudio();
              if (isPlayingRef.current) {
                playerRef.current?.playVideo();
              }
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

              if (player?.isMuted?.()) {
                player.pauseVideo();
                onPausedRef.current?.();
                return;
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
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
      loadedVideoIdRef.current = null;
    };
  }, [containerRef, loadVideo, syncPlayerAudio]);

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
    if (!readyRef.current || !playerRef.current) return;
    if (isPlaying) {
      syncPlayerAudio();
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [isPlaying, syncPlayerAudio]);

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

  const seekTo = useCallback((seconds: number) => {
    if (!playerRef.current || !readyRef.current) return;
    playerRef.current.seekTo(seconds, true);
    setCurrentTime(seconds);
  }, []);

  const setPlayerVolume = useCallback((percent: number) => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    player.unMute();
    player.setVolume(Math.round(percent));
  }, []);

  return { currentTime, duration, seekTo, setPlayerVolume, unlockAudio };
}
