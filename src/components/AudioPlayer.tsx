"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";
import { useStationQueue } from "@/hooks/useStationQueue";
import { fetchArtistLocalEvent, type ListenerLocation } from "@/hooks/useListenerLocation";
import { usePreviewPlayer } from "@/hooks/usePreviewPlayer";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { markAudioUnlockRequested } from "@/lib/audio-unlock";
import { DjPrefetchController, shouldStartLookahead } from "@/lib/audio/dj-prefetch";
import { UNDUCKED_GAIN } from "@/lib/audio/mix-bus";
import { StingerEngine } from "@/lib/audio/StingerEngine";
import { BufferedVoiceNode } from "@/lib/audio/VoiceNode";
import { createVolumeController } from "@/lib/audio/volume-controller";
import { generateDjBreak, playDjIntro } from "@/lib/dj-intro";
import { recordFailedYoutubeId } from "@/lib/failed-youtube-ids";
import {
  createDjSchedulerState,
  DEFAULT_DJ_PACING,
  planDjSegment,
  resetDjSchedulerState,
} from "@/lib/dj/scheduler";
import type { VolumeController } from "@/types/audio";
import type { DjTrackContext, LocalConcertEvent } from "@/types/dj";
import type { TtsProvider } from "@/types/voice";

export type AudioPlayerHandle = {
  skipNext: () => void;
  skipPrev: () => void;
  unlockAudio: () => void;
  getQueue: () => { queue: StationTrack[]; currentIndex: number };
  removeTrack: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
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
  /** Dial position of the live station — the only frequency the DJ may announce. */
  stationFrequency?: number;
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

const LOCAL_EVENT_LOOKUP_TIMEOUT_MS = 2500;

/** Distinguishes "lookup was too slow" from a genuine "no show nearby" result. */
const LOCAL_EVENT_TIMED_OUT = Symbol("local-event-timed-out");

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function playbackKeyForTrack(track: StationTrack | undefined): string | undefined {
  if (!track) return undefined;
  const youtubeId = track.youtubeId?.trim();
  if (youtubeId) return youtubeId;
  const previewUrl = track.previewUrl?.trim();
  if (previewUrl) return `preview:${track.itunesTrackId ?? previewUrl}`;
  return undefined;
}

function toDjTrackContext(track: StationTrack): DjTrackContext {
  return { title: track.title, artist: track.artist, album: track.album };
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
    djPacingFrequency = DEFAULT_DJ_PACING,
    stationName = "",
    stationFrequency,
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
  const trackSessionRef = useRef<string | null>(null);
  const sessionOpeningDjRef = useRef(false);
  const introRunningRef = useRef(false);
  const introAbortRef = useRef<AbortController | null>(null);
  /** Sidechain duck gain for the music channel only — never reaches the voice. */
  const duckGainRef = useRef(UNDUCKED_GAIN);
  const duckBusRef = useRef<VolumeController | null>(null);
  const personaIdRef = useRef(personaId);
  const ttsProviderRef = useRef(ttsProvider);
  const djPacingRef = useRef(djPacingFrequency);
  const maxDurationRef = useRef(maxDurationInSeconds);
  const stationIdRef = useRef(stationId);
  const songTitleRef = useRef(songTitle);
  const artistNameRef = useRef(artistName);
  const stationQueueModeRef = useRef(stationQueueMode);
  const stationNameRef = useRef(stationName);
  const stationFrequencyRef = useRef(stationFrequency);
  const listenerLocationRef = useRef(listenerLocation);
  const queueRef = useRef<StationTrack[]>([]);
  const currentIndexQueueRef = useRef(0);
  const djSchedulerRef = useRef(createDjSchedulerState());
  const localEventCacheRef = useRef(new Map<string, LocalConcertEvent | null>());

  const voiceNodeRef = useRef<BufferedVoiceNode | null>(null);
  if (!voiceNodeRef.current) voiceNodeRef.current = new BufferedVoiceNode();
  const voiceNode = voiceNodeRef.current;

  /**
   * SFX channel. Built here rather than per transition so the decoded kit — and
   * the audio context behind it — outlives every station change in the session.
   */
  const stingersRef = useRef<StingerEngine | null>(null);
  if (!stingersRef.current) stingersRef.current = new StingerEngine();
  const stingers = stingersRef.current;

  const prefetchRef = useRef<DjPrefetchController | null>(null);
  if (!prefetchRef.current) {
    prefetchRef.current = new DjPrefetchController({
      preload: (blob) => voiceNode.preload(blob),
      discardPreload: () => voiceNode.discardPreload(),
    });
  }
  const djPrefetch = prefetchRef.current;

  const onQueueChangeRef = useRef(onQueueChange);

  personaIdRef.current = personaId;
  ttsProviderRef.current = ttsProvider;
  djPacingRef.current = djPacingFrequency;
  maxDurationRef.current = maxDurationInSeconds;
  stationIdRef.current = stationId;
  songTitleRef.current = songTitle;
  artistNameRef.current = artistName;
  stationQueueModeRef.current = stationQueueMode;
  stationNameRef.current = stationName;
  stationFrequencyRef.current = stationFrequency;
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
    upcomingTrack,
    queue,
    currentIndex,
    nextTrack,
    prevTrack,
    resetQueue,
    removeTrack,
    reorderQueue,
    insertTrackNext,
    appendTrack,
    updateTrackAt,
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
    // The launch key lets the queue collapse the duplicate runs StrictMode and
    // Fast Refresh trigger, so one launch draws exactly one opener.
    if (stationQueueMode) void resetQueue(`${stationId}:${queueGeneration}`);
    djSchedulerRef.current = resetDjSchedulerState();
    // A warmed break carries the scheduler state it was planned against, which
    // the reset above has just invalidated.
    djPrefetch.clear();
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
  const upcomingKey = playbackKeyForTrack(upcomingTrack);

  // Deliberately dependency-free: this is wired into the stationId/queueGeneration
  // effect, and a changing identity there would re-arm the session-opening DJ flag.
  const abortIntro = useCallback(() => {
    introAbortRef.current?.abort();
    introAbortRef.current = null;
    introRunningRef.current = false;
    voiceNodeRef.current?.stop();
    duckBusRef.current?.setVolume(UNDUCKED_GAIN);
  }, []);

  useEffect(() => {
    sessionOpeningDjRef.current = true;
    errorCountRef.current = 0;
    abortIntro();
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
    // Tune-in sweep. Read through the ref because this effect also arms the
    // session-opening DJ flag, and a dependency on the live prop would re-arm it
    // on an unrelated re-render. The idle mount carries no station, which is what
    // keeps a sweep off page load.
    if (stationQueueModeRef.current && stationId) stingers.playFrequencySweep();
  }, [stationId, queueGeneration, abortIntro, stingers]);

  useEffect(() => {
    trackSessionRef.current = null;
    abortIntro();
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
  }, [videoId, previewUrl, abortIntro]);

  /**
   * A warmed break is only playable at the transition it was planned for, so it
   * has to stay pinned to the track that is either on air or up next. Skips,
   * removals, reorders, and insertions all land here as a changed key pair.
   */
  useEffect(() => {
    djPrefetch.retain([trackKey, upcomingKey]);
  }, [trackKey, upcomingKey, djPrefetch]);

  useEffect(
    () => () => {
      abortIntro();
      djPrefetch.clear();
      if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
    },
    [abortIntro, djPrefetch],
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

    const failedIndex = currentIndexQueueRef.current;
    const failedTrack = queueRef.current[failedIndex];
    const failedYoutubeId = failedTrack?.youtubeId?.trim();

    abortIntro();
    trackSessionRef.current = null;

    if (failedYoutubeId) {
      recordFailedYoutubeId(failedYoutubeId);
    }

    if (failedTrack && failedYoutubeId && failedTrack.previewUrl?.trim()) {
      if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
      updateTrackAt(failedIndex, { ...failedTrack, youtubeId: "" });
      errorCountRef.current = 0;
      return;
    }

    const failedKey = playbackKeyForTrack(failedTrack);
    if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
    skipTimeoutRef.current = setTimeout(() => {
      skipTimeoutRef.current = null;
      if (!stationQueueModeRef.current || !failedKey) return;
      const index = queueRef.current.findIndex(
        (track) => playbackKeyForTrack(track) === failedKey,
      );
      if (index >= 0) removeTrack(index);
    }, 400);
  }, [abortIntro, removeTrack, updateTrackAt]);

  const handleNewTrackRef = useRef<() => Promise<void>>(async () => {});

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

  const unlockActivePlayer = useCallback(() => {
    if (isPreviewMode) unlockPreview();
    else unlockYouTube();
  }, [isPreviewMode, unlockPreview, unlockYouTube]);

  const unlockBothPlayers = useCallback(() => {
    markAudioUnlockRequested();
    unlockActivePlayer();
    // Runs inside the gesture that reaches here, which is the only moment an
    // audio context can be opened already running rather than suspended.
    stingers.unlock();
  }, [unlockActivePlayer, stingers]);

  const { currentTime, duration, seekTo } = isPreviewMode ? previewControls : youtubeControls;

  const { provider: youtubeProvider } = youtubeControls;
  const { provider: previewProvider } = previewControls;

  /**
   * The mix's duck bus. Both providers are driven, not just the one on air, so
   * a mid-break fallback from an unplayable embed to a preview clip lands at
   * the ducked level instead of blaring over the DJ.
   */
  const duckBus = useMemo(
    () =>
      createVolumeController({
        getVolume: () => duckGainRef.current,
        setVolume: (gain) => {
          duckGainRef.current = gain;
          youtubeProvider.setDuckGain(gain);
          previewProvider.setDuckGain(gain);
        },
      }),
    [youtubeProvider, previewProvider],
  );

  duckBusRef.current = duckBus;

  // The voice rides master directly, so a fader move mid-break has to be pushed
  // onto the live clip. Ducking is never folded in here.
  useEffect(() => {
    voiceNode.setVolume(volume);
  }, [volume, voiceNode]);

  // Same deal for the SFX bus: master only, never the duck gain.
  useEffect(() => {
    stingers.setMasterVolume(volume);
  }, [volume, stingers]);

  useEffect(() => {
    voiceNode.providerId = ttsProvider;
  }, [ttsProvider, voiceNode]);

  useEffect(() => () => voiceNode.destroy(), [voiceNode]);

  useEffect(() => () => stingers.destroy(), [stingers]);

  const resolveLiveTrack = useCallback(() => {
    if (stationQueueModeRef.current) {
      return queueRef.current[currentIndexQueueRef.current];
    }
    return undefined;
  }, []);

  const isTrackStillActive = useCallback((startedKey: string) => {
    const liveKey = playbackKeyForTrack(resolveLiveTrack());
    return liveKey === startedKey;
  }, [resolveLiveTrack]);

  const resolveLocalEvent = useCallback(async (artist: string) => {
    const loc = listenerLocationRef.current;
    if (!loc) return null;

    const cacheKey = `${artist.toLowerCase()}::${loc.lat.toFixed(1)}::${loc.lng.toFixed(1)}`;
    if (localEventCacheRef.current.has(cacheKey)) {
      return localEventCacheRef.current.get(cacheKey) ?? null;
    }

    let timeoutId: number | undefined;
    try {
      const result = await Promise.race([
        fetchArtistLocalEvent(artist, loc),
        new Promise<typeof LOCAL_EVENT_TIMED_OUT>((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve(LOCAL_EVENT_TIMED_OUT),
            LOCAL_EVENT_LOOKUP_TIMEOUT_MS,
          );
        }),
      ]);

      // On timeout leave the cache untouched: the in-flight request still warms the
      // server cache, so the next track by this artist can answer immediately.
      if (result === LOCAL_EVENT_TIMED_OUT) return null;

      localEventCacheRef.current.set(cacheKey, result);
      return result;
    } catch {
      return null;
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  }, []);

  const handleNewTrack = useCallback(async () => {
    if (!trackKey) return;
    if (trackSessionRef.current === trackKey) return;

    const startedKey = trackKey;
    trackSessionRef.current = startedKey;
    const liveAtStart = resolveLiveTrack();
    const title = stationQueueModeRef.current
      ? (liveAtStart?.title ?? songTitleRef.current)
      : songTitleRef.current;
    const artist = stationQueueModeRef.current
      ? (liveAtStart?.artist ?? artistNameRef.current)
      : artistNameRef.current;
    const album = liveAtStart?.album;
    const startedVideoId = liveAtStart?.youtubeId?.trim() || videoId;

    addToPlayHistory?.({
      id: startedKey,
      title,
      artist,
      stationId: stationIdRef.current,
      youtubeId: startedVideoId ?? startedKey,
    });

    incrementSongCounter?.();

    if (!stationQueueModeRef.current) return;

    /**
     * A break the lookahead warmed during the previous track. Its scheduler
     * decision was taken then, so re-planning here would both roll a different
     * break than the one already synthesized and charge the transition to the
     * pacing budget twice.
     */
    const reservation = sessionOpeningDjRef.current ? null : djPrefetch.take(startedKey);
    const warmed = reservation ? await reservation : null;

    // The warmed slot already carries its concert aside; only a live plan needs
    // the lookup, and skipping it is what keeps the warmed path off the network.
    const localEvent = warmed ? null : await resolveLocalEvent(artist);

    const releaseWarmedClip = () => {
      if (warmed?.audioBlob) voiceNode.discardPreload();
    };

    if (!isTrackStillActive(startedKey)) {
      releaseWarmedClip();
      return;
    }
    // A break from the previous track is still on air. Return before planning so this
    // track's slot is retried later instead of being consumed by a break we can't play.
    if (introRunningRef.current) {
      releaseWarmedClip();
      return;
    }

    const activeTrack = resolveLiveTrack();
    const announceTitle = activeTrack?.title ?? title;
    const announceArtist = activeTrack?.artist ?? artist;
    const announceAlbum = activeTrack?.album ?? album;

    const { transition, plan, nextState } =
      warmed ??
      planDjSegment(djSchedulerRef.current, {
        currentTrack: { title: announceTitle, artist: announceArtist, album: announceAlbum },
        upNextTracks: queueRef.current
          .slice(currentIndexQueueRef.current + 1, currentIndexQueueRef.current + 3)
          .map(toDjTrackContext),
        pacingFrequency: djPacingRef.current,
        localEvent,
        listenerCity: listenerLocationRef.current?.city,
        isSessionOpening: sessionOpeningDjRef.current,
      });
    djSchedulerRef.current = nextState;

    if (sessionOpeningDjRef.current) {
      sessionOpeningDjRef.current = false;
    }

    if (transition === "silent" || !plan) return;

    abortIntro();

    const controller = new AbortController();
    introAbortRef.current = controller;
    introRunningRef.current = true;

    try {
      await playDjIntro({
        songTitle: announceTitle,
        artistName: announceArtist,
        maxDurationInSeconds: maxDurationRef.current,
        personaId: personaIdRef.current,
        provider: ttsProviderRef.current,
        stationId: stationIdRef.current,
        stationName: stationNameRef.current,
        stationFrequency: stationFrequencyRef.current,
        segmentPlan: plan,
        audioBlob: warmed?.audioBlob,
        voiceNode,
        duckBus,
        signal: controller.signal,
        // Fires with the restore ramp, so the scratch rides the music coming
        // back up instead of landing in the gap before it.
        onBreakExit: () => stingers.playVinylScratch(),
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.warn("[AudioPlayer] DJ intro failed:", error);
      }
    } finally {
      // A superseded break must not touch the mix: `abortIntro` already released
      // the duck gain and a replacement break may already be ramping down.
      if (introAbortRef.current === controller) {
        introRunningRef.current = false;
        introAbortRef.current = null;
        // Unconditional: duck gain is mix-global, so skipping this when the
        // track already advanced would leave the next track ducked.
        duckBus.setVolume(UNDUCKED_GAIN);
      }
    }
  }, [
    trackKey,
    videoId,
    addToPlayHistory,
    incrementSongCounter,
    abortIntro,
    duckBus,
    voiceNode,
    djPrefetch,
    resolveLiveTrack,
    isTrackStillActive,
    resolveLocalEvent,
    stingers,
  ]);

  handleNewTrackRef.current = handleNewTrack;

  /**
   * Lookahead pre-fetcher. Once the outgoing track is inside the warming
   * window, the next transition is planned and — if it is voiced — written,
   * spoken, and decoded in the background, so `handleNewTrack` can open the
   * break the instant the track flips.
   *
   * Runs off the position clock, so it re-evaluates every tick; the controller
   * collapses repeat calls for a track it is already warming.
   */
  useEffect(() => {
    if (!stationQueueMode || !upcomingKey) return;
    // The session opener is planned live at track one and has no preceding
    // track to warm from.
    if (sessionOpeningDjRef.current) return;
    // The on-air track has not been charged to the scheduler yet, so planning
    // the next one would build on state that is about to change underneath it.
    if (!trackKey || trackSessionRef.current !== trackKey) return;
    if (!shouldStartLookahead({ position: currentTime, duration })) return;

    djPrefetch.start(upcomingKey, async (signal) => {
      const index = currentIndexQueueRef.current + 1;
      const track = queueRef.current[index];
      if (!track || playbackKeyForTrack(track) !== upcomingKey) return null;

      const upNextTracks = queueRef.current.slice(index + 1, index + 3).map(toDjTrackContext);
      const localEvent = await resolveLocalEvent(track.artist);
      if (signal.aborted) return null;

      // Deliberately not committed to `djSchedulerRef`: the decision belongs to
      // a transition that has not happened yet, so it travels with the warmed
      // break and is applied by whoever plays it.
      const { transition, plan, nextState } = planDjSegment(djSchedulerRef.current, {
        currentTrack: toDjTrackContext(track),
        upNextTracks,
        pacingFrequency: djPacingRef.current,
        localEvent,
        listenerCity: listenerLocationRef.current?.city,
        isSessionOpening: false,
      });

      if (transition === "silent" || !plan) return { transition, plan, nextState };

      const audioBlob = await generateDjBreak({
        songTitle: track.title,
        artistName: track.artist,
        maxDurationInSeconds: maxDurationRef.current,
        personaId: personaIdRef.current,
        provider: ttsProviderRef.current,
        stationId: stationIdRef.current,
        stationName: stationNameRef.current,
        stationFrequency: stationFrequencyRef.current,
        segmentPlan: plan,
        signal,
      });

      return { transition, plan, nextState, audioBlob };
    });
  }, [
    currentTime,
    duration,
    trackKey,
    upcomingKey,
    stationQueueMode,
    djPrefetch,
    resolveLocalEvent,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      // Only the manual skips sweep. A track that simply ended hands over on its
      // own and gets whatever the scheduler planned for the transition.
      skipNext: () => {
        abortIntro();
        errorCountRef.current = 0;
        trackSessionRef.current = null;
        stingers.playFrequencySweep();
        if (stationQueueMode) void nextTrack();
      },
      skipPrev: () => {
        abortIntro();
        errorCountRef.current = 0;
        trackSessionRef.current = null;
        stingers.playFrequencySweep();
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
          trackSessionRef.current = null;
        }
        removeTrack(index);
      },
      // No intro abort or track-session reset: a reorder leaves the on-air track
      // and its playback key untouched, so the current break must play through.
      reorderQueue: (fromIndex: number, toIndex: number) => {
        if (!stationQueueMode) return;
        reorderQueue(fromIndex, toIndex);
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
      reorderQueue,
      insertTrackNext,
      appendTrack,
      stingers,
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
        <div className="flex items-center justify-between font-mono text-xs font-bold tabular-nums text-amber-400">
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
