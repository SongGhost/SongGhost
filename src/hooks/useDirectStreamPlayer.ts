"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectStreamProvider, type LaunchHoldMode } from "@/lib/audio/DirectStreamProvider";
import { trackFromProviderId } from "@/lib/audio/TrackProvider";
import {
  postPlayLog,
  shouldCommitPerformance,
  type RouPerformancePayload,
} from "@/lib/rou/performance-commit";

/**
 * React binding for {@link DirectStreamProvider}, the live music transport.
 * Mirrors `usePreviewPlayer` / `useYouTubePlayer`: the provider owns playback;
 * the hook only wires props and render state through stable refs.
 */
export function useDirectStreamPlayer({
  streamUrl,
  title,
  artist,
  isPlaying,
  volume,
  onEnded,
  onError,
  onPlaying,
  onPaused,
  performanceCommit,
  onIsrcResolved,
}: {
  streamUrl?: string;
  /** Queue-row title passed into DirectStream `load()` for metadata gating. */
  title?: string;
  /** Queue-row artist passed into DirectStream `load()` for metadata gating. */
  artist?: string;
  isPlaying: boolean;
  volume: number;
  onEnded?: () => void;
  onError?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
  /** Statutory ROU payload. Omit for preview-only / companion sessions. */
  performanceCommit?: RouPerformancePayload | null;
  onIsrcResolved?: (isrc: string) => void;
}) {
  const providerRef = useRef<DirectStreamProvider | null>(null);
  if (!providerRef.current) providerRef.current = new DirectStreamProvider();
  const provider = providerRef.current;

  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onPausedRef = useRef(onPaused);
  const performanceCommitRef = useRef(performanceCommit);
  const onIsrcResolvedRef = useRef(onIsrcResolved);
  const committedSessionIdRef = useRef<string | null>(null);

  onEndedRef.current = onEnded;
  onErrorRef.current = onError;
  onPlayingRef.current = onPlaying;
  onPausedRef.current = onPaused;
  performanceCommitRef.current = performanceCommit;
  onIsrcResolvedRef.current = onIsrcResolved;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    provider.setEventHandlers({
      onTimeUpdate: (position, total) => {
        setCurrentTime(position);
        setDuration(total);

        const payload = performanceCommitRef.current;
        if (
          !shouldCommitPerformance({
            position,
            playbackState: provider.getPlaybackState(),
            playSessionId: payload?.playSessionId,
            committedSessionId: committedSessionIdRef.current,
            licensedStreamUrl: payload?.streamUrl,
          }) ||
          !payload
        ) {
          return;
        }

        // Mark first so pause/resume at 35s cannot double-POST.
        committedSessionIdRef.current = payload.playSessionId;
        const durationSec =
          Number.isFinite(total) && total > 0 ? total : payload.durationSec;
        void postPlayLog({
          ...payload,
          ...(durationSec ? { durationSec } : {}),
        }).then((isrc) => {
          if (isrc) onIsrcResolvedRef.current?.(isrc);
        });
      },
      onPlaying: () => onPlayingRef.current?.(),
      onPaused: () => onPausedRef.current?.(),
      onEnded: () => onEndedRef.current?.(),
      onError: () => onErrorRef.current?.(),
    });

    return () => provider.destroy();
  }, [provider]);

  // Level and transport intent are declared ahead of the load effect on
  // purpose: a load applies the fader and decides whether to start the clip.
  useEffect(() => {
    provider.setVolume(volume);
  }, [volume, provider]);

  useEffect(() => {
    if (isPlaying) {
      try {
        provider.play();
      } catch {
        provider.unlockAudio();
        provider.play();
      }
    } else provider.pause();
  }, [isPlaying, provider]);

  useEffect(() => {
    const url = streamUrl?.trim();
    const queueTitle = title?.trim() ?? "";
    const queueArtist = artist?.trim() ?? "";
    if (!url) {
      provider.unload();
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    void provider.load(
      trackFromProviderId("direct_stream", url, {
        title: queueTitle,
        artist: queueArtist,
        extras: {
          ...(queueTitle ? { resolvedTitle: queueTitle } : {}),
          ...(queueArtist ? { resolvedArtist: queueArtist } : {}),
        },
      }),
    );
  }, [streamUrl, title, artist, provider]);

  const load = useCallback(
    (url: string, metadata?: { title?: string; artist?: string }) => {
      const trimmed = url.trim();
      if (!trimmed) {
        provider.unload();
        return Promise.resolve();
      }
      const queueTitle = metadata?.title?.trim() ?? "";
      const queueArtist = metadata?.artist?.trim() ?? "";
      return provider.load(
        trackFromProviderId("direct_stream", trimmed, {
          title: queueTitle,
          artist: queueArtist,
          extras: {
            ...(queueTitle ? { resolvedTitle: queueTitle } : {}),
            ...(queueArtist ? { resolvedArtist: queueArtist } : {}),
          },
        }),
      );
    },
    [provider],
  );
  const play = useCallback(() => {
    try {
      provider.play();
    } catch {
      provider.unlockAudio();
      provider.play();
    }
  }, [provider]);
  const pause = useCallback(() => provider.pause(), [provider]);
  const seekTo = useCallback((seconds: number) => provider.seekTo(seconds), [provider]);
  const setVolume = useCallback(
    (normalized: number) => provider.setVolume(normalized),
    [provider],
  );
  const setDuckGain = useCallback(
    (gain: number) => provider.setDuckGain(gain),
    [provider],
  );
  const unlockAudio = useCallback(() => provider.unlockAudio(), [provider]);
  const pausePlayback = useCallback(() => provider.pause(), [provider]);
  const playFromStart = useCallback(() => provider.playFromStart(), [provider]);
  const resetPlayingEmitted = useCallback(
    () => provider.resetPlayingEmitted(),
    [provider],
  );
  const setLaunchHold = useCallback(
    (active: boolean, mode: LaunchHoldMode = "hard_pause") => {
      provider.setLaunchHold(active, mode);
    },
    [provider],
  );
  const releaseLaunchHold = useCallback(
    () => provider.releaseLaunchHold(),
    [provider],
  );
  const isLaunchHoldActive = useCallback(
    () => provider.isLaunchHoldActive(),
    [provider],
  );
  const getLaunchHoldActive = isLaunchHoldActive;
  const getLaunchHoldMode = useCallback(
    () => provider.getLaunchHoldMode(),
    [provider],
  );

  return {
    provider,
    currentTime,
    duration,
    load,
    play,
    pause,
    seekTo,
    setVolume,
    setDuckGain,
    unlockAudio,
    pausePlayback,
    playFromStart,
    resetPlayingEmitted,
    setLaunchHold,
    releaseLaunchHold,
    isLaunchHoldActive,
    getLaunchHoldActive,
    getLaunchHoldMode,
    holdForOpeningBreak: provider.holdForOpeningBreak,
    isDirectStreamMode: Boolean(streamUrl?.trim()),
  };
}
