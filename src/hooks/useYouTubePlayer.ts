"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
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
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            if (videoIdRef.current) {
              loadedVideoIdRef.current = videoIdRef.current;
            }
            const player = playerRef.current;
            if (!player) return;
            player.unMute();
            player.setVolume(Math.round(volumeRef.current * 100));
            if (isPlayingRef.current) {
              player.playVideo();
            }
          },
          onStateChange: (event) => {
            if (event.data === window.YT!.PlayerState.PLAYING) {
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
  }, [containerRef]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current || !videoId) return;
    if (loadedVideoIdRef.current === videoId) return;

    loadingVideoRef.current = true;
    lastErrorAtRef.current = 0;
    loadedVideoIdRef.current = videoId;
    playerRef.current.loadVideoById(videoId, 0);
    setCurrentTime(0);
    setDuration(0);

    const shouldPlay = isPlayingRef.current;
    if (shouldPlay) {
      playerRef.current.playVideo();
      window.setTimeout(() => {
        if (playerRef.current && isPlayingRef.current && loadedVideoIdRef.current === videoId) {
          playerRef.current.playVideo();
        }
        loadingVideoRef.current = false;
      }, 400);
    } else {
      loadingVideoRef.current = false;
    }
  }, [videoId]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    if (isPlaying) {
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    playerRef.current.unMute();
    playerRef.current.setVolume(Math.round(volume * 100));
  }, [volume]);

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
    if (!playerRef.current || !readyRef.current) return;
    playerRef.current.unMute();
    playerRef.current.setVolume(Math.round(percent));
  }, []);

  return { currentTime, duration, seekTo, setPlayerVolume };
}
