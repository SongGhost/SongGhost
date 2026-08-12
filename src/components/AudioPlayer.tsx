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
import DriveModeOverlay from "@/components/studio/DriveModeOverlay";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { useDjState } from "@/hooks/useDjState";
import { useMediaSession } from "@/hooks/useMediaSession";
import { useStationQueue } from "@/hooks/useStationQueue";
import { fetchArtistLocalEvent, type ListenerLocation } from "@/hooks/useListenerLocation";
import { usePreviewPlayer } from "@/hooks/usePreviewPlayer";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { markAudioUnlockRequested } from "@/lib/audio-unlock";
import { DjPrefetchController, shouldStartLookahead } from "@/lib/audio/dj-prefetch";
import {
  DUCK_RAMP_MS,
  DUCK_RATIO,
  getMasterAnalyser,
  UNDUCKED_GAIN,
} from "@/lib/audio/mix-bus";
import {
  COLD_VOCAL_INTRO_THRESHOLD_SEC,
  FALLBACK_DJ_AUDIO_DURATION_SEC,
  INTRO_RAMP_RESTORE_MS,
  probeAudioDurationSeconds,
  resolveDjBreakExecutionScenario,
  resolveIntroDurationSec,
  type DjBreakExecutionScenario,
} from "@/lib/player/webOrchestrator";
import { StingerEngine } from "@/lib/audio/StingerEngine";
import { BufferedVoiceNode } from "@/lib/audio/VoiceNode";
import { createVolumeController } from "@/lib/audio/volume-controller";
import {
  getPersonaUiDisplayName,
  resolveActiveHost,
} from "@/lib/dj/personaConfig";
import {
  getStationLaunchLiner,
  shouldPauseForStationLaunchVocals,
  STATION_LAUNCH_RESTORE_MS,
} from "@/lib/dj/scriptGenerator";
import { generateDjBreak, playDjIntro } from "@/lib/dj-intro";
import { recordFailedYoutubeId } from "@/lib/failed-youtube-ids";
import {
  finishDjSegment,
  resetDjBroadcast,
  startDjSegment,
  type DjSegmentInput,
} from "@/lib/dj/broadcast-state";
import {
  createDjSchedulerState,
  DEFAULT_DJ_PACING,
  planDjSegment,
  resetDjSchedulerState,
} from "@/lib/dj/scheduler";
import { getYouTubeThumbnail } from "@/lib/youtube";
import type { VolumeController } from "@/types/audio";
import type {
  CommentaryFormat,
  DjSegmentKind,
  DjTrackContext,
  LocalConcertEvent,
} from "@/types/dj";
import { DEFAULT_COMMENTARY_FORMAT } from "@/types/dj";
import {
  DEFAULT_CHATTER_PACING,
  DEFAULT_STATION_MODE,
  type AlbumContext,
  type ChatterPacing,
  type EraLock,
  type StationMode,
  type VoiceProfileOverride,
} from "@/types/station";
import type { TtsProvider } from "@/types/voice";

const DJ_BREAK_TITLES: Record<DjSegmentKind, string> = {
  song_intro: "Song Intro",
  recap: "Recap",
  up_next: "Up Next",
  artist_trivia: "Artist Trivia",
  local_events: "Local Events",
  stinger: "Station ID",
};

export type AudioPlayerHandle = {
  skipNext: () => void;
  skipPrev: () => void;
  /**
   * Natural end-of-song advance (companion Spotify near-end / finished).
   * Unlike `skipNext`, this does not count as a listener skip and skips the
   * tune-in sweep so the DJ loop can cross into the next track cleanly.
   */
  advanceEnded: (alignTo?: {
    spotifyId?: string | null;
    title?: string;
    artist?: string;
  }) => void;
  /** Alias for {@link advanceEnded} — station-queue autopilot entry point. */
  playNextTrack: (alignTo?: {
    spotifyId?: string | null;
    title?: string;
    artist?: string;
  }) => void;
  unlockAudio: () => void;
  getQueue: () => { queue: StationTrack[]; currentIndex: number };
  removeTrack: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  /** Jump playhead to an absolute queue index and start that track immediately. */
  jumpToTrack: (index: number) => void;
  /**
   * Align queue cursor to a track Spotify already advanced to (multi-URI).
   * Updates Playlist / Broadcast Log without re-issuing companion `play()`.
   */
  syncIndexToPlayingTrack: (alignTo: {
    spotifyId?: string | null;
    title?: string;
    artist?: string;
  }) => void;
  /** Shuffle only the unplayed tail — does not interrupt the on-air track. */
  shuffleRemainingTracks: () => void;
  insertTrackNext: (track: StationTrack) => void;
  appendTrack: (track: StationTrack) => void;
  /**
   * Purges tracks the listener has just banned. Call after recording a ban —
   * the queue downstream was assembled before it existed.
   *
   * Ban / like gestures and the TrackPreferenceDrawer live on the deck
   * (`TrackFeedbackControls` + `useTrackPreferences`); this handle only
   * drops matching queue entries once the blacklist has been written.
   */
  dropBlockedTracks: () => void;
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
  /** Free STANDARD voice override forwarded to `/api/generate-voice`. */
  preferredVoice?: string;
  /** Subscription tier for the server-side Pro voice-engine guard. */
  subscriptionTier?: "free" | "pro";
  djPacingFrequency?: number;
  /** Listener-facing DJ talk density — overrides `djPacingFrequency` when set. */
  chatterPacing?: ChatterPacing;
  stationName?: string;
  /** Dial position of the live station — the only frequency the DJ may announce. */
  stationFrequency?: number;
  /** Decade the station is locked to — filters the catalog and constrains the host. */
  eraLock?: EraLock;
  /** Listener-authored direction for this station's tone */
  vibePrompt?: string;
  /** Listening format — `album_deep_dive` plays the record in order via `buildStationQueue()` */
  stationMode?: StationMode;
  /** Sleeve metadata for an `album_deep_dive` station; cited by the host and ignored otherwise */
  albumContext?: AlbumContext | null;
  /** Listener-tuned delivery knobs layered on the assigned host */
  voiceProfile?: VoiceProfileOverride | null;
  /** Lore / commentary depth from Host Settings (extended formats are Pro). */
  commentaryFormat?: CommentaryFormat;
  listenerLocation?: ListenerLocation | null;
  maxDurationInSeconds?: number;
  onPlayingChange?: (playing: boolean) => void;
  /** Fires on every queue mutation. `ready` is false while the initial catalog replenish is still in flight. */
  onQueueChange?: (queue: StationTrack[], currentIndex: number, ready: boolean) => void;
  incrementSongCounter?: () => number;
  addToPlayHistory?: (entry: {
    id: string;
    title: string;
    artist: string;
    stationId: string;
    youtubeId: string;
  }) => void;
  /**
   * When a Spotify/Apple companion source is connected, voiced breaks go through
   * WebOrchestrator (Spotify duck / Apple pause) instead of the YouTube TTS path.
   */
  companionActive?: boolean;
  /**
   * Force the companion stream onto this queue track (Spotify `play({ uris })`).
   * Called on every advance — including silent transitions — so music never stalls.
   */
  onCompanionPlayTrack?: (track: {
    title: string;
    artist: string;
    youtubeId: string;
    album?: string;
    introDuration?: number;
  }) => void | Promise<void>;
  /** Fires a companion lore break for the live track; must not throw. */
  onCompanionDjBreak?: (track: {
    title: string;
    artist: string;
    youtubeId: string;
    album?: string;
    introDuration?: number;
  }) => void | Promise<void>;
  /**
   * Live Spotify scrubber position (seconds). When set with companion mode,
   * the existing progress bar mirrors the remote stream instead of YouTube.
   */
  companionCurrentTime?: number;
  /** Live Spotify track duration in seconds. */
  companionDuration?: number;
  /** Scrub → Spotify seek (position in seconds). */
  onCompanionSeek?: (positionSeconds: number) => void;
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

/**
 * Synthesize a Track #0 launch liner via `/api/generate-script` `customText`
 * (TTS only — no LLM script generation).
 */
async function synthesizeStationLaunchLiner(input: {
  customText: string;
  voiceId: string;
  personaId?: string;
  tier: "free" | "pro";
  title: string;
  artist: string;
  trackId: string;
  signal?: AbortSignal;
}): Promise<{ audioBlob: Blob; script: string } | null> {
  const response = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customText: input.customText,
      voiceId: input.voiceId,
      hostId: input.personaId,
      personaId: input.personaId,
      tier: input.tier,
      title: input.title,
      artist: input.artist,
      trackId: input.trackId,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    console.warn(
      "[AudioPlayer] Station launch liner TTS failed:",
      response.status,
    );
    return null;
  }

  const payload = (await response.json()) as {
    audioUrl?: string;
    script?: string;
  };
  if (!payload.audioUrl) return null;

  const audioResponse = await fetch(payload.audioUrl, { signal: input.signal });
  if (!audioResponse.ok) return null;

  const audioBlob = await audioResponse.blob();
  return {
    audioBlob,
    script: payload.script?.trim() || input.customText,
  };
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
    preferredVoice,
    subscriptionTier = "free",
    djPacingFrequency = DEFAULT_DJ_PACING,
    chatterPacing = DEFAULT_CHATTER_PACING,
    stationName = "",
    stationFrequency,
    eraLock = "all",
    vibePrompt = "",
    stationMode = DEFAULT_STATION_MODE,
    albumContext = null,
    voiceProfile = null,
    commentaryFormat = DEFAULT_COMMENTARY_FORMAT,
    listenerLocation = null,
    maxDurationInSeconds = 5,
    onPlayingChange,
    onQueueChange,
    incrementSongCounter,
    addToPlayHistory,
    companionActive = false,
    onCompanionPlayTrack,
    onCompanionDjBreak,
    companionCurrentTime,
    companionDuration,
    onCompanionSeek,
  },
  ref,
) {
  const { activeProvider, djVolume } = useMusicSource();
  const { homeCity } = useUserPreferences();
  /** Spotify owns the stream — freeze the local HTML5 / preview element. */
  const suppressLocalAudio = activeProvider === "spotify";

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
  const preferredVoiceRef = useRef(preferredVoice);
  const subscriptionTierRef = useRef(subscriptionTier);
  const djPacingRef = useRef(djPacingFrequency);
  const chatterPacingRef = useRef(chatterPacing);
  const maxDurationRef = useRef(maxDurationInSeconds);
  const stationIdRef = useRef(stationId);
  const songTitleRef = useRef(songTitle);
  const artistNameRef = useRef(artistName);
  const stationQueueModeRef = useRef(stationQueueMode);
  const stationNameRef = useRef(stationName);
  const stationFrequencyRef = useRef(stationFrequency);
  const eraLockRef = useRef(eraLock);
  const vibePromptRef = useRef(vibePrompt);
  const albumContextRef = useRef(albumContext);
  const voiceProfileRef = useRef(voiceProfile);
  const commentaryFormatRef = useRef(commentaryFormat);
  const homeCityRef = useRef(homeCity);
  const listenerLocationRef = useRef(listenerLocation);
  const queueRef = useRef<StationTrack[]>([]);
  const currentIndexQueueRef = useRef(0);
  /**
   * Set while {@link syncIndexToPlayingTrack} moves the cursor to a track
   * Spotify already started. `handleNewTrack` updates Broadcast Log / counters
   * but must not re-issue companion `playTrack()` or a local companion break.
   */
  const suppressCompanionReplayRef = useRef(false);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const djSchedulerRef = useRef(createDjSchedulerState());
  const localEventCacheRef = useRef(new Map<string, LocalConcertEvent | null>());
  /** Local music transport for Track #0 pause-talk-resume (YouTube / preview). */
  const musicTransportRef = useRef({
    pause: () => {},
    play: () => {},
    seekTo: (_seconds: number) => {},
  });
  /**
   * The break about to air, held until the voice channel actually opens. The
   * script arrives before playback — and for a warmed break, a whole track
   * before it — so the teleprompter's clock is started from the voice node's own
   * `onStarted` rather than from here.
   */
  const pendingSegmentRef = useRef<DjSegmentInput | null>(null);

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
  const companionActiveRef = useRef(companionActive);
  const onCompanionPlayTrackRef = useRef(onCompanionPlayTrack);
  const onCompanionDjBreakRef = useRef(onCompanionDjBreak);

  personaIdRef.current = personaId;
  ttsProviderRef.current = ttsProvider;
  preferredVoiceRef.current = preferredVoice;
  subscriptionTierRef.current = subscriptionTier;
  djPacingRef.current = djPacingFrequency;
  chatterPacingRef.current = chatterPacing;
  maxDurationRef.current = maxDurationInSeconds;
  stationIdRef.current = stationId;
  songTitleRef.current = songTitle;
  artistNameRef.current = artistName;
  stationQueueModeRef.current = stationQueueMode;
  stationNameRef.current = stationName;
  stationFrequencyRef.current = stationFrequency;
  eraLockRef.current = eraLock;
  vibePromptRef.current = vibePrompt;
  albumContextRef.current = albumContext;
  voiceProfileRef.current = voiceProfile;
  commentaryFormatRef.current = commentaryFormat;
  homeCityRef.current = homeCity;
  listenerLocationRef.current = listenerLocation;
  onQueueChangeRef.current = onQueueChange;
  companionActiveRef.current = companionActive;
  onCompanionPlayTrackRef.current = onCompanionPlayTrack;
  onCompanionDjBreakRef.current = onCompanionDjBreak;

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
    playNextTrack,
    syncIndexToPlayingTrack,
    prevTrack,
    resetQueue,
    ready: queueReady,
    removeTrack,
    reorderQueue,
    jumpToTrack,
    shuffleRemainingTracks,
    insertTrackNext,
    appendTrack,
    updateTrackAt,
    dropBlockedTracks,
    notePlaybackProgress,
    takePrefetchedDjBreak,
    clearPrefetchedDjBreaks,
    prefetchTrackKeyFor,
  } = useStationQueue({
    stationId,
    initialTracks: stationTracks,
    onTrackChange: stationQueueMode ? notifyTrackChange : undefined,
    eraLock,
    mode: stationMode,
    albumContext,
  });

  queueRef.current = queue;
  currentIndexQueueRef.current = currentIndex;
  const notePlaybackProgressRef = useRef(notePlaybackProgress);
  notePlaybackProgressRef.current = notePlaybackProgress;

  useEffect(() => {
    if (stationQueueMode) onQueueChangeRef.current?.(queue, currentIndex, queueReady);
  }, [queue, currentIndex, queueReady, stationQueueMode]);

  useEffect(() => {
    // The launch key lets the queue collapse the duplicate runs StrictMode and
    // Fast Refresh trigger, so one launch draws exactly one opener.
    if (stationQueueMode) void resetQueue(`${stationId}:${queueGeneration}`);
    djSchedulerRef.current = resetDjSchedulerState();
    // A warmed break carries the scheduler state it was planned against, which
    // the reset above has just invalidated.
    djPrefetch.clear();
    clearPrefetchedDjBreaks();
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
    pendingSegmentRef.current = null;
    voiceNodeRef.current?.stop();
    duckBusRef.current?.setVolume(UNDUCKED_GAIN);
    // A stopped clip fires neither `ended` nor `error`, so the transcript log
    // has to be closed from here or the break stays open forever.
    finishDjSegment({ interrupted: true });
  }, []);

  useEffect(() => {
    sessionOpeningDjRef.current = true;
    errorCountRef.current = 0;
    abortIntro();
    // Transcripts are session-scoped, and `abortIntro` above has already closed
    // whatever the outgoing station left on air.
    resetDjBroadcast();
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
    if (stationQueueMode) {
      void nextTrack({
        positionSeconds: currentTimeRef.current,
        durationSeconds: durationRef.current,
        reason: "ended",
      });
    } else onEnded?.();
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
    videoId: suppressLocalAudio || isPreviewMode ? undefined : videoId,
    isPlaying: suppressLocalAudio ? false : isPlaying,
    volume,
    onEnded: handlePlaybackEnded,
    onError: handlePlaybackError,
    onPlaying,
    onPaused,
  });

  const previewControls = usePreviewPlayer({
    // Spotify companion mode: do not load or start local web preview clips.
    previewUrl: suppressLocalAudio ? undefined : isPreviewMode ? previewUrl : undefined,
    isPlaying: suppressLocalAudio ? false : isPlaying,
    volume,
    onEnded: handlePlaybackEnded,
    onError: handlePlaybackError,
    onPlaying,
    onPaused,
  });

  const { unlockAudio: unlockYouTube } = youtubeControls;
  const {
    unlockAudio: unlockPreview,
    pausePlayback: pausePreviewPlayback,
    seekTo: seekPreviewTo,
  } = previewControls;

  // Spotify companion: keep the HTML5 local player frozen at 0:00 — never
  // start a web preview clip while the remote device owns the stream.
  useEffect(() => {
    if (!suppressLocalAudio) return;
    pausePreviewPlayback();
    seekPreviewTo(0);
  }, [suppressLocalAudio, pausePreviewPlayback, seekPreviewTo]);

  /**
   * Spotify suppresses the YouTube/preview engines, so `onPlaying` never fires
   * and the companion Duck–Talk–Swell path would stall. Kick `handleNewTrack`
   * from the queue key instead. Session openers are owned by `page.tsx` →
   * `launchCompanionTrack` (TRACE 1b); this effect only advances follow-up tracks.
   */
  useEffect(() => {
    if (!companionActive || !suppressLocalAudio || !trackKey) return;

    if (sessionOpeningDjRef.current) {
      sessionOpeningDjRef.current = false;
      trackSessionRef.current = trackKey;
      return;
    }

    void handleNewTrackRef.current();
  }, [companionActive, suppressLocalAudio, trackKey, queueGeneration]);

  const unlockActivePlayer = useCallback(() => {
    if (suppressLocalAudio) return;
    if (isPreviewMode) unlockPreview();
    else unlockYouTube();
  }, [suppressLocalAudio, isPreviewMode, unlockPreview, unlockYouTube]);

  const unlockBothPlayers = useCallback(() => {
    markAudioUnlockRequested();
    unlockActivePlayer();
    // Both run inside the gesture that reaches here, which is the only moment an
    // audio context can be opened already running rather than suspended. The
    // analyser refuses to reroute a clip into a suspended graph, so without this
    // the visualizer would never see the voice channel.
    stingers.unlock();
    getMasterAnalyser().unlock();
  }, [unlockActivePlayer, stingers]);

  const localControls = isPreviewMode ? previewControls : youtubeControls;
  musicTransportRef.current = {
    pause: () => localControls.pausePlayback(),
    play: () => localControls.provider.play(),
    seekTo: (seconds: number) => localControls.seekTo(seconds),
  };
  const useCompanionScrub =
    suppressLocalAudio &&
    companionActive &&
    typeof companionCurrentTime === "number" &&
    typeof companionDuration === "number" &&
    companionDuration > 0;
  const currentTime = useCompanionScrub
    ? companionCurrentTime
    : localControls.currentTime;
  const duration = useCompanionScrub
    ? companionDuration
    : localControls.duration;
  const seekTo = useCompanionScrub
    ? (positionSeconds: number) => {
        onCompanionSeek?.(positionSeconds);
      }
    : localControls.seekTo;
  currentTimeRef.current = currentTime;
  durationRef.current = duration;

  // Implicit preference: credit a completed listen once the needle passes 80%.
  useEffect(() => {
    if (!stationQueueMode || duration <= 0) return;
    notePlaybackProgressRef.current({
      positionSeconds: currentTime,
      durationSeconds: duration,
      reason: "progress",
    });
  }, [stationQueueMode, currentTime, duration]);

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

  // Host Settings DJ Voice Volume — live GainNode / element update mid-break.
  useEffect(() => {
    voiceNode.setDjVolume(djVolume);
  }, [djVolume, voiceNode]);

  // Same deal for the SFX bus: master only, never the duck gain.
  useEffect(() => {
    stingers.setMasterVolume(volume);
  }, [volume, stingers]);

  useEffect(() => {
    voiceNode.providerId = ttsProvider;
  }, [ttsProvider, voiceNode]);

  /**
   * Publishes the break to the broadcast log at the speech boundaries.
   *
   * The node's own callbacks are the only honest source for those boundaries:
   * `playDjIntro` settles a full restore ramp after the host stops talking, and
   * the warmed path starts speaking the instant it is called. Writing to the
   * store never re-renders this component, so the teleprompter can subscribe
   * without putting the voice node's lifetime at risk.
   */
  useEffect(() => {
    voiceNode.setEventHandlers({
      onStarted: () => {
        const pending = pendingSegmentRef.current;
        // Consumed once: a superseded clip must not reopen a stale segment.
        pendingSegmentRef.current = null;
        if (pending?.script) startDjSegment(pending);
      },
      onEnded: () => finishDjSegment(),
      onError: () => finishDjSegment({ interrupted: true }),
    });
  }, [voiceNode]);

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

    // Spotify multi-URI auto-advance already owns playback + Duck–Talk–Swell
    // (`registerTrack`). Cursor sync only needs history / counter updates.
    if (suppressCompanionReplayRef.current) {
      suppressCompanionReplayRef.current = false;
      return;
    }

    if (!stationQueueModeRef.current) return;

    /**
     * A break the lookahead warmed during the previous track. Its scheduler
     * decision was taken then, so re-planning here would both roll a different
     * break than the one already synthesized and charge the transition to the
     * pacing budget twice.
     */
    const reservation = sessionOpeningDjRef.current ? null : djPrefetch.take(startedKey);
    const warmed = reservation ? await reservation : null;

    const activeTrackEarly = resolveLiveTrack();
    /**
     * Claim a zero-latency clip from the shared `prefetchedBreaksMap` (station
     * queue engine). Prefer the controller reservation for scheduler state;
     * the map clip still supplies audio when the controller missed.
     */
    const mapKey = activeTrackEarly
      ? prefetchTrackKeyFor(activeTrackEarly)
      : startedKey;
    // Companion leaves the shared map for WebOrchestrator.resolveDjAudio.
    // Local YouTube claims it here so playDjIntro can air the warmed clip.
    const mapBreak =
      sessionOpeningDjRef.current
      || warmed?.audioBlob
      || companionActiveRef.current
        ? null
        : takePrefetchedDjBreak(mapKey);
    const warmedAudioBlob = warmed?.audioBlob ?? mapBreak?.audioBlob;
    const warmedScript = warmed?.script ?? mapBreak?.script;

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

    const activeTrack = resolveLiveTrack() ?? activeTrackEarly;
    const announceTitle = activeTrack?.title ?? title;
    const announceArtist = activeTrack?.artist ?? artist;
    const announceAlbum = activeTrack?.album ?? album;

    const isSessionOpening = sessionOpeningDjRef.current;
    const { transition, plan, nextState } =
      warmed ??
      planDjSegment(djSchedulerRef.current, {
        currentTrack: { title: announceTitle, artist: announceArtist, album: announceAlbum },
        upNextTracks: queueRef.current
          .slice(currentIndexQueueRef.current + 1, currentIndexQueueRef.current + 3)
          .map(toDjTrackContext),
        pacingFrequency: djPacingRef.current,
        chatterPacing: chatterPacingRef.current,
        localEvent,
        listenerCity: listenerLocationRef.current?.city,
        isSessionOpening,
      });
    djSchedulerRef.current = nextState;

    if (sessionOpeningDjRef.current) {
      sessionOpeningDjRef.current = false;
    }

    const companionTrack = {
      title: announceTitle,
      artist: announceArtist,
      youtubeId: activeTrack?.youtubeId ?? videoId ?? "",
      album: announceAlbum,
      introDuration: activeTrack?.introDuration,
    };

    // Spotify companion owns the stream: every queue advance (including silent
    // music-only transitions) must `play({ uris })` the station's next track
    // or the remote player stalls at the previous song.
    if (companionActiveRef.current) {
      // Local VoiceNode preload is unused on the companion path; discard it.
      // Shared `prefetchedBreaksMap` clips stay for WebOrchestrator.resolveDjAudio.
      releaseWarmedClip();
      const playTrack = onCompanionPlayTrackRef.current;
      const companionBreak = onCompanionDjBreakRef.current;
      const voiced = transition !== "silent" && !!plan && !!companionBreak;

      if (voiced) {
        const introDurationSec = resolveIntroDurationSec(activeTrack);
        const remainingInstrumentalSec = Math.max(
          0,
          durationRef.current - currentTimeRef.current,
        );
        // Outgoing instrumental bed still playing → Scenario B (talk, then play).
        const outroDuck =
          !isSessionOpening
          && remainingInstrumentalSec > 0
          && remainingInstrumentalSec <= Math.max(introDurationSec, 8)
          && currentTimeRef.current > introDurationSec;
        // Cold vocal start → Scenario C: host first, then play at full level.
        const hardPauseFirst =
          introDurationSec < COLD_VOCAL_INTRO_THRESHOLD_SEC || outroDuck;

        if (hardPauseFirst) {
          try {
            await companionBreak(companionTrack);
          } catch (error) {
            console.error("[LinerLore TRACE ERROR]", error);
            console.warn("[AudioPlayer] companion DJ break failed:", error);
          }
          if (playTrack) {
            try {
              await playTrack(companionTrack);
            } catch (error) {
              console.error("[LinerLore TRACE ERROR]", error);
              console.warn("[AudioPlayer] companion play failed:", error);
            }
          }
          return;
        }

        // Scenario A: start incoming (orchestrator ducks to 0.18) with speech.
        const breakWork = companionBreak(companionTrack);
        if (playTrack) {
          try {
            await playTrack(companionTrack);
          } catch (error) {
            console.error("[LinerLore TRACE ERROR]", error);
            console.warn("[AudioPlayer] companion play failed:", error);
          }
        }
        try {
          await breakWork;
        } catch (error) {
          console.error("[LinerLore TRACE ERROR]", error);
          console.warn("[AudioPlayer] companion DJ break failed:", error);
        }
        return;
      }

      if (playTrack) {
        try {
          await playTrack(companionTrack);
        } catch (error) {
          console.error("[LinerLore TRACE ERROR]", error);
          console.warn("[AudioPlayer] companion play failed:", error);
        }
      }
      return;
    }

    if (transition === "silent" || !plan) return;

    abortIntro();

    const controller = new AbortController();
    introAbortRef.current = controller;
    introRunningRef.current = true;

    const activeHost = resolveActiveHost(
      subscriptionTierRef.current === "pro"
        ? (personaIdRef.current ?? "miles")
        : (preferredVoiceRef.current || personaIdRef.current || "sam"),
      subscriptionTierRef.current === "pro",
    );

    // Track #0 station open: fast liner → TTS only (no LLM), with instrumental
    // duck or vocal-safe pause at 0:00.
    if (isSessionOpening) {
      const liner = getStationLaunchLiner(
        stationNameRef.current,
        announceArtist,
        announceTitle,
      );
      pendingSegmentRef.current = {
        kind: plan.kind,
        transition,
        script: liner,
        songTitle: announceTitle,
        artistName: announceArtist,
        stationName: stationNameRef.current,
        personaId: activeHost.personaId,
      };

      const positionMs = currentTimeRef.current * 1000;
      const pauseForVocals = shouldPauseForStationLaunchVocals(positionMs);
      if (pauseForVocals) {
        musicTransportRef.current.pause();
        musicTransportRef.current.seekTo(0);
      } else {
        // Instrumental hold: bed plays under the liner at 18%.
        duckBus.rampVolume(duckBus.getVolume(), DUCK_RATIO, DUCK_RAMP_MS);
      }

      try {
        const synthesized = await synthesizeStationLaunchLiner({
          customText: liner,
          voiceId: activeHost.voiceId,
          personaId:
            subscriptionTierRef.current === "pro"
              ? (personaIdRef.current ?? activeHost.personaId)
              : activeHost.personaId,
          tier: subscriptionTierRef.current,
          title: announceTitle,
          artist: announceArtist,
          trackId: startedKey,
          signal: controller.signal,
        });
        if (!synthesized || !isTrackStillActive(startedKey)) {
          if (pauseForVocals) musicTransportRef.current.play();
          return;
        }
        if (pendingSegmentRef.current) {
          pendingSegmentRef.current.script = synthesized.script;
        }

        await voiceNode.play({
          audioBlob: synthesized.audioBlob,
          signal: controller.signal,
          duckingTarget: pauseForVocals ? undefined : duckBus,
          ducking: pauseForVocals
            ? undefined
            : {
                duckRatio: DUCK_RATIO,
                rampInMs: 0,
                rampOutMs: STATION_LAUNCH_RESTORE_MS,
              },
          onRestore: () => {
            // Speech ended: resume cold-start vocals, or ride the 600ms swell.
            if (pauseForVocals) musicTransportRef.current.play();
            stingers.playVinylScratch();
          },
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.warn("[AudioPlayer] Station launch liner failed:", error);
        }
        if (pauseForVocals && introAbortRef.current === controller) {
          musicTransportRef.current.play();
        }
      } finally {
        if (introAbortRef.current === controller) {
          introRunningRef.current = false;
          introAbortRef.current = null;
          duckBus.setVolume(UNDUCKED_GAIN);
        }
      }
      return;
    }

    // Staged for the voice node's `onStarted` to publish. Everything but the
    // script is known now; the script lands through `onScript` below, on both
    // the warmed and the live path.
    pendingSegmentRef.current = {
      kind: plan.kind,
      transition,
      script: "",
      songTitle: announceTitle,
      artistName: announceArtist,
      stationName: stationNameRef.current,
      personaId: activeHost.personaId,
    };

    // Intro / outro ducking — no blanket hard-pause on every transition.
    const introDurationSec = resolveIntroDurationSec(activeTrack);
    const positionSeconds = currentTimeRef.current;
    const durationSeconds = durationRef.current;
    const remainingSec =
      durationSeconds > 0 ? Math.max(0, durationSeconds - positionSeconds) : 0;
    let djAudioDurationSec = FALLBACK_DJ_AUDIO_DURATION_SEC;
    if (warmedAudioBlob) {
      djAudioDurationSec =
        (await probeAudioDurationSeconds(warmedAudioBlob, controller.signal))
        ?? Math.max(FALLBACK_DJ_AUDIO_DURATION_SEC, maxDurationRef.current);
    } else {
      // Live TTS: optimistic estimate so we can hold the bed before synthesis.
      djAudioDurationSec = Math.max(
        FALLBACK_DJ_AUDIO_DURATION_SEC,
        maxDurationRef.current,
      );
    }
    const remainingInstrumentalSec =
      positionSeconds > introDurationSec
      && remainingSec > 0
      && remainingSec <= Math.max(djAudioDurationSec + 1, 8)
        ? remainingSec
        : null;
    const scenario: DjBreakExecutionScenario = resolveDjBreakExecutionScenario({
      introDurationSec,
      djAudioDurationSec,
      remainingInstrumentalSec,
    });

    console.log("[LinerLore TRACE] AudioPlayer break scenario", {
      trackKey: startedKey,
      introDurationSec,
      djAudioDurationSec,
      remainingInstrumentalSec,
      scenario,
      positionSeconds,
    });

    if (scenario === "hard_pause") {
      musicTransportRef.current.pause();
    } else {
      // Scenario A/B: start (or keep) the bed at the 18% duck floor.
      duckBus.rampVolume(duckBus.getVolume(), DUCK_RATIO, DUCK_RAMP_MS);
    }

    try {
      await playDjIntro({
        songTitle: announceTitle,
        artistName: announceArtist,
        maxDurationInSeconds: maxDurationRef.current,
        personaId: (
          subscriptionTierRef.current === "pro"
            ? personaIdRef.current
            : undefined
        ),
        provider: activeHost.provider,
        voice: activeHost.voiceId,
        tier: subscriptionTierRef.current,
        stationId: stationIdRef.current,
        stationName: stationNameRef.current,
        stationFrequency: stationFrequencyRef.current,
        eraLock: eraLockRef.current,
        vibePrompt: vibePromptRef.current,
        albumContext: albumContextRef.current,
        voiceProfile: voiceProfileRef.current,
        commentaryFormat: commentaryFormatRef.current,
        homeCity: homeCityRef.current,
        segmentPlan: plan,
        audioBlob: warmedAudioBlob,
        script: warmedScript,
        onScript: (script) => {
          if (pendingSegmentRef.current) pendingSegmentRef.current.script = script;
        },
        voiceNode,
        duckBus,
        duckMusic: scenario !== "hard_pause",
        ducking:
          scenario === "intro_ramp"
            ? {
                duckRatio: DUCK_RATIO,
                rampInMs: 0,
                rampOutMs: INTRO_RAMP_RESTORE_MS,
              }
            : scenario === "outro_duck"
              ? {
                  duckRatio: DUCK_RATIO,
                  rampInMs: 0,
                  rampOutMs: DUCK_RAMP_MS,
                }
              : undefined,
        signal: controller.signal,
        // Fires with the restore ramp, so the scratch rides the music coming
        // back up instead of landing in the gap before it.
        onBreakExit: () => {
          if (scenario === "hard_pause") {
            duckBus.setVolume(UNDUCKED_GAIN);
            musicTransportRef.current.play();
          }
          stingers.playVinylScratch();
        },
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.warn("[AudioPlayer] DJ intro failed:", error);
      }
      if (scenario === "hard_pause" && introAbortRef.current === controller) {
        musicTransportRef.current.play();
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
    takePrefetchedDjBreak,
    prefetchTrackKeyFor,
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
    // Companion owns TTS via WebOrchestrator — skip local warmup to avoid
    // double synthesis that would only be discarded at the transition.
    if (companionActive) return;
    // The session opener is planned live at track one and has no preceding
    // track to warm from.
    if (sessionOpeningDjRef.current) return;
    // The on-air track has not been charged to the scheduler yet, so planning
    // the next one would build on state that is about to change underneath it.
    if (!trackKey || trackSessionRef.current !== trackKey) return;
    if (!shouldStartLookahead({
      position: currentTime,
      duration,
      trackId: trackKey || upcomingKey,
    })) return;

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
        chatterPacing: chatterPacingRef.current,
        localEvent,
        listenerCity: listenerLocationRef.current?.city,
        isSessionOpening: false,
      });

      if (transition === "silent" || !plan) return { transition, plan, nextState };

      // Kept alongside the clip: this is the only moment the text exists, and
      // the break it belongs to is still a track away from airing.
      let script = "";
      const activeHost = resolveActiveHost(
        subscriptionTierRef.current === "pro"
          ? (personaIdRef.current ?? "miles")
          : (preferredVoiceRef.current || personaIdRef.current || "sam"),
        subscriptionTierRef.current === "pro",
      );
      const audioBlob = await generateDjBreak({
        songTitle: track.title,
        artistName: track.artist,
        maxDurationInSeconds: maxDurationRef.current,
        personaId: (
          subscriptionTierRef.current === "pro"
            ? personaIdRef.current
            : undefined
        ),
        provider: activeHost.provider,
        voice: activeHost.voiceId,
        tier: subscriptionTierRef.current,
        stationId: stationIdRef.current,
        stationName: stationNameRef.current,
        stationFrequency: stationFrequencyRef.current,
        eraLock: eraLockRef.current,
        vibePrompt: vibePromptRef.current,
        albumContext: albumContextRef.current,
        voiceProfile: voiceProfileRef.current,
        commentaryFormat: commentaryFormatRef.current,
        homeCity: homeCityRef.current,
        segmentPlan: plan,
        signal,
        onScript: (text) => {
          script = text;
        },
      });

      return {
        transition,
        plan,
        nextState,
        audioBlob: audioBlob ?? undefined,
        script,
      };
    });
  }, [
    currentTime,
    duration,
    trackKey,
    upcomingKey,
    stationQueueMode,
    companionActive,
    djPrefetch,
    resolveLocalEvent,
  ]);

  const skipNext = useCallback(() => {
    abortIntro();
    errorCountRef.current = 0;
    trackSessionRef.current = null;
    stingers.playFrequencySweep();
    if (stationQueueMode) {
      void nextTrack({
        positionSeconds: currentTimeRef.current,
        durationSeconds: durationRef.current,
        reason: "skip",
      });
    }
  }, [abortIntro, stationQueueMode, nextTrack, stingers]);

  const skipPrev = useCallback(() => {
    abortIntro();
    errorCountRef.current = 0;
    trackSessionRef.current = null;
    stingers.playFrequencySweep();
    if (stationQueueMode) prevTrack();
  }, [abortIntro, stationQueueMode, prevTrack, stingers]);

  const mediaPlay = useCallback(() => {
    musicTransportRef.current.play();
    onPlayingChange?.(true);
  }, [onPlayingChange]);

  const mediaPause = useCallback(() => {
    musicTransportRef.current.pause();
    onPlayingChange?.(false);
  }, [onPlayingChange]);

  const mediaPlayPause = useCallback(() => {
    if (isPlaying) mediaPause();
    else mediaPlay();
  }, [isPlaying, mediaPause, mediaPlay]);

  const { activeSegment, isSpeaking } = useDjState();
  const isProTier = subscriptionTier === "pro";
  const hostDisplayName = useMemo(() => {
    const seed = isProTier
      ? (personaId ?? "miles")
      : (preferredVoice || personaId || "sam");
    const host = resolveActiveHost(seed, isProTier);
    return host.displayName || getPersonaUiDisplayName(String(seed), "Host");
  }, [isProTier, personaId, preferredVoice]);

  const liveTitle = stationQueueMode
    ? (currentTrack?.title ?? songTitle)
    : songTitle;
  const liveArtist = stationQueueMode
    ? (currentTrack?.artist ?? artistName)
    : artistName;
  const liveAlbum =
    currentTrack?.album?.trim() ||
    albumContext?.albumTitle?.trim() ||
    stationName ||
    "SongGhost Radio";
  const liveYoutubeId =
    currentTrack?.youtubeId?.trim() || youtubeId?.trim() || "";
  const liveArtworkUrl = liveYoutubeId
    ? getYouTubeThumbnail(liveYoutubeId)
    : "";

  const mediaMetadata = useMemo(() => {
    if (!liveTitle.trim() && !isSpeaking) return null;

    if (isSpeaking && activeSegment) {
      const breakTitle =
        DJ_BREAK_TITLES[activeSegment.kind] ||
        activeSegment.songTitle ||
        "DJ Break";
      return {
        title: breakTitle,
        artist: hostDisplayName,
        album: activeSegment.stationName || stationName || "SongGhost Radio",
        artworkUrl: liveArtworkUrl || null,
        youtubeId: liveYoutubeId || null,
      };
    }

    if (!liveTitle.trim() || !liveArtist.trim()) return null;
    return {
      title: liveTitle,
      artist: liveArtist,
      album: liveAlbum,
      artworkUrl: liveArtworkUrl || null,
      youtubeId: liveYoutubeId || null,
    };
  }, [
    activeSegment,
    hostDisplayName,
    isSpeaking,
    liveAlbum,
    liveArtist,
    liveArtworkUrl,
    liveTitle,
    liveYoutubeId,
    stationName,
  ]);

  // Companion Spotify owns Media Session via WebOrchestrator — avoid dual binds.
  useMediaSession({
    enabled: !companionActive && Boolean(mediaMetadata),
    metadata: mediaMetadata,
    playbackState: isPlaying ? "playing" : "paused",
    onPlay: mediaPlay,
    onPause: mediaPause,
    onNextTrack: skipNext,
    onPreviousTrack: skipPrev,
  });

  useImperativeHandle(
    ref,
    () => ({
      // Only the manual skips sweep. A track that simply ended hands over on its
      // own and gets whatever the scheduler planned for the transition.
      skipNext,
      advanceEnded: (alignTo) => {
        abortIntro();
        errorCountRef.current = 0;
        trackSessionRef.current = null;
        if (stationQueueMode) {
          void playNextTrack(
            {
              positionSeconds: currentTimeRef.current,
              durationSeconds: durationRef.current,
              reason: "ended",
            },
            alignTo,
          );
        }
      },
      playNextTrack: (alignTo) => {
        abortIntro();
        errorCountRef.current = 0;
        trackSessionRef.current = null;
        if (stationQueueMode) {
          void playNextTrack(
            {
              positionSeconds: currentTimeRef.current,
              durationSeconds: durationRef.current,
              reason: "ended",
            },
            alignTo,
          );
        }
      },
      skipPrev,
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
      jumpToTrack: (index: number) => {
        if (!stationQueueMode) return;
        if (index === currentIndexQueueRef.current) return;
        abortIntro();
        errorCountRef.current = 0;
        trackSessionRef.current = null;
        stingers.playFrequencySweep();
        jumpToTrack(index, {
          positionSeconds: currentTimeRef.current,
          durationSeconds: durationRef.current,
          reason: "skip",
        });
      },
      syncIndexToPlayingTrack: (alignTo) => {
        if (!stationQueueMode) return;
        const before = currentIndexQueueRef.current;
        suppressCompanionReplayRef.current = true;
        const after = syncIndexToPlayingTrack(alignTo);
        // No cursor move → clear the guard so a later advance can still play.
        if (after < 0 || after === before) {
          suppressCompanionReplayRef.current = false;
        }
      },
      // Tail-only shuffle — same contract as reorder: on-air key stays put.
      shuffleRemainingTracks: () => {
        if (!stationQueueMode) return;
        shuffleRemainingTracks();
      },
      insertTrackNext: (track: StationTrack) => {
        if (!stationQueueMode) return;
        insertTrackNext(track);
      },
      appendTrack: (track: StationTrack) => {
        if (!stationQueueMode) return;
        appendTrack(track);
      },
      dropBlockedTracks: () => {
        if (!stationQueueMode) return;
        const { droppedCurrent } = dropBlockedTracks();
        // The on-air track was banned, so the break introducing it is now
        // announcing a song nobody will hear.
        if (droppedCurrent) {
          abortIntro();
          errorCountRef.current = 0;
          trackSessionRef.current = null;
        }
      },
    }),
    [
      stationQueueMode,
      skipNext,
      playNextTrack,
      skipPrev,
      abortIntro,
      unlockBothPlayers,
      queue,
      currentIndex,
      removeTrack,
      reorderQueue,
      jumpToTrack,
      syncIndexToPlayingTrack,
      shuffleRemainingTracks,
      insertTrackNext,
      appendTrack,
      dropBlockedTracks,
      stingers,
    ],
  );

  const overlayTitle =
    isSpeaking && activeSegment
      ? DJ_BREAK_TITLES[activeSegment.kind] || activeSegment.songTitle || liveTitle
      : liveTitle;
  const overlayArtist =
    isSpeaking && activeSegment ? hostDisplayName : liveArtist;

  return (
    <>
      <div
        ref={containerRef}
        className="yt-player-host fixed -left-[9999px] top-0 h-[180px] w-[320px] overflow-hidden opacity-0 pointer-events-none"
        aria-hidden="true"
      />
      <div className="song-progress w-full max-w-full min-w-0 overflow-hidden space-y-1">
        <div className="flex items-center justify-between font-mono text-xs font-bold tabular-nums text-accent">
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
      <DriveModeOverlay
        title={overlayTitle}
        artist={overlayArtist}
        album={liveAlbum}
        stationName={stationName}
        albumArt={liveArtworkUrl}
        isPlaying={isPlaying}
        isDjBreak={isSpeaking}
        hostName={hostDisplayName}
        onPlayPause={mediaPlayPause}
        onPrev={skipPrev}
        onNext={skipNext}
      />
    </>
  );
});
