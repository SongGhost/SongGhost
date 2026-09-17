"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { DEFAULT_PERSONA, type PersonaId } from "@/data/personas";
import type { StationSessionBreak, StationTrack } from "@/data/stations";
import { pickStationSessionBreak } from "@/lib/station/blueprint";
import DriveModeOverlay from "@/components/studio/DriveModeOverlay";
import { useDriveMode, useDriveModeBatterySaver } from "@/components/player/WebPlayer";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { useDjState } from "@/hooks/useDjState";
import { useMediaSession } from "@/hooks/useMediaSession";
import { useStationQueue } from "@/hooks/useStationQueue";
import { fetchArtistLocalEvent, type ListenerLocation } from "@/hooks/useListenerLocation";
import { useDirectStreamPlayer } from "@/hooks/useDirectStreamPlayer";
import { usePreviewPlayer } from "@/hooks/usePreviewPlayer";
import { useYouTubePlayer } from "@/lib/audio/legacy/useYouTubePlayer";
import {
  DirectStreamProvider,
  isHttpStreamUrl,
  resolveDirectStreamUrl,
} from "@/lib/audio/DirectStreamProvider";
import { djPrefetchTrackKey } from "@/lib/dj/prefetchEngine";
import { isSavedStationId } from "@/lib/saved-stations";
import { trackIdentity } from "@/lib/queue/builder";
import {
  buildPlaySessionId,
  type RouPerformancePayload,
} from "@/lib/rou/performance-commit";
import { canSkip, recordSkip, subscribeSkipLimiter } from "@/lib/queue/skip-limiter";
import { markAudioUnlockRequested } from "@/lib/audio-unlock";
import { DjPrefetchController, shouldStartLookahead } from "@/lib/audio/dj-prefetch";
import { isAudioTelemetryEnabled } from "@/lib/debug";
import {
  DUCK_RATIO,
  getMasterAnalyser,
  logVolumeChange,
  peekMixBusContextState,
  peekMixBusContextTime,
  RESTORE_RAMP_MS,
  UNDUCKED_GAIN,
} from "@/lib/audio/mix-bus";
import {
  FALLBACK_DJ_AUDIO_DURATION_SEC,
  probeAudioDurationSeconds,
  resolveDjBreakExecutionScenario,
  resolveIntroDurationSec,
  spotifyUriForQueueTrack,
  type DjBreakExecutionScenario,
} from "@/lib/audio/legacy/webOrchestrator";
import { StingerEngine } from "@/lib/audio/StingerEngine";
import { BufferedVoiceNode } from "@/lib/audio/VoiceNode";
import { createVolumeController } from "@/lib/audio/volume-controller";
import {
  getPersonaUiDisplayName,
  isOpenAiHostVoice,
  resolveActiveHost,
} from "@/lib/dj/personaConfig";
import {
  getStationLaunchClips,
  STATION_LAUNCH_RESTORE_MS,
  type StationLaunchHoldMode,
} from "@/lib/dj/scriptGenerator";
import { generateDjBreak, generatePavlovianDjBreak, playDjIntro } from "@/lib/dj-intro";
import { RESTORE_WATCHDOG_SLACK_MS } from "@/lib/volume-ramp";
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
  clearRootsTeaserCounter,
} from "@/lib/dj/scheduler";
import { getYouTubeThumbnail } from "@/lib/youtube";
import type { VolumeController } from "@/types/audio";
import type {
  CommentaryFormat,
  DjSegmentKind,
  DjSegmentPlan,
  DjTrackContext,
  LocalConcertEvent,
} from "@/types/dj";
import { DEFAULT_COMMENTARY_FORMAT, isLoreSegmentKind, isRootsTeaserKind } from "@/types/dj";
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

/** Live dial: persona from the station, voice from the listener pick. */
function resolveLiveHost(
  personaId: string | undefined | null,
  preferredVoice: string | undefined | null,
  isPro: boolean,
) {
  const host = resolveActiveHost(personaId || DEFAULT_PERSONA.id, isPro);
  const voice =
    preferredVoice && isOpenAiHostVoice(preferredVoice)
      ? preferredVoice
      : host.voiceId;
  return { ...host, voiceId: voice };
}

const DJ_BREAK_TITLES: Record<DjSegmentKind, string> = {
  song_intro: "Song Intro",
  recap: "Recap",
  up_next: "Up Next",
  artist_trivia: "Artist Trivia",
  local_events: "Local Events",
  stinger: "Station ID",
  roots_teaser: "Roots & Branches",
  song_id: "Song ID",
};

export type CompanionTrackPayload = {
  title: string;
  artist: string;
  youtubeId: string;
  album?: string;
  introDuration?: number;
  spotifyId?: string;
  spotifyUri?: string;
  /** Scheduler plan so companion breaks keep stinger/recap vs lore routing. */
  segmentPlan?: DjSegmentPlan;
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
   * @returns Matching queue index, or `-1` when the playing track is not in
   *   queue (caller must steer Spotify back; do not inject the track).
   */
  syncIndexToPlayingTrack: (alignTo: {
    spotifyId?: string | null;
    title?: string;
    artist?: string;
  }) => number;
  /**
   * Release the Spotify SDK handshake gate so ControlDeck may paint live
   * metadata after `syncIndexToPlayingTrack` / `onTrackStarted`.
   */
  clearSpotifySyncPending: () => void;
  /** Re-arm sessionStorage hydrate for the next queue reset (refresh desync). */
  requestSessionHydrate: () => void;
  /**
   * Align the playhead when the live Spotify item is already in queue.
   * Does not inject unrecognized tracks.
   */
  adoptPlayingTrack: (playing: {
    spotifyId?: string | null;
    title?: string;
    artist?: string;
  }) => boolean;
  /**
   * Station-switch guard: suppress companion `playTrack()` / Search until
   * `launchStation` owns playback. Sticky until {@link disarmStationHandoff}.
   */
  armStationHandoff: () => void;
  /**
   * Clear both handoff suppress flags. No-ops until the initial catalog
   * replenish has settled (`queueReady`) so a seed→replenish `trackKey` hop
   * cannot `playTrack()` on top of `launchStation`.
   */
  disarmStationHandoff: () => void;
  /** Patch a live queue row (e.g. persist a resolved Spotify catalog id). */
  updateTrackAt: (index: number, track: StationTrack) => void;
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
  /** Blueprint seed artists for statutory replenishment. */
  seedArtists?: readonly string[];
  seedGenres?: readonly string[];
  energyLevel?: number;
  catalogDepth?: number;
  /** Authored voicemail / liner cues fired on session events. */
  studioBreaks?: StationSessionBreak[];
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
  onQueueChange?: (
    queue: StationTrack[],
    currentIndex: number,
    ready: boolean,
    isSpotifySyncPending?: boolean,
  ) => void;
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
  onCompanionPlayTrack?: (track: CompanionTrackPayload) => void | Promise<void>;
  /** Fires a companion lore break for the live track; must not throw. */
  onCompanionDjBreak?: (track: CompanionTrackPayload) => void | Promise<void>;
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

/**
 * hard_pause opener resume may seek to 0:00 only when the needle is still at
 * the top. A fallback transport that leaked past this gate must not rewind.
 */
const OPENER_REWIND_GUARD_SEC = 1;

/** If opener speech never starts, swell `duckBus` back to full by this playhead. */
const LAUNCH_DUCK_WATCHDOG_SEC = 3;
/**
 * Voiced-break watchdog floor. Pavlovian (earcon + lore + optional sweeper +
 * announcement) is often ~15s; `maxDurationInSeconds` default 5 is too short.
 */
const HOST_GAP_WATCHDOG_FLOOR_SEC = 20;
/**
 * Voiced breaks only at song start, in the pre-song gap. A later YouTube
 * PLAYING bounce (mid-roll, quality switch, metadata restamp) must not start
 * a break. First `PLAYING` is well before the 8s stall skip; 15s still clears
 * a slow intro.
 */
const DJ_BREAK_PLAYHEAD_GUARD_SEC = 15;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function playbackKeyForTrack(track: StationTrack | undefined): string | undefined {
  if (!track) return undefined;
  return djPrefetchTrackKey(track);
}

/**
 * Stable on-air identity for `trackSessionRef`. Catalog ids or title+artist —
 * never raw `previewUrl` / `streamUrl`, which can swap mid-song for the same
 * recording and must not look like a new track.
 */
function trackSessionKey(
  track: StationTrack | undefined,
  fallbackVideoId?: string,
): string | undefined {
  if (!track) {
    const fallback = fallbackVideoId?.trim();
    return fallback || undefined;
  }
  // YouTube id first, matching `trackIdentity`. An iTunes/Spotify id that
  // lands mid-song is enrichment, not a new recording — treating it as a new
  // session would clear `trackSessionRef` and start a second DJ duck.
  const youtubeId = track.youtubeId?.trim();
  if (youtubeId) return youtubeId;
  const itunesId = track.itunesTrackId;
  if (typeof itunesId === "number" && Number.isFinite(itunesId)) {
    return `itunes:${itunesId}`;
  }
  const spotifyId = track.spotifyId?.trim();
  if (spotifyId) {
    return spotifyId.startsWith("spotify:track:")
      ? spotifyId
      : `spotify:track:${spotifyId}`;
  }
  const isrc = track.isrc?.trim();
  if (isrc) return `isrc:${isrc.toUpperCase()}`;
  const title = track.title?.trim() ?? "";
  const artist = track.artist?.trim() ?? "";
  if (title || artist) return `${artist}:${title}`;
  const fallback = fallbackVideoId?.trim();
  return fallback || undefined;
}

function toDjTrackContext(track: StationTrack): DjTrackContext {
  return { title: track.title, artist: track.artist, album: track.album };
}

/**
 * Synthesize a Track #0 launch liner via `/api/generate-voice` so the active
 * persona `ttsInstructions` apply. No LLM script generation.
 */
async function synthesizeStationLaunchLiner(input: {
  customText: string;
  voiceId: string;
  personaId?: string;
  provider?: string;
  tier: "free" | "pro";
  signal?: AbortSignal;
}): Promise<{ audioBlob: Blob; script: string } | null> {
  const response = await fetch("/api/generate-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: input.customText,
      personaId: input.personaId,
      provider: input.provider ?? "openai",
      voice: input.voiceId,
      tier: input.tier,
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

  const audioBlob = new Blob([await response.arrayBuffer()], {
    type: response.headers.get("content-type") || "audio/mpeg",
  });
  return {
    audioBlob,
    script: input.customText,
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
    seedArtists,
    seedGenres,
    energyLevel,
    catalogDepth,
    studioBreaks,
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
  const { djVolume } = useMusicSource();
  const { homeCity, alwaysAnnounceSongs } = useUserPreferences();
  const driveMode = useDriveMode();
  const driveModeBatterySaver = useDriveModeBatterySaver();
  const driveBatterySaver = driveMode && driveModeBatterySaver;
  const frozenSeekRef = useRef({ time: 0, duration: 0 });
  const [skipCapExhausted, setSkipCapExhausted] = useState(() => !canSkip());
  useEffect(() => subscribeSkipLimiter(() => setSkipCapExhausted(!canSkip())), []);
  /**
   * DirectStream is the sole live bus. Never freeze the local HTML5 element
   * for a quarantined Spotify / Apple companion session.
   */
  const suppressLocalAudio = false;

  const containerRef = useRef<HTMLDivElement>(null);
  const errorCountRef = useRef(0);
  const restoreRampEndsAtRef = useRef(0);
  const justSkippedRef = useRef(false);
  const stallWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackSessionRef = useRef<string | null>(null);
  const sessionOpeningDjRef = useRef(false);
  const introRunningRef = useRef(false);
  const introAbortRef = useRef<AbortController | null>(null);
  const speechWatchdogIdRef = useRef<number | undefined>(undefined);
  const speechWatchdogIdleRearmsRef = useRef(0);
  /** Sidechain duck gain for the music channel only — never reaches the voice. */
  const duckGainRef = useRef(UNDUCKED_GAIN);
  const duckBusRef = useRef<VolumeController | null>(null);
  /**
   * DirectStream / YouTube host-gap hold. Independent of {@link sessionOpeningDjRef}
   * (DJ planning): this is the transport lock that keeps the song paused
   * until the host sequence finishes, then starts at 100%.
   */
  const launchHoldActiveRef = useRef(false);
  const launchHoldModeRef = useRef<StationLaunchHoldMode>("hard_pause");
  /** One-shot 3s fail-closed duck restore, armed on `stationId` / `queueGeneration`. */
  const launchDuckWatchdogArmedRef = useRef(false);
  const setLaunchHoldRef = useRef<
    (active: boolean, mode?: StationLaunchHoldMode) => void
  >(() => {});
  /** Live DirectStream instance — speech-end / timeout paths call `releaseLaunchHold`. */
  const providerRef = useRef<DirectStreamProvider | null>(null);
  const personaIdRef = useRef(personaId);
  const ttsProviderRef = useRef(ttsProvider);
  const preferredVoiceRef = useRef(preferredVoice);
  const subscriptionTierRef = useRef(subscriptionTier);
  const prevSubscriptionTierRef = useRef(subscriptionTier);
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
  const seedGenresRef = useRef(seedGenres);
  const studioBreaksRef = useRef(studioBreaks);
  const sessionTracksPlayedRef = useRef(0);
  const albumContextRef = useRef(albumContext);
  const voiceProfileRef = useRef(voiceProfile);
  const commentaryFormatRef = useRef(commentaryFormat);
  const alwaysAnnounceSongsRef = useRef(alwaysAnnounceSongs);
  const homeCityRef = useRef(homeCity);
  const listenerLocationRef = useRef(listenerLocation);
  const onPlayingChangeRef = useRef(onPlayingChange);
  const queueRef = useRef<StationTrack[]>([]);
  const currentIndexQueueRef = useRef(0);
  /**
   * Set while {@link syncIndexToPlayingTrack} moves the cursor to a track
   * Spotify already started. `handleNewTrack` updates Broadcast Log / counters
   * but must not re-issue companion `playTrack()` or a local companion break.
   */
  const suppressCompanionReplayRef = useRef(false);
  /**
   * Sticky station-handoff suppress. Unlike {@link suppressCompanionReplayRef}
   * this stays armed until {@link AudioPlayerHandle.disarmStationHandoff} so a
   * seed→replenish `trackKey` change cannot burn a duplicate Search.
   */
  const stationHandoffSuppressRef = useRef(false);
  /** `disarmStationHandoff` arrived before catalog replenish finished. */
  const pendingHandoffDisarmRef = useRef(false);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const djSchedulerRef = useRef(createDjSchedulerState());
  const localEventCacheRef = useRef(new Map<string, LocalConcertEvent | null>());
  /** Local music transport for Track #0 pause-talk-resume (DirectStream / YouTube / preview). */
  const musicTransportRef = useRef<{
    pause: () => void;
    play: () => void;
    seekTo: (seconds: number) => void;
    getCurrentTime: () => number;
    resetPlayingEmitted: () => void;
    unlock: () => void;
  }>({
    pause: () => {},
    play: () => {},
    seekTo: (_seconds: number) => {},
    getCurrentTime: () => 0,
    resetPlayingEmitted: () => {},
    unlock: () => {},
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
  seedGenresRef.current = seedGenres;
  studioBreaksRef.current = studioBreaks;
  albumContextRef.current = albumContext;
  voiceProfileRef.current = voiceProfile;
  commentaryFormatRef.current = commentaryFormat;
  alwaysAnnounceSongsRef.current = alwaysAnnounceSongs;
  homeCityRef.current = homeCity;
  listenerLocationRef.current = listenerLocation;
  onPlayingChangeRef.current = onPlayingChange;
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
    requestSessionHydrate,
    adoptPlayingTrack,
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
    setDjPrefetchContext,
    takePrefetchedDjBreak,
    hasPrefetchedDjBreak,
    clearPrefetchedDjBreaks,
    prefetchTrackKeyFor,
    isSpotifySyncPending,
    clearSpotifySyncPending,
  } = useStationQueue({
    stationId,
    initialTracks: stationTracks,
    onTrackChange: stationQueueMode ? notifyTrackChange : undefined,
    eraLock,
    mode: stationMode,
    albumContext,
    seedArtists,
    seedGenres,
    energyLevel,
    catalogDepth,
  });

  queueRef.current = queue;
  currentIndexQueueRef.current = currentIndex;
  const notePlaybackProgressRef = useRef(notePlaybackProgress);
  notePlaybackProgressRef.current = notePlaybackProgress;
  const setDjPrefetchContextRef = useRef(setDjPrefetchContext);
  setDjPrefetchContextRef.current = setDjPrefetchContext;
  const hasPrefetchedDjBreakRef = useRef(hasPrefetchedDjBreak);
  hasPrefetchedDjBreakRef.current = hasPrefetchedDjBreak;

  useEffect(() => {
    if (!stationQueueMode) return;
    const isPro = subscriptionTier === "pro";
    const activeHost = resolveLiveHost(personaId, preferredVoice, isPro);
    const spokenName = isSavedStationId(stationId)
      ? (stationName.trim() || "SongHost")
      : "SongHost";
    setDjPrefetchContext({
      personaId: activeHost.personaId as PersonaId,
      provider: activeHost.provider,
      voice: activeHost.voiceId,
      tier: subscriptionTier,
      stationId,
      stationName: spokenName,
      stationFrequency,
      eraLock,
      vibePrompt,
      albumContext,
      voiceProfile,
      commentaryFormat,
      homeCity,
      seedGenres: seedGenres ? [...seedGenres] : undefined,
      maxDurationInSeconds,
    });
  }, [
    stationQueueMode,
    setDjPrefetchContext,
    subscriptionTier,
    personaId,
    preferredVoice,
    stationId,
    stationName,
    stationFrequency,
    eraLock,
    vibePrompt,
    albumContext,
    voiceProfile,
    commentaryFormat,
    homeCity,
    seedGenres,
    maxDurationInSeconds,
  ]);

  useEffect(() => {
    if (stationQueueMode) {
      onQueueChangeRef.current?.(
        queue,
        currentIndex,
        queueReady,
        isSpotifySyncPending,
      );
    }
  }, [queue, currentIndex, queueReady, isSpotifySyncPending, stationQueueMode]);

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

  const streamUrl = stationQueueMode ? resolveDirectStreamUrl(currentTrack) : undefined;
  const isDirectStreamMode = Boolean(streamUrl);
  const isDirectStreamModeRef = useRef(isDirectStreamMode);
  isDirectStreamModeRef.current = isDirectStreamMode;
  const youtubeVideoId = stationQueueMode
    ? isDirectStreamMode
      ? undefined
      : currentTrack?.youtubeId?.trim() || undefined
    : youtubeId?.trim() || undefined;
  const videoId = youtubeVideoId;
  const isPreviewMode = false;
  const isPreviewModeRef = useRef(isPreviewMode);
  isPreviewModeRef.current = isPreviewMode;
  const trackKey = currentTrack
    ? djPrefetchTrackKey(currentTrack)
    : videoId;
  const trackSessionIdentity =
    trackSessionKey(currentTrack, videoId) ?? trackKey;
  const upcomingKey = playbackKeyForTrack(upcomingTrack);
  const queueReadyRef = useRef(queueReady);
  queueReadyRef.current = queueReady;
  const trackKeyRef = useRef(trackKey);
  trackKeyRef.current = trackKey;
  const trackSessionIdentityRef = useRef(trackSessionIdentity);
  trackSessionIdentityRef.current = trackSessionIdentity;
  const upcomingKeyRef = useRef(upcomingKey);
  upcomingKeyRef.current = upcomingKey;
  /** One-shot per upcoming key so playhead ticks cannot re-register lookahead. */
  const lookaheadArmedKeyRef = useRef<string | null>(null);
  const tryArmLookaheadRef = useRef<() => void>(() => {});

  const licensedStreamUrl = currentTrack?.streamUrl?.trim();
  const hasLicensedStream = Boolean(
    licensedStreamUrl && isHttpStreamUrl(licensedStreamUrl),
  );
  const rouTrackId =
    (currentTrack && trackIdentity(currentTrack)) ||
    playbackKeyForTrack(currentTrack) ||
    (currentTrack
      ? `${currentTrack.artist}:${currentTrack.title}`
      : undefined);
  const performanceCommit: RouPerformancePayload | null =
    stationQueueMode &&
    isDirectStreamMode &&
    hasLicensedStream &&
    currentTrack &&
    licensedStreamUrl &&
    rouTrackId
      ? {
          playSessionId: buildPlaySessionId({
            stationId,
            trackId: rouTrackId,
            queueIndex: currentIndex,
            queueGeneration,
          }),
          trackTitle: currentTrack.title,
          artistName: currentTrack.artist,
          streamUrl: licensedStreamUrl,
          ...(currentTrack.album?.trim()
            ? { albumTitle: currentTrack.album.trim() }
            : {}),
          ...(currentTrack.isrc?.trim()
            ? { isrc: currentTrack.isrc.trim().toUpperCase() }
            : {}),
        }
      : null;

  const handleRouIsrcResolved = useCallback(
    (isrc: string) => {
      const index = currentIndexQueueRef.current;
      const live = queueRef.current[index];
      if (!live || live.isrc?.trim()) return;
      updateTrackAt(index, { ...live, isrc });
    },
    [updateTrackAt],
  );

  const finishStationHandoff = useCallback(() => {
    stationHandoffSuppressRef.current = false;
    // Must clear the one-shot flag too — `handleNewTrack` never consumes it
    // while the sticky handoff flag is set, so leaving it armed stalls Track 2.
    suppressCompanionReplayRef.current = false;
    pendingHandoffDisarmRef.current = false;
    // `launchStation` owns the opener. Stamp the settled key so a late
    // seed→replenish hop cannot look like a new companion play.
    sessionOpeningDjRef.current = false;
    const liveSession = trackSessionIdentityRef.current;
    if (liveSession) trackSessionRef.current = liveSession;
  }, []);

  // Honor a deferred disarm once the opener is the post-replenish head.
  useEffect(() => {
    if (!pendingHandoffDisarmRef.current) return;
    if (stationQueueMode && !queueReady) return;
    finishStationHandoff();
  }, [queueReady, stationQueueMode, finishStationHandoff]);

  /**
   * Fail-closed duck restore. Swells `duckBus` to full over the Track-1
   * opener restore window whenever an opener liner is skipped, null, or
   * aborted before speech starts. No-ops when the bus is already unducked.
   */
  const releaseLaunchDuck = useCallback((reason: string) => {
    const bus = duckBusRef.current;
    if (!bus) return;
    const from = bus.getVolume();
    if (from >= UNDUCKED_GAIN - 0.005) return;
    logVolumeChange(
      `AudioPlayer.releaseLaunchDuck.${reason}`,
      UNDUCKED_GAIN,
      STATION_LAUNCH_RESTORE_MS,
    );
    bus.rampVolume(from, UNDUCKED_GAIN, STATION_LAUNCH_RESTORE_MS);
  }, []);

  // Deliberately identity-stable: this is wired into the stationId/queueGeneration
  // effect, and a changing identity there would re-arm the session-opening DJ flag.
  const abortIntro = useCallback(() => {
    const speechWasOnAir = Boolean(voiceNodeRef.current?.isSpeaking());
    introAbortRef.current?.abort();
    introAbortRef.current = null;
    introRunningRef.current = false;
    pendingSegmentRef.current = null;
    voiceNodeRef.current?.stop();
    if (speechWatchdogIdRef.current !== undefined) {
      window.clearTimeout(speechWatchdogIdRef.current);
      speechWatchdogIdRef.current = undefined;
    }
    // Before the clip is on air: a live launch hold already owns the music
    // level. After TRACE 4 / `isSpeaking()`, aborting must swell — a hung
    // `play()` plus `videoId`/`streamUrl` abort would otherwise leave 18%.
    if (speechWasOnAir) {
      launchHoldActiveRef.current = false;
      providerRef.current?.releaseLaunchHold();
      setLaunchHoldRef.current(false);
      const bus = duckBusRef.current;
      const from = bus?.getVolume() ?? DUCK_RATIO;
      if (from < UNDUCKED_GAIN) {
        bus?.rampVolume(from, UNDUCKED_GAIN, RESTORE_RAMP_MS);
      }
    } else {
      // Pre-speech abort (skipped liner, failed TTS, station change) must
      // never leave the bus pinned at 18%.
      releaseLaunchDuck("abort-intro-pre-speech");
    }
    // A stopped clip fires neither `ended` nor `error`, so the transcript log
    // has to be closed from here or the break stays open forever.
    finishDjSegment({ interrupted: true });
  }, [releaseLaunchDuck]);

  useEffect(() => {
    const prev = prevSubscriptionTierRef.current;
    prevSubscriptionTierRef.current = subscriptionTier;
    if (prev === "pro" || subscriptionTier !== "pro") return;
    djSchedulerRef.current = clearRootsTeaserCounter(djSchedulerRef.current);
    djPrefetch.clear();
    clearPrefetchedDjBreaks();
    lookaheadArmedKeyRef.current = null;
    const pending = pendingSegmentRef.current;
    if (pending && isRootsTeaserKind(pending.kind)) {
      abortIntro();
    }
  }, [subscriptionTier, abortIntro, clearPrefetchedDjBreaks, djPrefetch]);

  /**
   * Drop the host-gap transport lock and start the song at 100%. The host
   * already finished in the pre-song gap — never resume at 18% or duck.
   * If a fallback transport leaked past 1s, skip the rewind and play in place.
   * Never toggles React `isPlaying` off; the station stays on.
   */
  const startSongAtFullVolume = useCallback(() => {
    sessionOpeningDjRef.current = false;
    launchHoldActiveRef.current = false;
    providerRef.current?.releaseLaunchHold();
    setLaunchHoldRef.current(false);
    duckBusRef.current?.setVolume(UNDUCKED_GAIN);
    const position = musicTransportRef.current.getCurrentTime();
    if (position <= OPENER_REWIND_GUARD_SEC) {
      musicTransportRef.current.seekTo(0);
    }
    musicTransportRef.current.resetPlayingEmitted();
    onPlayingChangeRef.current?.(true);
    try {
      musicTransportRef.current.play();
    } catch {
      musicTransportRef.current.unlock();
      musicTransportRef.current.play();
    }
  }, []);

  const releaseOpenerHold = useCallback((_startAfterSpeech = false) => {
    startSongAtFullVolume();
  }, [startSongAtFullVolume]);

  /**
   * If `introRunningRef` is still true after the full host sequence should have
   * finished, drop the hold so a hung `ended` wait cannot block Track 2.
   * Must not start the song while speech is on air or remaining clips are queued.
   */
  const armSpeechRestoreWatchdog = useCallback(
    (speechDurationMs: number, controller: AbortController) => {
      const id = window.setTimeout(() => {
        if (!introRunningRef.current) return;
        if (introAbortRef.current !== controller) return;
        const speaking = Boolean(voiceNodeRef.current?.isSpeaking());
        if (speaking || speechWatchdogIdleRearmsRef.current < 2) {
          if (!speaking) speechWatchdogIdleRearmsRef.current += 1;
          else speechWatchdogIdleRearmsRef.current = 0;
          speechWatchdogIdRef.current = armSpeechRestoreWatchdog(
            8000,
            controller,
          );
          return;
        }
        const bus = duckBusRef.current;
        const from = bus?.getVolume() ?? DUCK_RATIO;
        if (from < UNDUCKED_GAIN) {
          bus?.rampVolume(from, UNDUCKED_GAIN, RESTORE_RAMP_MS);
        }
        introRunningRef.current = false;
        sessionOpeningDjRef.current = false;
        startSongAtFullVolume();
      }, speechDurationMs + RESTORE_RAMP_MS + RESTORE_WATCHDOG_SLACK_MS);
      speechWatchdogIdRef.current = id;
      return id;
    },
    [startSongAtFullVolume],
  );

  useEffect(() => {
    // Stop the outgoing opener first so abortIntro cannot drop a hold we
    // are about to arm for this station.
    abortIntro();
    sessionOpeningDjRef.current = true;
    errorCountRef.current = 0;
    launchHoldActiveRef.current = true;
    launchHoldModeRef.current = "hard_pause";
    launchDuckWatchdogArmedRef.current = true;
    // Pause until the opener liner finishes, then start the song at 100%.
    // Never pin duckBus to 18% — YouTube remembers that level and replays it.
    setLaunchHoldRef.current(true, "hard_pause");
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
  }, [trackSessionIdentity, abortIntro]);

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
      if (stallWatchdogRef.current) {
        clearTimeout(stallWatchdogRef.current);
        stallWatchdogRef.current = null;
      }
    },
    [abortIntro, djPrefetch],
  );

  const handlePlaybackEnded = useCallback(() => {
    if (stationQueueMode) {
      trackSessionRef.current = null;
      if (!voiceNodeRef.current?.isSpeaking()) {
        abortIntro();
      }
      const endedIndex = currentIndexQueueRef.current;
      const listen = {
        positionSeconds: currentTimeRef.current,
        durationSeconds: durationRef.current,
        reason: "ended" as const,
      };
      void (async () => {
        await nextTrack(listen);
        // Queue-end handoff: if the cursor is still on the last row, retry
        // once so a similar-artist refill can land before playback halts.
        if (
          currentIndexQueueRef.current === endedIndex &&
          endedIndex >= Math.max(0, queueRef.current.length - 1)
        ) {
          await nextTrack(listen);
        }
      })();
    } else onEnded?.();
  }, [stationQueueMode, nextTrack, onEnded, abortIntro]);

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

    if (failedTrack?.streamUrl?.trim() && failedYoutubeId) {
      if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
      updateTrackAt(failedIndex, { ...failedTrack, streamUrl: "" });
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
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
    errorCountRef.current = 0;
    onPlayingChange?.(true);
    // Mid-roll / quality PLAYING is not a new track. Never start a DJ duck.
    if (currentTimeRef.current > DJ_BREAK_PLAYHEAD_GUARD_SEC) {
      const liveSession = trackSessionIdentityRef.current;
      if (liveSession) trackSessionRef.current = liveSession;
      if (introRunningRef.current && !sessionOpeningDjRef.current) {
        abortIntro();
      } else {
        duckBusRef.current?.setVolume(UNDUCKED_GAIN);
      }
      return;
    }
    void handleNewTrackRef.current();
  }, [onPlayingChange, abortIntro]);

  const onPaused = useCallback(() => {
    // Track-1 / host-gap hard_pause parks YouTube without flipping React
    // `isPlaying` — a bounce would re-run the isPlaying effect and `play()`
    // the embed under the liner. The provider hold is the real lock.
    if (launchHoldActiveRef.current && launchHoldModeRef.current === "hard_pause") {
      return;
    }
    onPlayingChange?.(false);
  }, [onPlayingChange]);

  const youtubeControls = useYouTubePlayer({
    wrapperRef: containerRef,
    videoId:
      suppressLocalAudio || isPreviewMode || isDirectStreamMode ? undefined : videoId,
    isPlaying:
      isPlaying && !isDirectStreamMode && !isPreviewMode && !suppressLocalAudio,
    volume,
    viewerVisible: true,
    onEnded: handlePlaybackEnded,
    onError: () => {
      if (stallWatchdogRef.current) {
        clearTimeout(stallWatchdogRef.current);
        stallWatchdogRef.current = null;
      }
      handlePlaybackError();
    },
    onPlaying,
    onPaused,
  });

  // Stall watchdog: Vevo / geo-blocked embeds can sit on a black frame without
  // ever firing YT `onError`. Arm only for the live YouTube transport, on
  // videoId change — first `onPlaying` (or skip / unmount) disarms it, so a
  // later Mode B pause cannot false-trigger.
  useEffect(() => {
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
    const youtubeActive =
      Boolean(videoId) &&
      !suppressLocalAudio &&
      !isPreviewMode &&
      !isDirectStreamMode;
    if (!youtubeActive) return;
    stallWatchdogRef.current = setTimeout(() => {
      stallWatchdogRef.current = null;
      console.warn(
        "[AudioPlayer] Stall watchdog: track never reached PLAYING — auto-skipping",
      );
      handlePlaybackError();
    }, 8000);
    return () => {
      if (stallWatchdogRef.current) {
        clearTimeout(stallWatchdogRef.current);
        stallWatchdogRef.current = null;
      }
    };
  }, [
    videoId,
    suppressLocalAudio,
    isPreviewMode,
    isDirectStreamMode,
    handlePlaybackError,
  ]);

  const previewControls = usePreviewPlayer({
    // Spotify companion mode: do not load or start local web preview clips.
    previewUrl: undefined,
    isPlaying:
      isPlaying && isPreviewMode && !isDirectStreamMode && !suppressLocalAudio,
    volume,
    onEnded: handlePlaybackEnded,
    onError: handlePlaybackError,
    onPlaying,
    onPaused,
  });

  const directStreamControls = useDirectStreamPlayer({
    streamUrl: suppressLocalAudio ? undefined : isDirectStreamMode ? streamUrl : undefined,
    title: currentTrack?.title,
    artist: currentTrack?.artist,
    isPlaying: isPlaying && isDirectStreamMode && !suppressLocalAudio,
    volume,
    onEnded: handlePlaybackEnded,
    onError: handlePlaybackError,
    onPlaying,
    onPaused,
    performanceCommit,
    onIsrcResolved: handleRouIsrcResolved,
  });

  const { unlockAudio: unlockYouTube } = youtubeControls;
  const {
    unlockAudio: unlockPreview,
    pausePlayback: pausePreviewPlayback,
    seekTo: seekPreviewTo,
  } = previewControls;
  const { unlockAudio: unlockDirectStream } = directStreamControls;
  setLaunchHoldRef.current = (active, mode = "hard_pause") => {
    directStreamControls.setLaunchHold(active, mode);
    youtubeControls.provider.setLaunchHold(active, mode);
  };
  providerRef.current = directStreamControls.provider;

  // Quarantined companion freeze — never pause / seek DirectStream to 0.
  // DirectStream must receive live playhead controls and unlock on gesture.
  useEffect(() => {
    if (!suppressLocalAudio) return;
    if (isDirectStreamMode || stationQueueMode) return;
    pausePreviewPlayback();
    seekPreviewTo(0);
  }, [
    suppressLocalAudio,
    isDirectStreamMode,
    stationQueueMode,
    pausePreviewPlayback,
    seekPreviewTo,
  ]);

  /**
   * Spotify suppresses the YouTube/preview engines, so `onPlaying` never fires
   * and the companion Duck–Talk–Swell path would stall. Kick `handleNewTrack`
   * from the queue key instead. Session openers are owned by `page.tsx` →
   * `launchCompanionTrack` (TRACE 1b); this effect only advances follow-up tracks.
   */
  useEffect(() => {
    if (!companionActive || !suppressLocalAudio || !trackKey) return;

    // Sticky / deferred handoff: seed may swap when catalog replenish lands.
    // Keep stamping the live key and do not consume the session-opening
    // reservation until `finishStationHandoff` (after replenish + launch).
    if (stationHandoffSuppressRef.current || pendingHandoffDisarmRef.current) {
      if (trackSessionIdentity) trackSessionRef.current = trackSessionIdentity;
      return;
    }

    if (sessionOpeningDjRef.current) {
      sessionOpeningDjRef.current = false;
      if (trackSessionIdentity) trackSessionRef.current = trackSessionIdentity;
      return;
    }

    void handleNewTrackRef.current();
  }, [companionActive, suppressLocalAudio, trackKey, trackSessionIdentity, queueGeneration]);

  const unlockActivePlayer = useCallback(() => {
    if (suppressLocalAudio) return;
    if (isDirectStreamMode) unlockDirectStream();
    else if (isPreviewMode) unlockPreview();
    else unlockYouTube();
  }, [
    suppressLocalAudio,
    isDirectStreamMode,
    isPreviewMode,
    unlockDirectStream,
    unlockPreview,
    unlockYouTube,
  ]);

  const unlockBothPlayers = useCallback(() => {
    markAudioUnlockRequested();
    unlockActivePlayer();
    unlockDirectStream();
    // Both run inside the gesture that reaches here, which is the only moment an
    // audio context can be opened already running rather than suspended. The
    // analyser refuses to reroute a clip into a suspended graph, so without this
    // the visualizer would never see the voice channel.
    stingers.unlock();
    getMasterAnalyser().unlock();
  }, [unlockActivePlayer, unlockDirectStream, stingers]);

  const localControls = isDirectStreamMode
    ? directStreamControls
    : isPreviewMode
      ? previewControls
      : youtubeControls;
  musicTransportRef.current = {
    pause: () => localControls.pausePlayback(),
    play: () => {
      try {
        localControls.provider.play();
      } catch {
        localControls.unlockAudio();
        localControls.provider.play();
      }
    },
    seekTo: (seconds: number) => localControls.seekTo(seconds),
    getCurrentTime: () => localControls.provider.getCurrentTime(),
    resetPlayingEmitted: () => {
      if ("resetPlayingEmitted" in localControls.provider) {
        (
          localControls.provider as { resetPlayingEmitted: () => void }
        ).resetPlayingEmitted();
      }
    },
    unlock: () => localControls.unlockAudio(),
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
  const rawSeekTo = useCompanionScrub
    ? (positionSeconds: number) => {
        onCompanionSeek?.(positionSeconds);
      }
    : localControls.seekTo;
  const seekTo = useCompanionScrub
    ? rawSeekTo
    : (positionSeconds: number) => {
        // Statutory DirectStream: playhead must not seek backward.
        if (positionSeconds < currentTimeRef.current - 0.25) return;
        rawSeekTo(positionSeconds);
      };
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  if (!driveBatterySaver) {
    frozenSeekRef.current = { time: currentTime, duration };
  }
  const seekBarTime = driveBatterySaver ? frozenSeekRef.current.time : currentTime;
  const seekBarDuration = driveBatterySaver
    ? frozenSeekRef.current.duration
    : duration;

  // Implicit preference: credit a completed listen once the needle passes 80%.
  useEffect(() => {
    if (!stationQueueMode || duration <= 0) return;
    // Local DirectStream / YouTube: AudioPlayer's DjPrefetchController owns TTS.
    // Companion (Spotify / Apple) still uses the shared engine.
    const localOwnsLookahead =
      !companionActiveRef.current || isDirectStreamModeRef.current;
    notePlaybackProgressRef.current({
      positionSeconds: currentTime,
      durationSeconds: duration,
      reason: "progress",
      skipEnginePrefetch: localOwnsLookahead,
    });
    tryArmLookaheadRef.current();
  }, [stationQueueMode, currentTime, duration]);

  /**
   * Station-launch fail-closed watchdog: if the playhead has passed 3s and
   * no DJ speech is on air, swell duckBus back to full so an abandoned
   * opener cannot trap music at 18%.
   */
  useEffect(() => {
    if (!launchDuckWatchdogArmedRef.current) return;
    if (currentTime <= LAUNCH_DUCK_WATCHDOG_SEC) return;
    if (voiceNodeRef.current?.isSpeaking()) return;
    launchDuckWatchdogArmedRef.current = false;
    releaseLaunchDuck("launch-watchdog-3s");
  }, [currentTime, releaseLaunchDuck]);

  /**
   * Past the opening window a leftover 18% duck must not linger. Do not abort
   * an in-flight opener — slow TTS can still be talking while the bed plays.
   */
  useEffect(() => {
    if (currentTime <= DJ_BREAK_PLAYHEAD_GUARD_SEC) return;
    if (introRunningRef.current) return;
    if (voiceNodeRef.current?.isSpeaking()) return;
    const bus = duckBusRef.current;
    if ((bus?.getVolume() ?? UNDUCKED_GAIN) < UNDUCKED_GAIN - 0.005) {
      bus?.setVolume(UNDUCKED_GAIN);
    }
  }, [currentTime]);

  const { provider: youtubeProvider } = youtubeControls;
  const { provider: previewProvider } = previewControls;
  const { provider: directStreamProvider } = directStreamControls;

  /**
   * The mix's duck bus. Volume is applied only to the on-air transport so an
   * idle YouTube/preview observer cannot sidechain a DirectStream bed (and
   * vice versa). Mode is read from refs so in-flight ramps follow a switch.
   */
  const duckBus = useMemo(
    () => {
      const inner = createVolumeController({
        getVolume: () => duckGainRef.current,
        setVolume: (gain) => {
          duckGainRef.current = gain;
          if (isDirectStreamModeRef.current) {
            directStreamProvider.setDuckGain(gain);
          } else if (isPreviewModeRef.current) {
            previewProvider.setDuckGain(gain);
          } else {
            youtubeProvider.setDuckGain(gain);
          }
        },
      });
      return {
        getVolume: () => inner.getVolume(),
        setVolume: (gain: number) => {
          logVolumeChange("AudioPlayer.duckBus.setVolume", gain, 0);
          inner.setVolume(gain);
        },
        rampVolume: (from: number, to: number, durationMs: number) => {
          logVolumeChange("AudioPlayer.duckBus.rampVolume.start", to, durationMs);
          return inner.rampVolume(from, to, durationMs);
        },
      };
    },
    [youtubeProvider, previewProvider, directStreamProvider],
  );

  duckBusRef.current = duckBus;

  // Lightweight volume status poller — active playback only. Peeks the existing
  // mix-bus graph; does not construct an AudioContext.
  useEffect(() => {
    if (!isPlaying) return;
    if (!isAudioTelemetryEnabled()) return;
    const id = window.setInterval(() => {
      const mediaVol = directStreamProvider.getMediaVolume();
      const duckBusGain = duckBusRef.current?.getVolume() ?? duckGainRef.current;
      const ctxTime = peekMixBusContextTime();
      const ctxState = peekMixBusContextState();
      console.log(
        `[SongHost POLL] time: ${ctxTime} | mediaVol: ${mediaVol ?? "n/a"} | duckBusGain: ${duckBusGain} | ctxState: ${ctxState}`,
      );
    }, 2000);
    return () => window.clearInterval(id);
  }, [isPlaying, directStreamProvider]);

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
        launchDuckWatchdogArmedRef.current = false;
        if (pending?.script) startDjSegment(pending);
      },
      onEnded: () => {
        finishDjSegment();
      },
      onError: () => {
        finishDjSegment({ interrupted: true });
      },
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

  const isTrackStillActive = useCallback((startedSessionKey: string) => {
    const live = resolveLiveTrack();
    const liveSession = trackSessionKey(live) ?? playbackKeyForTrack(live);
    return liveSession === startedSessionKey;
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
    const sessionKey = trackSessionIdentity ?? trackKey;
    if (trackSessionRef.current === sessionKey) return;

    // Same recording, late PLAYING. Charging this as a new track would pause
    // mid-song for a second host break. Voiced breaks only at song start.
    if (currentTimeRef.current > DJ_BREAK_PLAYHEAD_GUARD_SEC) {
      trackSessionRef.current = sessionKey;
      duckBusRef.current?.setVolume(UNDUCKED_GAIN);
      return;
    }

    const startedKey = trackKey;
    const startedSessionKey = sessionKey;
    trackSessionRef.current = startedSessionKey;
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
    // Station handoff stays suppressed until page.tsx `launchStation` owns play.
    if (stationHandoffSuppressRef.current) {
      const companionOwnsOpener =
        companionActiveRef.current && !isDirectStreamModeRef.current;
      if (companionOwnsOpener) {
        return;
      }
      // Orphan suppress on a local / DirectStream track — disarm so a sticky
      // flag cannot stall the opener or leave a launch duck locked.
      stationHandoffSuppressRef.current = false;
      suppressCompanionReplayRef.current = false;
      pendingHandoffDisarmRef.current = false;
    }
    if (suppressCompanionReplayRef.current) {
      suppressCompanionReplayRef.current = false;
      if (!isDirectStreamModeRef.current) {
        releaseLaunchDuck("companion-replay-local");
        return;
      }
    }

    if (!stationQueueModeRef.current) {
      releaseLaunchDuck("non-queue");
      return;
    }

    /**
     * Arm the transport hold before any `await`. Every voiced break (opener
     * and mid-session) stays silent until the host sequence finishes.
     * Do not `pause()` — that flips `intendedPlaying` and lets the React
     * `isPlaying` effect `playVideo` under the host. The provider hold is
     * the lock: `play()` is a no-op until `startSongAtFullVolume`.
     */
    const isSessionOpening = sessionOpeningDjRef.current;
    launchHoldActiveRef.current = true;
    launchHoldModeRef.current = "hard_pause";
    setLaunchHoldRef.current(true, "hard_pause");
    musicTransportRef.current.seekTo(0);

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
    const companionOwnsTransport =
      companionActiveRef.current && !isDirectStreamModeRef.current;
    const mapBreak =
      sessionOpeningDjRef.current
      || warmed?.audioBlob
      || companionOwnsTransport
        ? null
        : takePrefetchedDjBreak(mapKey);
    const warmedAudioBlob = warmed?.audioBlob ?? mapBreak?.audioBlob;
    const warmedScript = warmed?.script ?? mapBreak?.script;
    const warmedLoreBlob = warmed?.loreBlob ?? mapBreak?.loreBlob;
    const warmedLoreScript = warmed?.loreScript ?? mapBreak?.loreScript;
    const warmedAnnouncementBlob =
      warmed?.announcementBlob ?? mapBreak?.announcementBlob;
    const warmedAnnouncementScript =
      warmed?.announcementScript ?? mapBreak?.announcementScript;

    // The warmed slot already carries its concert aside; only a live plan needs
    // the lookup, and skipping it is what keeps the warmed path off the network.
    // Station-launch liners skip it too: location must not delay Track-1 TTS.
    const localEvent =
      warmed || isSessionOpening ? null : await resolveLocalEvent(artist);

    const releaseWarmedClip = () => {
      if (warmed?.audioBlob) voiceNode.discardPreload();
    };

    if (!isTrackStillActive(startedSessionKey)) {
      releaseWarmedClip();
      if (isSessionOpening) sessionOpeningDjRef.current = false;
      releaseLaunchDuck("track-inactive");
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

    if (isSessionOpening) {
      sessionTracksPlayedRef.current = 0;
    } else {
      sessionTracksPlayedRef.current += 1;
    }

    const authoredCue = pickStationSessionBreak(studioBreaksRef.current, {
      isSessionOpening,
      tracksPlayed: sessionTracksPlayedRef.current,
    });
    let authoredBlob = warmedAudioBlob;
    let authoredScript = warmedScript;
    if (!authoredBlob && authoredCue?.audioUrl) {
      try {
        const authoredRes = await fetch(authoredCue.audioUrl);
        if (authoredRes.ok) {
          authoredBlob = await authoredRes.blob();
          authoredScript = authoredCue.customText?.trim() || authoredCue.label || warmedScript;
        }
      } catch {
        // Fall through to scheduled TTS when the R2 stem is unreachable.
      }
    }

    const suppressBreakForThisTrack =
      justSkippedRef.current && !isSessionOpening;
    if (suppressBreakForThisTrack) {
      justSkippedRef.current = false;
    }
    const backToBackClash =
      !isSessionOpening &&
      Date.now() < restoreRampEndsAtRef.current;
    const skipBreakForTiming = suppressBreakForThisTrack || backToBackClash;

    const scheduled =
      warmed ??
      planDjSegment(djSchedulerRef.current, {
        currentTrack: { title: announceTitle, artist: announceArtist, album: announceAlbum },
        upNextTracks: queueRef.current
          .slice(currentIndexQueueRef.current + 1, currentIndexQueueRef.current + 3)
          .map(toDjTrackContext),
        pacingFrequency: djPacingRef.current,
        chatterPacing: chatterPacingRef.current,
        commentaryFormat: commentaryFormatRef.current,
        alwaysAnnounceSongs: alwaysAnnounceSongsRef.current,
        introDurationSec: resolveIntroDurationSec(activeTrack),
        localEvent,
        listenerCity: homeCityRef.current?.trim() || undefined,
        isSessionOpening,
        isPro: subscriptionTierRef.current === "pro",
      });
    let { transition, plan } = scheduled;
    const { nextState } = scheduled;
    if (skipBreakForTiming && transition !== "silent" && !!plan) {
      transition = "silent";
      plan = null;
    }
    djSchedulerRef.current = nextState;

    // Keep `sessionOpeningDjRef` true until opener synthesis completes and
    // `play()` is called (or the opener fails / is skipped). Clearing here
    // would let Track 2 lookahead arm while Track 1 TTS is still in flight.

    const companionTrack: CompanionTrackPayload = {
      title: announceTitle,
      artist: announceArtist,
      youtubeId: activeTrack?.youtubeId ?? videoId ?? "",
      album: announceAlbum,
      introDuration: activeTrack?.introDuration,
      spotifyId: activeTrack?.spotifyId,
      spotifyUri: spotifyUriForQueueTrack(activeTrack ?? {}) ?? undefined,
      segmentPlan: plan ?? undefined,
    };

    // Spotify companion owns the stream: every queue advance (including silent
    // music-only transitions) must `play({ uris })` the station's next track
    // or the remote player stalls at the previous song.
    // DirectStream hard-lock: ignore companionActive so the SDK cannot steal
    // transport or queue advance while the licensed HTML5 bus is live.
    if (companionOwnsTransport) {
      // Local VoiceNode preload is unused on the companion path; discard it.
      // Shared `prefetchedBreaksMap` clips stay for WebOrchestrator.resolveDjAudio.
      releaseWarmedClip();
      const playTrack = onCompanionPlayTrackRef.current;
      const companionBreak = onCompanionDjBreakRef.current;
      const voiced = transition !== "silent" && !!plan && !!companionBreak;

      if (voiced) {
        // Cue Track B with the break. Mode A ducks the pre-roll; Mode B
        // freezes the playhead at 0:00 for the host, then hard-launches.
        // playTrack / SDK auto-advance must not run Track B under Mode B speech
        // — WebOrchestrator.holdModeBCompanionPlayhead owns that lock.
        const breakWork = companionBreak(companionTrack);
        if (playTrack) {
          try {
            await playTrack(companionTrack);
          } catch (error) {
            console.error("[SongHost TRACE ERROR]", error);
            console.warn("[AudioPlayer] companion play failed:", error);
          }
        }
        try {
          await breakWork;
        } catch (error) {
          console.error("[SongHost TRACE ERROR]", error);
          console.warn("[AudioPlayer] companion DJ break failed:", error);
        }
        if (isSessionOpening) sessionOpeningDjRef.current = false;
        releaseLaunchDuck("companion-voiced");
        return;
      }

      if (playTrack) {
        try {
          await playTrack(companionTrack);
        } catch (error) {
          console.error("[SongHost TRACE ERROR]", error);
          console.warn("[AudioPlayer] companion play failed:", error);
        }
      }
      if (isSessionOpening) sessionOpeningDjRef.current = false;
      releaseLaunchDuck("companion-local");
      return;
    }

    if (transition === "silent" || !plan) {
      if (isSessionOpening) sessionOpeningDjRef.current = false;
      startSongAtFullVolume();
      releaseLaunchDuck("opener-silent");
      return;
    }

    abortIntro();

    const controller = new AbortController();
    introAbortRef.current = controller;
    introRunningRef.current = true;

    const activeHost = resolveLiveHost(
      personaIdRef.current,
      preferredVoiceRef.current,
      subscriptionTierRef.current === "pro",
    );

    // Track #0 station open: one rotated liner in the pre-song gap (no LLM,
    // no earcon), then the song starts at 100%. Never talk over the bed.
    if (isSessionOpening) {
      const clips = getStationLaunchClips(
        isSavedStationId(stationIdRef.current)
          ? (stationNameRef.current || "SongHost")
          : "SongHost",
        announceArtist,
        announceTitle,
      );
      const openerLine = clips.line;
      pendingSegmentRef.current = {
        kind: plan.kind,
        transition,
        script: openerLine,
        songTitle: announceTitle,
        artistName: announceArtist,
        stationName: stationNameRef.current,
        personaId: activeHost.personaId,
      };

      // Transport hold already armed synchronously at handleNewTrack start.

      try {
        const synthesized = await synthesizeStationLaunchLiner({
          customText: openerLine,
          voiceId: activeHost.voiceId,
          personaId:
            subscriptionTierRef.current === "pro"
              ? (personaIdRef.current ?? activeHost.personaId)
              : activeHost.personaId,
          provider: activeHost.provider,
          tier: subscriptionTierRef.current,
          signal: controller.signal,
        });
        if (!synthesized || !isTrackStillActive(startedSessionKey)) {
          sessionOpeningDjRef.current = false;
          if (introAbortRef.current === controller) releaseOpenerHold(true);
          releaseLaunchDuck(
            synthesized ? "opener-track-inactive" : "opener-tts-null",
          );
          return;
        }
        if (pendingSegmentRef.current) {
          pendingSegmentRef.current.script = synthesized.script;
        }

        const speechDurationMs =
          Math.max(
            HOST_GAP_WATCHDOG_FLOOR_SEC,
            FALLBACK_DJ_AUDIO_DURATION_SEC,
            maxDurationRef.current,
          ) * 1000;
        speechWatchdogIdleRearmsRef.current = 0;
        armSpeechRestoreWatchdog(speechDurationMs, controller);
        await playDjIntro({
          songTitle: announceTitle,
          artistName: announceArtist,
          personaId: (
            subscriptionTierRef.current === "pro"
              ? personaIdRef.current
              : undefined
          ),
          provider: activeHost.provider,
          voice: activeHost.voiceId,
          tier: subscriptionTierRef.current,
          segmentPlan: plan,
          audioBlob: synthesized.audioBlob,
          script: synthesized.script,
          voiceNode,
          duckMusic: false,
          signal: controller.signal,
          onBreakExit: () => {
            stingers.playVinylScratch();
          },
        });
        sessionOpeningDjRef.current = false;
        releaseOpenerHold(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.warn("[AudioPlayer] Station launch liner failed:", error);
        }
        sessionOpeningDjRef.current = false;
        if (introAbortRef.current === controller) {
          releaseOpenerHold(true);
        }
        releaseLaunchDuck("opener-tts-failed");
      } finally {
        if (speechWatchdogIdRef.current !== undefined) {
          window.clearTimeout(speechWatchdogIdRef.current);
          speechWatchdogIdRef.current = undefined;
        }
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

    // Live dial: pause for every voiced break, then start at 100%.
    const introDurationSec = resolveIntroDurationSec(activeTrack);
    const positionSeconds = currentTimeRef.current;
    const durationSeconds = durationRef.current;
    const remainingSec =
      durationSeconds > 0 ? Math.max(0, durationSeconds - positionSeconds) : 0;
    let djAudioDurationSec = FALLBACK_DJ_AUDIO_DURATION_SEC;
    if (authoredBlob) {
      djAudioDurationSec =
        (await probeAudioDurationSeconds(authoredBlob, controller.signal))
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

    console.log("[SongHost TRACE] AudioPlayer break scenario", {
      trackKey: startedKey,
      introDurationSec,
      djAudioDurationSec,
      remainingInstrumentalSec,
      scenario,
      positionSeconds,
    });

    const loreBreak = isLoreSegmentKind(plan.kind);
    const voicedClipCount = loreBreak
      ? (plan.includeStinger ? 3 : 2)
      : (plan.includeStinger ? 2 : 1);
    const hostGapWatchdogSec = Math.max(
      HOST_GAP_WATCHDOG_FLOOR_SEC,
      djAudioDurationSec * voicedClipCount + (loreBreak ? 4 : 0),
    );

    setLaunchHoldRef.current(true, "hard_pause");
    duckBus.setVolume(UNDUCKED_GAIN);

    speechWatchdogIdleRearmsRef.current = 0;
    armSpeechRestoreWatchdog(
      hostGapWatchdogSec * 1000,
      controller,
    );

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
        seedGenres: seedGenresRef.current ? [...seedGenresRef.current] : undefined,
        segmentPlan: plan,
        audioBlob: authoredBlob,
        script: authoredScript,
        loreBlob: warmedLoreBlob,
        loreScript: warmedLoreScript,
        announcementBlob: warmedAnnouncementBlob,
        announcementScript: warmedAnnouncementScript,
        onScript: (script) => {
          if (pendingSegmentRef.current) pendingSegmentRef.current.script = script;
        },
        voiceNode,
        duckMusic: false,
        signal: controller.signal,
        onBreakExit: () => {
          restoreRampEndsAtRef.current = Date.now() + 200;
          stingers.playVinylScratch();
        },
      });
      if (introAbortRef.current === controller) {
        restoreRampEndsAtRef.current = Date.now() + 200;
        startSongAtFullVolume();
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.warn("[AudioPlayer] DJ intro failed:", error);
      }
      if (introAbortRef.current === controller) {
        startSongAtFullVolume();
      }
    } finally {
      if (speechWatchdogIdRef.current !== undefined) {
        window.clearTimeout(speechWatchdogIdRef.current);
        speechWatchdogIdRef.current = undefined;
      }
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
    trackSessionIdentity,
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
    releaseOpenerHold,
    startSongAtFullVolume,
    armSpeechRestoreWatchdog,
    releaseLaunchDuck,
  ]);

  handleNewTrackRef.current = handleNewTrack;

  /**
   * Lookahead pre-fetcher. Once the outgoing track is inside the warming
   * window, the next transition is planned and — if it is voiced — written,
   * spoken, and decoded in the background, so `handleNewTrack` can open the
   * break the instant the track flips.
   *
   * Playhead ticks call this through {@link tryArmLookaheadRef} (progress
   * effect). Identity changes re-arm via the effect below. `currentTime` is
   * deliberately not a dependency — re-registering every 250ms was the
   * mid-track render storm.
   */
  const tryArmLookahead = useCallback(() => {
    const upcoming = upcomingKeyRef.current;
    const liveKey = trackKeyRef.current;
    const liveSession = trackSessionIdentityRef.current;
    if (!stationQueueModeRef.current || !upcoming) return;
    // Companion owns TTS via WebOrchestrator — skip local warmup to avoid
    // double synthesis that would only be discarded at the transition.
    // DirectStream still warms locally even if a leftover companion flag is set.
    if (companionActiveRef.current && !isDirectStreamModeRef.current) return;
    // The session opener is planned live at track one and has no preceding
    // track to warm from. Stay gated until opener `play()` is called or fails.
    if (sessionOpeningDjRef.current) return;
    // Track 2 lookahead must not arm while Track 1 opener speech is in flight.
    if (introRunningRef.current) return;
    // The on-air track has not been charged to the scheduler yet, so planning
    // the next one would build on state that is about to change underneath it.
    if (!liveKey || !liveSession || trackSessionRef.current !== liveSession) return;
    if (lookaheadArmedKeyRef.current === upcoming) return;
    if (!shouldStartLookahead({
      position: currentTimeRef.current,
      duration: durationRef.current,
      trackId: liveKey || upcoming,
    })) return;

    lookaheadArmedKeyRef.current = upcoming;
    djPrefetch.start(upcoming, async (signal) => {
      const targetKey = upcomingKeyRef.current;
      const index = currentIndexQueueRef.current + 1;
      const track = queueRef.current[index];
      if (!track || !targetKey || playbackKeyForTrack(track) !== targetKey) {
        return null;
      }

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
        commentaryFormat: commentaryFormatRef.current,
        alwaysAnnounceSongs: alwaysAnnounceSongsRef.current,
        introDurationSec: resolveIntroDurationSec(track),
        localEvent,
        listenerCity: homeCityRef.current?.trim() || undefined,
        isSessionOpening: false,
        isPro: subscriptionTierRef.current === "pro",
      });

      if (transition === "silent" || !plan) return { transition, plan, nextState };

      const spokenName = isSavedStationId(stationIdRef.current)
        ? (stationNameRef.current.trim() || "SongHost")
        : "SongHost";
      const activeHost = resolveLiveHost(
        personaIdRef.current,
        preferredVoiceRef.current,
        subscriptionTierRef.current === "pro",
      );
      setDjPrefetchContextRef.current({
        personaId: activeHost.personaId as PersonaId,
        provider: activeHost.provider,
        voice: activeHost.voiceId,
        tier: subscriptionTierRef.current,
        stationId: stationIdRef.current,
        stationName: spokenName,
        stationFrequency: stationFrequencyRef.current,
        eraLock: eraLockRef.current,
        vibePrompt: vibePromptRef.current,
        albumContext: albumContextRef.current,
        voiceProfile: voiceProfileRef.current,
        commentaryFormat: commentaryFormatRef.current,
        homeCity: homeCityRef.current,
        seedGenres: seedGenresRef.current ? [...seedGenresRef.current] : undefined,
        maxDurationInSeconds: maxDurationRef.current,
        segmentPlan: plan,
      });

      // Engine A already warming this key — keep scheduler state, skip a second TTS.
      if (hasPrefetchedDjBreakRef.current(targetKey)) {
        return { transition, plan, nextState };
      }

      // Kept alongside the clip: this is the only moment the text exists, and
      // the break it belongs to is still a track away from airing.
      let script = "";
      const pavlovian = isLoreSegmentKind(plan.kind);
      if (pavlovian) {
        const pair = await generatePavlovianDjBreak({
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
          seedGenres: seedGenresRef.current ? [...seedGenresRef.current] : undefined,
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
          audioBlob: pair?.announcementBlob ?? pair?.loreBlob ?? undefined,
          loreBlob: pair?.loreBlob ?? undefined,
          loreScript: pair?.loreScript,
          announcementBlob: pair?.announcementBlob ?? undefined,
          announcementScript: pair?.announcementScript,
          script: script || undefined,
        };
      }

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
        seedGenres: seedGenresRef.current ? [...seedGenresRef.current] : undefined,
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
  }, [djPrefetch, resolveLocalEvent]);

  tryArmLookaheadRef.current = tryArmLookahead;

  useEffect(() => {
    lookaheadArmedKeyRef.current = null;
    tryArmLookahead();
  }, [trackKey, upcomingKey, stationQueueMode, companionActive, isDirectStreamMode, tryArmLookahead]);

  const skipNext = useCallback(() => {
    if (!canSkip()) return;
    if (!recordSkip()) return;
    abortIntro();
    justSkippedRef.current = true;
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
    sessionOpeningDjRef.current = false;
    if (launchHoldActiveRef.current) releaseOpenerHold();
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
  }, [abortIntro, releaseOpenerHold, stationQueueMode, nextTrack, stingers]);

  const skipPrev = useCallback(() => {
    // Statutory DirectStream: reverse / instant replay is disabled.
    if (!companionActive) return;
    abortIntro();
    sessionOpeningDjRef.current = false;
    if (launchHoldActiveRef.current) releaseOpenerHold();
    errorCountRef.current = 0;
    trackSessionRef.current = null;
    stingers.playFrequencySweep();
    if (stationQueueMode) prevTrack();
  }, [abortIntro, releaseOpenerHold, companionActive, stationQueueMode, prevTrack, stingers]);

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
    const host = resolveLiveHost(personaId, preferredVoice, isProTier);
    return host.displayName || getPersonaUiDisplayName(String(personaId ?? ""), "Host");
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
    "SongHost Radio";
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
        album: activeSegment.stationName || stationName || "SongHost Radio",
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
        if (!stationQueueMode) return -1;
        const before = currentIndexQueueRef.current;
        suppressCompanionReplayRef.current = true;
        const after = syncIndexToPlayingTrack(alignTo);
        // No cursor move → clear the guard so a later advance can still play.
        if (after < 0 || after === before) {
          suppressCompanionReplayRef.current = false;
        }
        return after;
      },
      clearSpotifySyncPending: () => {
        clearSpotifySyncPending();
      },
      requestSessionHydrate: () => {
        requestSessionHydrate();
      },
      adoptPlayingTrack: (playing) => {
        if (!stationQueueMode) return false;
        return adoptPlayingTrack(playing);
      },
      armStationHandoff: () => {
        stationHandoffSuppressRef.current = true;
        suppressCompanionReplayRef.current = true;
        pendingHandoffDisarmRef.current = false;
      },
      disarmStationHandoff: () => {
        // Hold the sticky flag until the initial replenish (or a non-queue
        // session) has a settled opener — otherwise seed→replenish races
        // `launchStation` with a duplicate Search / playTrack.
        if (stationQueueModeRef.current && !queueReadyRef.current) {
          pendingHandoffDisarmRef.current = true;
          return;
        }
        finishStationHandoff();
      },
      updateTrackAt: (index: number, track: StationTrack) => {
        if (!stationQueueMode) return;
        updateTrackAt(index, track);
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
      clearSpotifySyncPending,
      requestSessionHydrate,
      adoptPlayingTrack,
      updateTrackAt,
      shuffleRemainingTracks,
      insertTrackNext,
      appendTrack,
      dropBlockedTracks,
      stingers,
      finishStationHandoff,
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
      <div className="relative w-full overflow-hidden rounded-2xl bg-[#09090b]">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {driveBatterySaver ? null : liveArtworkUrl ? (
            <>
              <Image
                src={liveArtworkUrl}
                alt=""
                fill
                sizes="100vw"
                className="object-cover scale-150 blur-3xl opacity-70"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/50" />
            </>
          ) : (
            <div className="h-full w-full bg-[radial-gradient(ellipse_at_center,_rgba(245,158,11,0.18),_transparent_70%)]" />
          )}
        </div>
        <div
          ref={containerRef}
          className={
            driveMode
              ? driveBatterySaver
                ? "yt-player-host fixed top-[calc(5.5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[210] flex h-[200px] w-[200px] items-center justify-center overflow-hidden rounded-xl bg-black [&>iframe]:shrink-0 [&>*]:shrink-0"
                : "yt-player-host fixed top-[calc(5.5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[210] flex h-[200px] w-[200px] items-center justify-center overflow-hidden rounded-xl border border-amber-500/30 bg-black shadow-[0_0_30px_rgba(245,158,11,0.25)] [&>iframe]:shrink-0 [&>*]:shrink-0"
              : "yt-player-host relative z-10 mx-auto h-[200px] w-[320px] max-w-full shrink-0 overflow-hidden bg-black"
          }
          data-yt-viewer="visible"
        />
      </div>
      <div className="song-progress w-full max-w-full min-w-0 overflow-hidden space-y-1">
        <div className="flex items-center justify-between font-mono text-xs font-bold tabular-nums text-accent">
          <span>{formatTime(seekBarTime)}</span>
          <span>{formatTime(seekBarDuration)}</span>
        </div>
        <div className="relative w-full max-w-full overflow-hidden rounded-full">
          <input
            type="range"
            min={0}
            max={seekBarDuration > 0 ? seekBarDuration : 1}
            step={0.5}
            value={seekBarDuration > 0 ? seekBarTime : 0}
            disabled={seekBarDuration <= 0}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="song-progress-slider block w-full max-w-full"
            aria-label="Song progress"
            aria-valuetext={`${formatTime(seekBarTime)} of ${formatTime(seekBarDuration)}`}
          />
        </div>
      </div>
      <DriveModeOverlay
        title={overlayTitle}
        artist={overlayArtist}
        album={liveAlbum}
        stationName={stationName}
        albumArt={liveArtworkUrl}
        isDjBreak={isSpeaking}
        showProPreview={
          isSpeaking && Boolean(activeSegment && isRootsTeaserKind(activeSegment.kind))
        }
        hostName={hostDisplayName}
        isPlaying={isPlaying}
        onPlayPause={mediaPlayPause}
        onPrev={skipPrev}
        onNext={skipNext}
        disablePrev={!companionActive}
        disableNext={skipCapExhausted}
        nextTitle={upcomingTrack?.title}
        nextArtist={upcomingTrack?.artist}
      />
    </>
  );
});
