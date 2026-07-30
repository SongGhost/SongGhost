"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";
import { useStationQueue } from "@/hooks/useStationQueue";
import { fetchArtistLocalEvent, type ListenerLocation } from "@/hooks/useListenerLocation";
import { usePreviewPlayer } from "@/hooks/usePreviewPlayer";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { markAudioUnlockRequested, isAudioUnlockPending } from "@/lib/audio-unlock";
import { playDjIntro } from "@/lib/dj-intro";
import { createDjSchedulerState, planDjSegment, resetDjSchedulerState } from "@/lib/dj/scheduler";
import type { LocalConcertEvent } from "@/types/dj";
import type { TtsProvider } from "@/types/voice";

export type AudioPlayerHandle = {
  skipNext: () => void;
  skipPrev: () => void;
  unlockAudio: () => void;
  getQueue: () => { queue: StationTrack[]; currentIndex: number };
  removeTrack: (index: number) => void;
  insertTrackNext: (track: StationTrack) => void;
  appendTrack: (track: StationTrack) => void;
};

type AudioPlayerProps = {
  youtubeId?: string;
  stationId: string;
  stationTracks?: StationTrack[];
  stationQueueMode?: boolean;
  queueGeneration?: number;
  isPlaying: boolean;
  volume: number;
  onTrackChange?: (track: { title: string; artist: string; youtubeId: string }) => void;
  onEnded?: () => void;
  songTitle?: string;
  artistName?: string;
  personaId?: PersonaId;
  ttsProvider?: TtsProvider;
  djPacingFrequency?: number;
  stationName?: string;
  listenerLocation?: ListenerLocation | null;
  maxDurationInSeconds?: number;
  onPlayingChange?: (playing: boolean) => void;
  onQueueChange?: (queue: StationTrack[], currentIndex: number) => void;
  incrementSongCounter?: () => number;
  addToPlayHistory?: (entry: {
    id: string;
    title: string;
    artist: string;
    stationId: string;
    youtubeId: string;
  }) => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  {
    youtubeId,
    stationId,
    stationTracks = [],
    stationQueueMode = true,
    queueGeneration = 0,
    isPlaying,
    volume,
    onTrackChange,
    onEnded,
    songTitle = "",
    artistName = "",
    personaId,
    ttsProvider = "openai",
    djPacingFrequency = 1,
    stationName = "",
    listenerLocation = null,
    maxDurationInSeconds = 5,
    onPlayingChange,
    onQueueChange,
    incrementSongCounter,
    addToPlayHistory,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const errorCountRef = useRef(0);
  const skipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVideoIdRef = useRef<string | null>(null);
  const introRunningRef = useRef(false);
  const introAbortRef = useRef<AbortController | null>(null);
  const volumeRef = useRef(volume);
  const personaIdRef = useRef(personaId);
  const ttsProviderRef = useRef(ttsProvider);
  const djPacingRef = useRef(djPacingFrequency);
  const maxDurationRef = useRef(maxDurationInSeconds);
  const stationIdRef = useRef(stationId);
  const songTitleRef = useRef(songTitle);
  const artistNameRef = useRef(artistName);
  const stationQueueModeRef = useRef(stationQueueMode);
  const stationNameRef = useRef(stationName);
  const listenerLocationRef = useRef(listenerLocation);
  const queueRef = useRef<StationTrack[]>([]);
  const currentIndexQueueRef = useRef(0);
  const djSchedulerRef = useRef(createDjSchedulerState());
  const localEventCacheRef = useRef(new Map<string, LocalConcertEvent | null>());

  const onQueueChangeRef = useRef(onQueueChange);

  volumeRef.current = volume;
  personaIdRef.current = personaId;
  ttsProviderRef.current = ttsProvider;
  djPacingRef.current = djPacingFrequency;
  maxDurationRef.current = maxDurationInSeconds;
  stationIdRef.current = stationId;
  songTitleRef.current = songTitle;
  artistNameRef.current = artistName;
  stationQueueModeRef.current = stationQueueMode;
  stationNameRef.current = stationName;
  listenerLocationRef.current = listenerLocation;
  onQueueChangeRef.current = onQueueChange;

  const notifyTrackChange = useCallback(
    (track: StationTrack) => {
      onTrackChange?.({
        title: track.title,
        artist: track.artist,
        youtubeId: track.youtubeId,
      });
    },
    [onTrackChange],
  );

  const {
    currentTrack,
    queue,
    currentIndex,
    nextTrack,
    prevTrack,
    resetQueue,
    removeTrack,
    insertTrackNext,
    appendTrack,
  } = useStationQueue({
    stationId,
    initialTracks: stationTracks,
    onTrackChange: stationQueueMode ? notifyTrackChange : undefined,
  });

  queueRef.current = queue;
  currentIndexQueueRef.current = currentIndex;

  useEffect(() => {
    if (stationQueueMode) onQueueChangeRef.current?.(queue, currentIndex);
  }, [queue, currentIndex, stationQueueMode]);

  useEffect(() => {
    if (stationQueueMode) void resetQueue();
    djSchedulerRef.current = resetDjSchedulerState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, queueGeneration, stationQueueMode]);

  const youtubeVideoId = stationQueueMode
    ? currentTrack?.youtubeId?.trim() || undefined
    : youtubeId?.trim() || undefined;
  const previewUrl =
    stationQueueMode && !youtubeVideoId ? currentTrack?.previewUrl?.trim() : undefined;
  const videoId = youtubeVideoId;
  const isPreviewMode = Boolean(previewUrl);
  const trackKey =
    videoId ?? (previewUrl ? `preview:${currentTrack?.itunesTrackId ?? previewUrl}` : undefined);

  const abortIntro = useCallback(() => {
    introAbortRef.current?.abort();
    introAbortRef.current = null;
    introRunningRef.current = false;
  }, []);

  useEffect(() => {
    errorCountRef.current = 0;
    lastVideoIdRef.current = null;
    abortIntro();
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
  }, [videoId, previewUrl, stationId, queueGeneration, abortIntro]);

  useEffect(
    () => () => {
      abortIntro();
      if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
    },
    [abortIntro],
  );

  const handlePlaybackEnded = useCallback(() => {
    if (stationQueueMode) void nextTrack();
    else onEnded?.();
  }, [stationQueueMode, nextTrack, onEnded]);

  const handlePlaybackError = useCallback(() => {
    if (errorCountRef.current >= 5) {
      console.warn("[AudioPlayer] Max playback errors reached. Halting auto-advance.");
      return;
    }
    errorCountRef.current += 1;
    if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
    skipTimeoutRef.current = setTimeout(() => {
      skipTimeoutRef.current = null;
      if (stationQueueMode) void nextTrack();
    }, 1000);
  }, [stationQueueMode, nextTrack]);

  const handleNewTrackRef = useRef<() => void>(() => {});

  const onPlaying = useCallback(() => {
    errorCountRef.current = 0;
    onPlayingChange?.(true);
    void handleNewTrackRef.current();
  }, [onPlayingChange]);

  const onPaused = useCallback(() => {
    onPlayingChange?.(false);
  }, [onPlayingChange]);

  const youtubeControls = useYouTubePlayer({
    wrapperRef: containerRef,
    videoId: isPreviewMode ? undefined : videoId,
    isPlaying,
    volume,
    onEnded: handlePlaybackEnded,
    onError: handlePlaybackError,
    onPlaying,
    onPaused,
  });

  const previewControls = usePreviewPlayer({
    previewUrl: isPreviewMode ? previewUrl : undefined,
    isPlaying,
    volume,
    onEnded: handlePlaybackEnded,
    onError: handlePlaybackError,
    onPlaying,
    onPaused,
  });

  const { unlockAudio: unlockYouTube } = youtubeControls;
  const { unlockAudio: unlockPreview } = previewControls;
  const requestUnlockRef = useRef(false);

  const unlockBothPlayers = useCallback(() => {
    markAudioUnlockRequested();
    requestUnlockRef.current = true;
    unlockYouTube();
    unlockPreview();
  }, [unlockYouTube, unlockPreview]);

  const { currentTime, duration, seekTo, setPlayerVolume } = isPreviewMode
    ? previewControls
    : youtubeControls;

  // After a user gesture unlock, re-apply when the active track source changes.
  useEffect(() => {
    if ((!requestUnlockRef.current && !isAudioUnlockPending()) || !isPlaying || !trackKey) return;
    const id = window.requestAnimationFrame(() => {
      unlockYouTube();
      unlockPreview();
      if (!isAudioUnlockPending()) {
        requestUnlockRef.current = false;
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [trackKey, isPlaying, unlockYouTube, unlockPreview]);

  const handleNewTrack = useCallback(async () => {
    if (!trackKey) return;
    if (lastVideoIdRef.current === trackKey) return;
    lastVideoIdRef.current = trackKey;

    const title = stationQueueModeRef.current
      ? (currentTrack?.title ?? songTitleRef.current)
      : songTitleRef.current;
    const artist = stationQueueModeRef.current
      ? (currentTrack?.artist ?? artistNameRef.current)
      : artistNameRef.current;
    const album = currentTrack?.album;

    addToPlayHistory?.({
      id: trackKey,
      title,
      artist,
      stationId: stationIdRef.current,
      youtubeId: videoId ?? trackKey,
    });

    incrementSongCounter?.();

    if (!stationQueueModeRef.current) return;

    const upNextTracks = queueRef.current
      .slice(currentIndexQueueRef.current + 1, currentIndexQueueRef.current + 3)
      .map((track) => ({
        title: track.title,
        artist: track.artist,
        album: track.album,
      }));

    const loc = listenerLocationRef.current;
    let localEvent: LocalConcertEvent | null = null;
    if (loc) {
      const cacheKey = `${artist.toLowerCase()}::${loc.lat.toFixed(1)}::${loc.lng.toFixed(1)}`;
      if (localEventCacheRef.current.has(cacheKey)) {
        localEvent = localEventCacheRef.current.get(cacheKey) ?? null;
      } else {
        localEvent = await fetchArtistLocalEvent(artist, loc);
        localEventCacheRef.current.set(cacheKey, localEvent);
      }
    }

    const { plan, nextState } = planDjSegment(djSchedulerRef.current, {
      currentTrack: { title, artist, album },
      upNextTracks,
      pacingFrequency: djPacingRef.current,
      localEvent,
      listenerCity: loc?.city,
    });
    djSchedulerRef.current = nextState;

    if (!plan) return;

    if (introRunningRef.current) return;
    abortIntro();

    const controller = new AbortController();
    introAbortRef.current = controller;
    introRunningRef.current = true;

    try {
      await playDjIntro({
        songTitle: title,
        artistName: artist,
        maxDurationInSeconds: maxDurationRef.current,
        personaId: personaIdRef.current,
        provider: ttsProviderRef.current,
        stationName: stationNameRef.current,
        segmentPlan: plan,
        getMasterVolume: () => volumeRef.current,
        setPlayerVolume,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.warn("[AudioPlayer] DJ intro failed:", error);
      }
    } finally {
      introRunningRef.current = false;
      introAbortRef.current = null;
      setPlayerVolume(Math.round(volumeRef.current * 100));
    }
  }, [
    trackKey,
    videoId,
    currentTrack,
    addToPlayHistory,
    incrementSongCounter,
    abortIntro,
    setPlayerVolume,
  ]);

  handleNewTrackRef.current = () => {
    void handleNewTrack();
  };

  useImperativeHandle(
    ref,
    () => ({
      skipNext: () => {
        abortIntro();
        errorCountRef.current = 0;
        lastVideoIdRef.current = null;
        if (stationQueueMode) void nextTrack();
      },
      skipPrev: () => {
        abortIntro();
        errorCountRef.current = 0;
        lastVideoIdRef.current = null;
        if (stationQueueMode) prevTrack();
      },
      unlockAudio: () => {
        unlockBothPlayers();
      },
      getQueue: () => ({ queue, currentIndex }),
      removeTrack: (index: number) => {
        if (!stationQueueMode) return;
        if (index === currentIndex) {
          abortIntro();
          errorCountRef.current = 0;
          lastVideoIdRef.current = null;
        }
        removeTrack(index);
      },
      insertTrackNext: (track: StationTrack) => {
        if (!stationQueueMode) return;
        insertTrackNext(track);
      },
      appendTrack: (track: StationTrack) => {
        if (!stationQueueMode) return;
        appendTrack(track);
      },
    }),
    [
      stationQueueMode,
      nextTrack,
      prevTrack,
      abortIntro,
      unlockBothPlayers,
      queue,
      currentIndex,
      removeTrack,
      insertTrackNext,
      appendTrack,
    ],
  );

  return (
    <>
      <div
        ref={containerRef}
        className="yt-player-host fixed -left-[9999px] top-0 h-[180px] w-[320px] overflow-hidden opacity-0 pointer-events-none"
        aria-hidden="true"
      />
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
            onChange={(event) => seekTo(Number(event.target.value))}
            className="song-progress-slider block w-full max-w-full"
            aria-label="Song progress"
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          />
        </div>
      </div>
    </>
  );
});
