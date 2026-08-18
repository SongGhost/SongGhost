"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectStreamProvider } from "@/lib/audio/DirectStreamProvider";
import { trackFromProviderId } from "@/lib/audio/TrackProvider";

/**
 * React binding for {@link DirectStreamProvider}, the live music transport.
 * Mirrors `usePreviewPlayer` / `useYouTubePlayer`: the provider owns playback;
 * the hook only wires props and render state through stable refs.
 */
export function useDirectStreamPlayer({
  streamUrl,
  isPlaying,
  volume,
  onEnded,
  onError,
  onPlaying,
  onPaused,
}: {
  streamUrl?: string;
  isPlaying: boolean;
  volume: number;
  onEnded?: () => void;
  onError?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
}) {
  const providerRef = useRef<DirectStreamProvider | null>(null);
  if (!providerRef.current) providerRef.current = new DirectStreamProvider();
  const provider = providerRef.current;

  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onPausedRef = useRef(onPaused);

  onEndedRef.current = onEnded;
  onErrorRef.current = onError;
  onPlayingRef.current = onPlaying;
  onPausedRef.current = onPaused;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    provider.setEventHandlers({
      onTimeUpdate: (position, total) => {
        setCurrentTime(position);
        setDuration(total);
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
    if (isPlaying) provider.play();
    else provider.pause();
  }, [isPlaying, provider]);

  useEffect(() => {
    const url = streamUrl?.trim();
    if (!url) {
      provider.unload();
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    void provider.load(trackFromProviderId("direct_stream", url));
  }, [streamUrl, provider]);

  const load = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) {
        provider.unload();
        return Promise.resolve();
      }
      return provider.load(trackFromProviderId("direct_stream", trimmed));
    },
    [provider],
  );
  const play = useCallback(() => provider.play(), [provider]);
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
    isDirectStreamMode: Boolean(streamUrl?.trim()),
  };
}
