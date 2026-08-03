"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  isAudioUnlockPending,
  markAudioUnlockRequested,
} from "@/lib/audio-unlock";
import { musicGain, UNDUCKED_GAIN } from "@/lib/audio/mix-bus";

const UNLOCK_RETRY_MS = 400;
const UNLOCK_RETRY_MAX = 60;

export function usePreviewPlayer({
  previewUrl,
  isPlaying,
  volume,
  duckGainRef,
  onEnded,
  onError,
  onPlaying,
  onPaused,
}: {
  previewUrl?: string;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const volumeRef = useRef(volume);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onPausedRef = useRef(onPaused);
  const pendingUnlockRef = useRef(false);
  const unlockRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopUnlockRetry = useCallback(() => {
    if (unlockRetryRef.current) {
      clearInterval(unlockRetryRef.current);
      unlockRetryRef.current = null;
    }
  }, []);

  /**
   * Re-asserts the music channel level. Safe to call at any time, including
   * mid-break, because the duck gain is folded in rather than skipped.
   */
  const syncVolume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = musicGain(volumeRef.current, duckGainRef?.current ?? UNDUCKED_GAIN);
  }, [duckGainRef]);

  const applyUnlock = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return false;
    syncVolume();
    if (isPlayingRef.current) {
      void audio.play().catch(() => onErrorRef.current?.());
    }
    const playing = !audio.paused && !audio.ended;
    if (playing) {
      pendingUnlockRef.current = false;
      stopUnlockRetry();
    }
    return playing;
  }, [syncVolume, stopUnlockRetry]);

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
      if (unlocked || (attempts >= UNLOCK_RETRY_MAX && !isAudioUnlockPending())) {
        stopUnlockRetry();
      }
    }, UNLOCK_RETRY_MS);
  }, [applyUnlock, stopUnlockRetry]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  isPlayingRef.current = isPlaying;
  volumeRef.current = volume;
  onEndedRef.current = onEnded;
  onErrorRef.current = onError;
  onPlayingRef.current = onPlaying;
  onPausedRef.current = onPaused;

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioRef.current = null;
    urlRef.current = null;
  }, []);

  useEffect(() => {
    if (!previewUrl?.trim()) {
      stopAudio();
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (urlRef.current === previewUrl && audioRef.current) return;

    stopAudio();
    const audio = new Audio(previewUrl);
    audio.preload = "auto";
    audioRef.current = audio;
    urlRef.current = previewUrl;
    syncVolume();

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };

    const onEndedHandler = () => {
      onEndedRef.current?.();
    };

    const onErrorHandler = () => {
      console.error("[usePreviewPlayer] Preview playback error");
      onErrorRef.current?.();
    };

    const onPlayHandler = () => {
      syncVolume();
      onPlayingRef.current?.();
    };
    const onPauseHandler = () => {
      if (!audio.ended) onPausedRef.current?.();
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEndedHandler);
    audio.addEventListener("error", onErrorHandler);
    audio.addEventListener("play", onPlayHandler);
    audio.addEventListener("pause", onPauseHandler);

    if (isPlayingRef.current || pendingUnlockRef.current) {
      void audio.play().catch(() => onErrorRef.current?.());
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEndedHandler);
      audio.removeEventListener("error", onErrorHandler);
      audio.removeEventListener("play", onPlayHandler);
      audio.removeEventListener("pause", onPauseHandler);
      stopAudio();
    };
  }, [previewUrl, stopAudio, syncVolume]);

  useEffect(() => {
    syncVolume();
  }, [volume, syncVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      void audio.play().catch(() => onErrorRef.current?.());
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const unlockAudio = useCallback(() => {
    markAudioUnlockRequested();
    pendingUnlockRef.current = true;
    const unlocked = applyUnlock();
    if (!unlocked) startUnlockRetry();
  }, [applyUnlock, startUnlockRetry]);

  const pausePlayback = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const playFromStart = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    syncVolume();
    if (isPlayingRef.current) {
      void audio.play().catch(() => onErrorRef.current?.());
    }
  }, [syncVolume]);

  useEffect(() => () => stopUnlockRetry(), [stopUnlockRetry]);

  return {
    currentTime,
    duration,
    seekTo,
    syncVolume,
    unlockAudio,
    isPreviewMode: Boolean(previewUrl?.trim()),
    pausePlayback,
    playFromStart,
  };
}
