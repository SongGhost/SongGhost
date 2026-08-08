"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { trackFromProviderId, YouTubeTrackProvider } from "@/lib/audio/TrackProvider";

/**
 * React binding for {@link YouTubeTrackProvider}.
 *
 * All playback behaviour lives in the provider; this hook only translates
 * props into provider commands and provider events into render state. The
 * provider instance outlives mount/unmount so a Strict Mode remount rebuilds
 * the embed without losing the requested track, fader, or duck gain.
 */
export function useYouTubePlayer({
  wrapperRef,
  videoId,
  isPlaying,
  volume,
  onEnded,
  onError,
  onPlaying,
  onPaused,
}: {
  /** Stable outer wrapper — React manages this; the provider adds a mount child. */
  wrapperRef: RefObject<HTMLElement | null>;
  videoId?: string;
  isPlaying: boolean;
  volume: number;
  onEnded?: () => void;
  onError?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
}) {
  const providerRef = useRef<YouTubeTrackProvider | null>(null);
  if (!providerRef.current) providerRef.current = new YouTubeTrackProvider();
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
  const [playerReady, setPlayerReady] = useState(false);

  // Subscribed once and dispatched through refs: a handler identity that
  // changed with the parent's render would tear down the embed mid-track.
  useEffect(() => {
    provider.setEventHandlers({
      onReady: () => setPlayerReady(true),
      onTimeUpdate: (position, total) => {
        setCurrentTime(position);
        setDuration(total);
      },
      onPlaying: () => onPlayingRef.current?.(),
      onPaused: () => onPausedRef.current?.(),
      onEnded: () => onEndedRef.current?.(),
      onError: () => onErrorRef.current?.(),
    });
  }, [provider]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    provider.mount(wrapper);

    return () => {
      provider.destroy();
      setPlayerReady(false);
    };
  }, [wrapperRef, provider]);

  // Level and transport intent are declared ahead of the load effect on
  // purpose: a load re-asserts the fader and decides whether to autoplay, so
  // the provider has to know both before the first track arrives.
  useEffect(() => {
    provider.setVolume(volume);
  }, [volume, provider]);

  useEffect(() => {
    if (isPlaying) {
      provider.play();
      return;
    }
    // pause() itself guards YT method availability — safe across route changes
    // when the embed is mid-teardown and pauseVideo is not yet/no longer a function.
    provider.pause();
  }, [isPlaying, provider]);

  useEffect(() => {
    if (!videoId) {
      provider.unload();
      return;
    }
    void provider.load(trackFromProviderId("youtube", videoId));
  }, [videoId, provider]);

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
    playerReady,
    pausePlayback,
    playFromStart,
  };
}
