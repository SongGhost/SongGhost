"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5TrackProvider, trackFromProviderId } from "@/lib/audio/TrackProvider";

/**
 * React binding for {@link Html5TrackProvider}, used for iTunes preview clips
 * when a track has no playable YouTube embed. Mirrors `useYouTubePlayer`: the
 * provider owns playback, the hook only wires props and render state.
 */
export function usePreviewPlayer({
  previewUrl,
  isPlaying,
  volume,
  onEnded,
  onError,
  onPlaying,
  onPaused,
}: {
  previewUrl?: string;
  isPlaying: boolean;
  volume: number;
  onEnded?: () => void;
  onError?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
}) {
  const providerRef = useRef<Html5TrackProvider | null>(null);
  if (!providerRef.current) providerRef.current = new Html5TrackProvider("itunes");
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
  // purpose: a load applies the fader and decides whether to start the clip,
  // so the provider has to know both before the first track arrives.
  useEffect(() => {
    provider.setVolume(volume);
  }, [volume, provider]);

  useEffect(() => {
    if (isPlaying) provider.play();
    else provider.pause();
  }, [isPlaying, provider]);

  useEffect(() => {
    const url = previewUrl?.trim();
    if (!url) {
      provider.unload();
      return;
    }
    void provider.load(trackFromProviderId("itunes", url));
  }, [previewUrl, provider]);

  const seekTo = useCallback((seconds: number) => provider.seekTo(seconds), [provider]);
  const unlockAudio = useCallback(() => provider.unlockAudio(), [provider]);
  const pausePlayback = useCallback(() => provider.pause(), [provider]);
  const playFromStart = useCallback(() => provider.playFromStart(), [provider]);

  return {
    provider,
    currentTime,
    duration,
    seekTo,
    unlockAudio,
    isPreviewMode: Boolean(previewUrl?.trim()),
    pausePlayback,
    playFromStart,
  };
}
