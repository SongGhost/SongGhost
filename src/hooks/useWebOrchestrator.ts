"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { DEFAULT_PERSONA, getPersonaById } from "@/data/personas";
import type { PersonaId } from "@/data/personas";
import { getStationById, type Station } from "@/data/stations";
import {
  readPersistedActiveStationId,
  readPersistedSessionQueue,
} from "@/lib/queue/session-persistence";
import {
  resolveStationSettings,
  type ChatterPacing,
  type ResolvedStationSettings,
  type StationConfigMap,
} from "@/types/station";
import {
  getEffectivePersona,
  isOpenAiHostVoice,
  resolveSessionVoiceId,
} from "@/lib/dj/personaConfig";
import {
  attachSpotifyPlayerStateListener,
  createWebOrchestrator,
  interpolatePlayheadProgressMs,
  PLAYHEAD_INTERPOLATION_MS,
  PLAYHEAD_STALL_RESCUE_MS,
  resolveIntendedStationTrack,
  spotifyUriForQueueTrack,
  updateCurrentTrackState,
  type ActiveTrackState,
  type BroadcastHistoryEntry,
  type DjMode,
  type DjScriptContext,
  type DjStartInfo,
  type OrchestratorProvider,
  type OrchestratorStatus,
  type OrchestratorTrackInput,
  type OrchestratorTrackRef,
  type PlayheadSample,
  type RunDjBreakResult,
  type StudioManifestLoadInput,
  type WebOrchestrator,
} from "@/lib/player/webOrchestrator";

export { resolveIntendedStationTrack, spotifyUriForQueueTrack };
export type { StudioManifestLoadInput };
import { getMasterAnalyser } from "@/lib/audio/mix-bus";
import {
  getCurrentlyPlaying,
  getSpotifyPlayerQueue,
  getValidSpotifyAccessToken,
  isNoActiveDeviceResult,
  next as spotifyNext,
  normalizeSpotifyTrackId,
  pause as spotifyPause,
  previous as spotifyPrevious,
  registerSpotifySdkPlayer,
  resume as spotifyResume,
  searchSpotifyTrackUri,
  seek as spotifySeek,
  setSpotifyActiveDeviceId,
  setSpotifyVolume,
  subscribeSpotifyPlaybackState,
  transferPlaybackToLocalDevice,
  type SpotifyPlaybackResult,
  type SpotifyPlaybackState,
  type SpotifyTrack,
} from "@/lib/player/spotifyRemote";
import {
  finishDjSegment,
  resetDjBroadcast,
  startDjSegment,
} from "@/lib/dj/broadcast-state";
import {
  PREFETCH_LOOKAHEAD_SECONDS,
  resolveBreakTransitionPolicy,
  type BreakTransitionPolicy,
} from "@/lib/dj/prefetchEngine";
import type {
  CommentaryFormat,
  DjKnowledge,
  DjMood,
  DjPersonality,
  DjSegmentKind,
} from "@/types/dj";

/** Companion near-end window — matches the 30s zero-latency prefetch engine. */
const COMPANION_PREFETCH_NEAR_END_MS = PREFETCH_LOOKAHEAD_SECONDS * 1000;

/**
 * Fold the live companion station's Host Settings (station override > global).
 * Reads the persisted session station so this hook does not depend on page.tsx
 * state — PublicStationPlayer and the home deck share the same fold.
 */
function resolveCompanionStationSettings(
  savedStations: Station[],
  stationConfigs: StationConfigMap,
  chatterPacing: ChatterPacing,
  commentaryFormat: CommentaryFormat,
  mood: DjMood | undefined,
  personality: DjPersonality | undefined,
): ResolvedStationSettings | null {
  const persisted = readPersistedSessionQueue();
  const stationId =
    persisted?.stationId?.trim()
    || readPersistedActiveStationId()?.trim()
    || "";
  if (!stationId) return null;

  const station =
    savedStations.find((row) => row.id === stationId)
    ?? getStationById(stationId)
    ?? persisted?.station
    ?? null;
  const foldTarget = station ?? {
    id: stationId,
    name: "SongHost Radio",
    frequency: 0,
    defaultPersonaId: DEFAULT_PERSONA.id,
  };

  return resolveStationSettings(
    foldTarget,
    stationConfigs[stationId],
    chatterPacing,
    commentaryFormat,
    mood,
    personality,
  );
}

export type {
  BroadcastHistoryEntry,
  DjMode,
  DjScriptContext,
  OrchestratorStatus,
  OrchestratorTrackRef,
};

/** Parse `"Title" by Artist` labels written by {@link WebOrchestrator}. */
function parseBroadcastTrackLabel(track: string | undefined): {
  title: string;
  artist: string;
} {
  if (!track) return { title: "Unknown Track", artist: "Unknown Artist" };
  const match = /^"(.+)" by (.+)$/.exec(track);
  if (!match) return { title: track, artist: "Unknown Artist" };
  return { title: match[1] ?? track, artist: match[2] ?? "Unknown Artist" };
}

function djTransitionForKind(kind: DjSegmentKind): "stinger" | "full_break" {
  return kind === "stinger" ? "stinger" : "full_break";
}

function activeTrackFromSdkState(state: {
  paused?: boolean;
  position?: number;
  duration?: number;
  track_window?: {
    current_track?: {
      id: string | null;
      name: string;
      artists: Array<{ name: string }>;
      album: { name: string; images: Array<{ url?: string }> };
    } | null;
  } | null;
}): ActiveTrackState | null {
  const raw = state.track_window?.current_track;
  if (!raw) return null;
  return {
    id: raw.id,
    title: raw.name,
    artist: raw.artists.map((artist) => artist.name).join(", "),
    album: raw.album.name,
    albumArtUrl: raw.album.images[0]?.url,
    durationMs: state.duration,
    positionMs: state.position,
    isPaused: state.paused,
  };
}

function activeTrackFromSpotifyTrack(track: SpotifyTrack): ActiveTrackState {
  return {
    id: track.id,
    title: track.name,
    artist: track.artists.join(", "),
    album: track.album,
    albumArtUrl: track.albumArtUrl,
    durationMs: track.durationMs,
    positionMs: track.progressMs,
    isPaused: !track.isPlaying,
  };
}

const SPOTIFY_SDK_SCRIPT_URL = "https://sdk.scdn.co/spotify-player.js";

type SpotifyWebPlaybackPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  getCurrentState: () => Promise<{
    paused?: boolean;
    position?: number;
    duration?: number;
    track_window?: {
      current_track?: {
        id: string | null;
        name: string;
        artists: Array<{ name: string }>;
        album: {
          name: string;
          images: Array<{ url?: string }>;
        };
      } | null;
    } | null;
  } | null>;
  setVolume: (volume: number) => Promise<void>;
  getVolume: () => Promise<number>;
  addListener: (
    event: string,
    callback: (payload: unknown) => void,
  ) => void;
  removeListener: (event: string, callback?: (...args: unknown[]) => void) => void;
};

type SpotifyWebPlaybackNamespace = {
  Player: new (options: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyWebPlaybackPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifyWebPlaybackNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

/** Load the Spotify Web Playback SDK script once per page. */
function loadSpotifyWebPlaybackSdk(): Promise<SpotifyWebPlaybackNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Spotify SDK requires a browser"));
  }
  if (window.Spotify) {
    return Promise.resolve(window.Spotify);
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SPOTIFY_SDK_SCRIPT_URL}"]`,
    );
    const previousReady = window.onSpotifyWebPlaybackSDKReady;

    window.onSpotifyWebPlaybackSDKReady = () => {
      previousReady?.();
      if (window.Spotify) resolve(window.Spotify);
      else reject(new Error("Spotify Web Playback SDK ready without namespace"));
    };

    if (existing) {
      if (window.Spotify) resolve(window.Spotify);
      return;
    }

    const script = document.createElement("script");
    script.src = SPOTIFY_SDK_SCRIPT_URL;
    script.async = true;
    script.onerror = () =>
      reject(new Error("Failed to load Spotify Web Playback SDK"));
    document.body.appendChild(script);
  });
}

export const DJ_BREAK_STATUS_TITLE = "ON AIR — DJ BREAK IN PROGRESS";
export const NO_ACTIVE_DEVICE_NOTICE =
  "Please open and start playing Spotify on your device";

export type CompanionTrackSeed = {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  /** Instrumental intro length (seconds) for DJ duck / hard-pause staging. */
  introDuration?: number;
  mode?: string;
  /** Native Spotify catalog id when the queue row already has one. */
  spotifyId?: string | null;
  /** Cached Spotify URI when already resolved. */
  spotifyUri?: string | null;
};

export type CompanionNowPlaying = {
  title: string;
  artist: string;
  album?: string;
  albumArtUrl?: string;
  uri?: string;
  youtubeId?: string;
};

/** Live Spotify transport scrubber state (ms + playing flag). */
export type CompanionPlayback = {
  progressMs: number;
  durationMs: number;
  isPlaying: boolean;
};

/**
 * Deck-facing Spotify remote transport. Token refresh is handled internally;
 * each method maps 1:1 onto `spotifyRemote` pause/resume/next/previous/seek.
 */
export type SpotifyRemoteControls = {
  /**
   * Hydration-aware resume: when Spotify has no active playback context
   * (typical after page refresh), plays the restored track URI instead of a
   * bare SDK `resume()` no-op.
   */
  resume: () => Promise<SpotifyPlaybackResult>;
  pause: () => Promise<SpotifyPlaybackResult>;
  next: () => Promise<SpotifyPlaybackResult>;
  previous: () => Promise<SpotifyPlaybackResult>;
  seek: (positionMs: number) => Promise<SpotifyPlaybackResult>;
  /**
   * Dual-path SDK + Connect REST volume (normalized 0–1).
   * Bridge ControlDeck master here when companion mode is active.
   */
  setVolume: (volumeNormalized: number) => Promise<SpotifyPlaybackResult>;
  /**
   * Play / pause with the same restored-track hydration as {@link resume}.
   */
  togglePlay: () => Promise<"playing" | "paused" | "failed">;
};

type UseWebOrchestratorResult = {
  /** True when Spotify or Apple Music is connected as the companion source. */
  companionActive: boolean;
  /** True while lore audio is playing over the companion stream. */
  isDjBreakInProgress: boolean;
  /**
   * Real-time host transition state machine:
   * `STANDBY` → `PREFETCHING` → `DUCKING` → `ON_AIR` → `RAMPING_UP` → `STANDBY`.
   * Standard formats duck to 18% of pre-break volume; extended formats pause (or 5% ambient).
   */
  status: OrchestratorStatus;
  /**
   * Live duck vs pause policy derived from `commentaryFormat`
   * (`standard` → duck over music; extended → pause / ambient floor).
   */
  breakTransitionPolicy: BreakTransitionPolicy;
  /** Non-blocking UI notice (e.g. Spotify has no active device). */
  companionNotice: string | null;
  dismissCompanionNotice: () => void;
  /**
   * Live Spotify metadata from the playback-state subscription.
   * Prefer this for the deck title/artist so the UI matches the remote stream.
   */
  companionNowPlaying: CompanionNowPlaying | null;
  /**
   * Live progress / duration / playing flag for the deck scrubber.
   * Updated from the Spotify playback-state subscription.
   */
  companionPlayback: CompanionPlayback | null;
  /**
   * Spotify Connect / Web Playback transport — bind ControlDeck play/pause,
   * skip, scrub, and volume handlers here when a companion session is active.
   */
  spotifyRemote: SpotifyRemoteControls;
  /**
   * Apply ControlDeck master to {@link WebOrchestrator.setVolume} (stores master
   * for companion DJ TTS and writes Spotify / Apple Music transport gain).
   */
  setVolume: (volumeNormalized: number) => Promise<void>;
  /**
   * Start Spotify playback on one or more track URIs (Web API /
   * Web Playback SDK device). Optionally queues the active DJ persona break.
   * Does not flush session state unless `flushSession` is true — keep false for
   * automated queue advances so prefetched DJ breaks stay valid.
   */
  playTrack: (input: {
    uri: string | string[];
    personaId?: PersonaId | string;
    seed?: CompanionTrackSeed | null;
    withDjBreak?: boolean;
    scriptContext?: DjScriptContext;
    /**
     * Manual station / mix launch only. When true, calls
     * `flushForStationLaunch()` (bumps sessionEpoch, clears prefetch).
     * Must stay false for playNextTrack / autopilot advances.
     */
    flushSession?: boolean;
    /**
     * Rogue-track correction. When true, plays through
     * `WebOrchestrator.steerToStationUri` (no session flush; re-entrancy guard).
     */
    steerCorrection?: boolean;
  }) => Promise<{ uri: string | null; dj: RunDjBreakResult | null }>;
  /**
   * Snap Spotify Autoplay / unrecognized URIs back onto a known station-queue
   * URI without flushing `sessionEpoch`. Delegates to {@link playTrack}.
   */
  steerToStationUri: (
    uri: string | string[],
  ) => Promise<{ uri: string | null; dj: RunDjBreakResult | null }>;
  /**
   * Manual station-launch entry: arms `isLaunchingStation`, flushes the prior
   * session (`sessionEpoch` bump + prefetch clear), then delegates to
   * {@link playTrack}. Do not use for automated queue progression.
   */
  launchStation: (input: {
    uri: string | string[];
    personaId?: PersonaId | string;
    seed?: CompanionTrackSeed | null;
    withDjBreak?: boolean;
    scriptContext?: DjScriptContext;
  }) => Promise<{ uri: string | null; dj: RunDjBreakResult | null }>;
  /**
   * Song Radio companion launch — seed URI first, then recommendations.
   * Opening DJ break highlights the requested seed track.
   */
  launchSeededSongRadio: (input: {
    seedUri: string;
    recommendationUris?: string[];
    personaId?: PersonaId | string;
    seed?: CompanionTrackSeed | null;
    withDjBreak?: boolean;
    scriptContext?: DjScriptContext;
  }) => Promise<{ uri: string | null; dj: RunDjBreakResult | null }>;
  /**
   * Force Spotify onto the station's selected track URI, then optionally run
   * the opening DJ break. Pass `flushSession: true` only for manual station /
   * mix launches — never for automated queue advances.
   */
  launchCompanionTrack: (input: {
    personaId: PersonaId | string;
    seed: CompanionTrackSeed;
    /** When false, play the URI without a DJ break (queue advances). Default true. */
    withDjBreak?: boolean;
    scriptContext?: DjScriptContext;
    /**
     * Manual station / mix launch only. When true, flushes session state before
     * play. Default false so autopilot advances preserve prefetched breaks.
     */
    flushSession?: boolean;
  }) => Promise<{ uri: string | null; dj: RunDjBreakResult | null }>;
  /**
   * Companion DJ break — transition follows `commentaryFormat`:
   * standard ducks music to 18% of pre-break volume; extended formats pause (or 5% ambient).
   * No-ops (returns null) when no companion is connected.
   */
  runCompanionDjBreak: (input: {
    personaId: PersonaId | string;
    seed?: CompanionTrackSeed | null;
    /** Last 1–2 played + next 1–2 queued for script recaps/teasers. */
    scriptContext?: DjScriptContext;
  }) => Promise<RunDjBreakResult | null>;
  /**
   * Warm generate-script / TTS for an upcoming queue track during the last
   * {@link PREFETCH_LOOKAHEAD_SECONDS} so the format-aware transition starts
   * with a pre-rendered clip.
   */
  prefetchCompanionDjBreak: (input: {
    personaId: PersonaId | string;
    seed: CompanionTrackSeed;
    scriptContext?: DjScriptContext;
  }) => Promise<void>;
  /** Configure companion DJ mode (`no_dj` | `active` | `balanced` | `in_depth`). */
  setCompanionDjMode: (mode: DjMode) => void;
  /**
   * Legacy numeric gap used with cadence thresholds.
   * Pass `0` to mute live-fallback breaks (music_only).
   */
  setCompanionDjPacingFrequency: (pacing: number) => void;
  /** Push Tuning Console mood / personality / knowledge into generate-script. */
  setCompanionDjTuning: (tuning: {
    mood?: DjMood;
    personality?: DjPersonality;
    knowledge?: DjKnowledge;
  }) => void;
  /** Update recentHistory / upcomingQueue used by generate-script. */
  setCompanionScriptContext: (context: DjScriptContext) => void;
  /**
   * Arm authored studio break cues (pre-rendered `audioUrl` or
   * `customText`+`voiceId`) on the companion orchestrator.
   */
  loadStudioManifestBreaks: (input: StudioManifestLoadInput) => void;
  /** True when the next track advance should get a voiced DJ break. */
  willCompanionBreakOnNextTrack: () => boolean;
  /**
   * Manual override: bypass `songsSinceLastBreak` and play/fetch a live DJ
   * break using the live persona + current duck/pause policy.
   */
  triggerBreakNow: () => Promise<RunDjBreakResult | null>;
  /**
   * Mid-session DJ host switch: updates orchestrator persona + flushes
   * prefetched clips warmed under the previous voice.
   */
  setCompanionPersona: (personaId: PersonaId | string) => void;
  /**
   * Manual override: stop active DJ audio, cancel prefetch, restore volume.
   */
  skipActiveBreak: () => void;
  /**
   * Resolve the next track Spotify will play (live queue), falling back to
   * the supplied LinerLore station-queue candidates.
   */
  resolvePrefetchTarget: (stationUpcoming: CompanionTrackSeed[]) => Promise<{
    seed: CompanionTrackSeed | null;
    upcomingQueue: OrchestratorTrackRef[];
    source: "spotify_queue" | "station_queue" | "none";
  }>;
  /**
   * Start (or restart) the Spotify playback-state listener.
   * - `onNearEnd`: last {@link PREFETCH_LOOKAHEAD_SECONDS} — prefetch the next
   *   track's DJ break (zero-latency warmup).
   * - `onTrackStarted`: mid-queue Spotify auto-advance (SDK / REST). Syncs
   *   station `currentIndex` + Broadcast Log without bumping `sessionEpoch`
   *   or re-issuing `play()`. When `syncIndexToPlayingTrack` returns `-1`
   *   (rogue Autoplay URI), the page steers via {@link playTrack} /
   *   `steerToStationUri` instead of mutating the station queue.
   * - `onTrackEnded`: station-queue advance via `playNextTrack()`. Fires when
   *   Spotify finishes a URI and does not auto-advance (single-URI / drained
   *   queue), including background playback stalls.
   * - Track transitions: `player_state_changed` (poll stand-in) calls
   *   `registerTrack(newTrackId)` when Spotify starts the next song so any
   *   scheduled DJ break runs over track N + 1.
   */
  startSpotifyPlaybackMonitor: (handlers: {
    onNearEnd?: () => void;
    onTrackStarted?: (playing: {
      spotifyId?: string | null;
      title?: string;
      artist?: string;
    }) => void;
    onTrackEnded: (ended?: {
      spotifyId?: string | null;
      title?: string;
      artist?: string;
    }) => void;
    onTrackChange?: (track: CompanionNowPlaying) => void;
  }) => void;
  /** Stop the Spotify playback-state listener. */
  stopSpotifyPlaybackMonitor: () => void;
  /**
   * True while a station handoff is in flight — deck metadata (title / artist /
   * album art) must not render stale Spotify `player_state_changed` events
   * until the launch target URI (`uris[0]`) is confirmed.
   */
  isLaunchingStation: boolean;
  /**
   * Arm the station-launch UI lock immediately (e.g. when a handoff is queued
   * and Spotify URI search has not finished yet). Optional `uris` sets the
   * target track; when omitted, all UI metadata updates stay suppressed until
   * {@link playTrack} / {@link launchStation} supplies `uris[0]`.
   */
  beginStationLaunchLock: (uris?: string | string[]) => void;
  /** Release the station-launch UI lock (handoff failure / cancel). */
  clearStationLaunchLock: () => void;
  /** Live DJ script text for Teleprompter (latest generate-script payload). */
  activeScriptText: string;
  /** Session transcript log for Broadcast Log UI (oldest → newest). */
  broadcastHistory: BroadcastHistoryEntry[];
};

function toOrchestratorProvider(
  provider: "spotify" | "apple_music",
): OrchestratorProvider {
  return provider;
}

function toCompanionNowPlaying(track: SpotifyTrack): CompanionNowPlaying {
  return {
    title: track.name,
    artist: track.artists.join(", "),
    album: track.album,
    albumArtUrl: track.albumArtUrl,
    uri: track.uri,
  };
}

/**
 * Push a full now-playing snapshot into the shared UI store so ControlDeck /
 * WebPlayer never keep opener title/artist after a skip while only art updates.
 */
function publishActiveTrackState(
  orchestrator: WebOrchestrator | null,
  track: {
    id?: string | null;
    title: string;
    artist: string;
    album?: string;
    albumArtUrl?: string;
    durationMs?: number;
    positionMs?: number;
    isPaused?: boolean;
  },
): ActiveTrackState {
  const activeTrack: ActiveTrackState = {
    id: track.id ?? null,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtUrl: track.albumArtUrl,
    durationMs: track.durationMs,
    positionMs: track.positionMs,
    isPaused: track.isPaused,
  };
  if (orchestrator) {
    orchestrator.updateCurrentTrackState(activeTrack);
  } else {
    updateCurrentTrackState(activeTrack);
  }
  return activeTrack;
}

/**
 * Prefer a clean Spotify catalog id from the URI so generate-script / R2
 * never inherit a youtubeId or full `spotify:track:…` string from a prior seed.
 */
function seedWithNormalizedTrackId(
  seed: CompanionTrackSeed,
  uriHint?: string | null,
): CompanionTrackSeed {
  const fromUri =
    normalizeSpotifyTrackId(uriHint ?? "") ||
    normalizeSpotifyTrackId(seed.spotifyUri ?? "") ||
    normalizeSpotifyTrackId(seed.spotifyId ?? "") ||
    normalizeSpotifyTrackId(seed.trackId);
  return {
    ...seed,
    trackId: fromUri || seed.trackId.trim(),
    title: seed.title.trim(),
    artist: seed.artist.trim(),
    album: seed.album?.trim() || seed.album,
    spotifyId: fromUri || seed.spotifyId,
    spotifyUri: (uriHint ?? seed.spotifyUri)?.trim() || seed.spotifyUri,
  };
}

export type UseWebOrchestratorOptions = {
  /**
   * ControlDeck master (0–1). Seeds the Spotify Web Playback SDK player and
   * syncs {@link WebOrchestrator} companion DJ voice gain on create.
   */
  volume?: number;
};

/**
 * Glue hook: MusicSourceContext → WebOrchestrator companion DJ breaks,
 * Spotify play-on-launch, and continuous playback-state sync / auto-advance.
 *
 * Keeps callback props on refs so parent re-renders cannot remount the
 * orchestrator mid-break or re-trigger network work from unstable deps.
 */
export function useWebOrchestrator(
  options: UseWebOrchestratorOptions = {},
): UseWebOrchestratorResult {
  const { activeProvider, isConnected, djVolume, djVolumeReady } =
    useMusicSource();
  const { isPro } = useTier();
  const {
    activePersonaId,
    allowExplicit,
    commentaryFormat: globalCommentaryFormat,
    chatterPacing,
    mood: prefsMood,
    personality: prefsPersonality,
    stationConfigs,
    savedStations,
  } = useUserPreferences();
  const foldedSettings = resolveCompanionStationSettings(
    savedStations,
    stationConfigs,
    chatterPacing,
    globalCommentaryFormat,
    prefsMood,
    prefsPersonality,
  );
  const commentaryFormat =
    foldedSettings?.commentaryFormat ?? globalCommentaryFormat;
  const vibePrompt = foldedSettings?.vibePrompt ?? "";
  const [isDjBreakInProgress, setIsDjBreakInProgress] = useState(false);
  const [status, setStatus] = useState<OrchestratorStatus>("STANDBY");
  const [companionNotice, setCompanionNotice] = useState<string | null>(null);
  const [companionNowPlaying, setCompanionNowPlaying] =
    useState<CompanionNowPlaying | null>(null);
  const [companionPlayback, setCompanionPlayback] =
    useState<CompanionPlayback | null>(null);
  const [activeScriptText, setActiveScriptText] = useState("");
  const [broadcastHistory, setBroadcastHistory] = useState<
    BroadcastHistoryEntry[]
  >([]);
  /**
   * Station handoff UI lock — suppresses album art / title / artist flashes
   * from stale Spotify `player_state_changed` events until `uris[0]` lands.
   */
  const [isLaunchingStation, setIsLaunchingStation] = useState(false);

  const orchestratorRef = useRef<WebOrchestrator | null>(null);
  const orchestratorProviderRef = useRef<OrchestratorProvider | null>(null);
  const activeProviderRef = useRef(activeProvider);
  const isConnectedRef = useRef(isConnected);
  const djVolumeRef = useRef(djVolume);
  /** Mirrors ControlDeck master so SDK boot / orchestrator create stay in sync. */
  const masterVolumeRef = useRef(
    typeof options.volume === "number" && Number.isFinite(options.volume)
      ? options.volume
      : 0.5,
  );
  const playbackStopRef = useRef<(() => void) | null>(null);
  const nearEndUriRef = useRef<string | null>(null);
  const endedUriRef = useRef<string | null>(null);
  const onNearEndRef = useRef<(() => void) | null>(null);
  const onTrackEndedRef = useRef<
    | ((ended?: {
        spotifyId?: string | null;
        title?: string;
        artist?: string;
      }) => void)
    | null
  >(null);
  const onTrackStartedRef = useRef<
    | ((playing: {
        spotifyId?: string | null;
        title?: string;
        artist?: string;
      }) => void)
    | null
  >(null);
  const onTrackChangeRef = useRef<
    ((track: CompanionNowPlaying) => void) | null
  >(null);
  const advancingRef = useRef(false);
  /** Last Spotify track id handed to `registerTrack` (lock-reset debounce). */
  const registeredTrackIdRef = useRef<string | null>(null);
  /**
   * Last Spotify track id handed to `onTrackStarted` (UI queue / Broadcast Log
   * sync). Separate from {@link registeredTrackIdRef} so a mid-break skip of
   * `registerTrack` cannot spam sync callbacks or permanently skip DJ warmup.
   */
  const startedTrackIdRef = useRef<string | null>(null);
  /**
   * Last applied SDK / REST playhead stamp. Local 250ms interpolation fills
   * the gaps between sparse transport events.
   */
  const playheadSampleRef = useRef<PlayheadSample | null>(null);
  const playheadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playheadSeekingRef = useRef(false);
  const playheadStallRescueRef = useRef(false);
  const playheadInterpolationActiveRef = useRef(false);
  const lastPublishedTrackRef = useRef<ActiveTrackState | null>(null);
  const tickPlayheadInterpolationRef = useRef<() => void>(() => {});
  const reanchorPlayheadRef = useRef<() => Promise<void>>(async () => {});
  const applyTransportSampleRef = useRef<
    (input: {
      trackId: string;
      positionMs: number;
      durationMs: number;
      playing: boolean;
      track?: ActiveTrackState;
    }) => void
  >(() => {});
  /**
   * Mirror of `isLaunchingStation` for the playback-state listener (avoids
   * stale closures / unstable deps in the Spotify poll callback).
   */
  const isLaunchingStationRef = useRef(false);
  /**
   * Target launch track (`uris[0]`). While `isLaunchingStation` is true, UI
   * metadata updates are ignored unless the incoming event URI matches this.
   */
  const launchTargetUriRef = useRef<string | null>(null);
  /** Embedded Web Playback SDK player — owns the LinerLore Connect device. */
  const spotifySdkPlayerRef = useRef<SpotifyWebPlaybackPlayer | null>(null);
  const spotifySdkReadyDeviceRef = useRef<string | null>(null);
  /** Live persona id for triggerBreakNow / mid-session host switches. */
  const activePersonaIdRef = useRef(activePersonaId);
  /** Subscription tier for Free→OpenAI / Pro→ElevenLabs voice guards. */
  const isProRef = useRef(isPro);
  /** Clean Mode preference forwarded into generate-script. */
  const allowExplicitRef = useRef(allowExplicit);
  /** Lore depth preference forwarded into generate-script. */
  const commentaryFormatRef = useRef(commentaryFormat);
  /** Host Studio custom directives / station vibe forwarded into generate-script. */
  const vibePromptRef = useRef(vibePrompt);
  /** Last persona synced into the orchestrator (detect mid-session changes). */
  const syncedPersonaIdRef = useRef<string | null>(null);
  /**
   * Pending shared-studio break cues. Re-applied whenever the orchestrator is
   * (re)created so recipient hydration survives Connect handoff.
   */
  const studioManifestRef = useRef<StudioManifestLoadInput | null>(null);
  /**
   * Deck pause intent — survives SDK `player_state_changed` flips that would
   * otherwise paint `isPlaying: true` after a background-tab WebSocket reconnect.
   */
  const uiPausedIntentRef = useRef(false);
  /** Tracks `document.hidden` so focus/visibility handlers only run after idle. */
  const wasDocumentHiddenRef = useRef(
    typeof document !== "undefined" ? document.hidden : false,
  );

  useEffect(() => {
    activeProviderRef.current = activeProvider;
    isConnectedRef.current = isConnected;
  }, [activeProvider, isConnected]);

  useEffect(() => {
    if (typeof options.volume !== "number" || !Number.isFinite(options.volume)) {
      return;
    }
    masterVolumeRef.current = options.volume;
    orchestratorRef.current?.setMasterVolume(options.volume);
  }, [options.volume]);

  useEffect(() => {
    // Keep the ref current even before hydration so ensureOrchestrator
    // can stamp the live value once storage has been read.
    djVolumeRef.current = djVolume;
    if (!djVolumeReady) return;
    orchestratorRef.current?.setDjVolume(djVolume);
  }, [djVolume, djVolumeReady]);

  useEffect(() => {
    activePersonaIdRef.current = activePersonaId;
  }, [activePersonaId]);

  // Keep Free/Pro voice guards in sync with TierContext.
  useEffect(() => {
    isProRef.current = isPro;
    orchestratorRef.current?.setIsPro(isPro);
  }, [isPro]);

  useEffect(() => {
    const previous = allowExplicitRef.current;
    allowExplicitRef.current = allowExplicit;
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;
    orchestrator.setAllowExplicit(allowExplicit);
    // Prefetched TTS was generated under the prior Clean Mode gate — drop it.
    if (previous !== allowExplicit) {
      orchestrator.flushPrefetch();
    }
  }, [allowExplicit]);

  useEffect(() => {
    const previous = commentaryFormatRef.current;
    commentaryFormatRef.current = commentaryFormat;
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;
    orchestrator.setCommentaryFormat(commentaryFormat);
    // Enforce duck (standard / 18% relative) vs pause-or-ambient (extended / 5%).
    const policy = resolveBreakTransitionPolicy(commentaryFormat);
    console.log("[SongHost] Break transition policy", {
      commentaryFormat: policy.commentaryFormat,
      mode: policy.mode,
      duckRatio: policy.duckRatio,
      pauseMusic: policy.pauseMusic,
    });
    if (previous !== commentaryFormat) {
      orchestrator.flushPrefetch();
    }
  }, [commentaryFormat]);

  useEffect(() => {
    const previous = vibePromptRef.current;
    vibePromptRef.current = vibePrompt;
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;
    orchestrator.setVibePrompt(vibePrompt);
    if (previous !== vibePrompt) {
      orchestrator.flushPrefetch();
    }
  }, [vibePrompt]);

  const breakTransitionPolicy = useMemo(
    () => resolveBreakTransitionPolicy(commentaryFormat),
    [commentaryFormat],
  );

  const isUiPaused = useCallback((): boolean => {
    return (
      uiPausedIntentRef.current
      || orchestratorRef.current?.isPausedIntent === true
    );
  }, []);

  const stopPlayheadClock = useCallback(() => {
    if (playheadTimerRef.current != null) {
      clearInterval(playheadTimerRef.current);
      playheadTimerRef.current = null;
    }
    playheadInterpolationActiveRef.current = false;
  }, []);

  const startPlayheadClock = useCallback(() => {
    if (playheadTimerRef.current != null) return;
    playheadInterpolationActiveRef.current = true;
    playheadTimerRef.current = setInterval(() => {
      tickPlayheadInterpolationRef.current();
    }, PLAYHEAD_INTERPOLATION_MS);
  }, []);

  const applyTransportSample = useCallback(
    (input: {
      trackId: string;
      positionMs: number;
      durationMs: number;
      playing: boolean;
      track?: ActiveTrackState;
    }) => {
      const trackId = input.trackId.trim();
      const prev = playheadSampleRef.current;
      const trackChanged = Boolean(
        trackId && prev?.trackId && prev.trackId !== trackId,
      );
      const modeB = orchestratorRef.current?.isModeBTransportHold() === true;
      const uiPaused = isUiPaused();
      playheadSeekingRef.current = false;

      let positionMs = Number.isFinite(input.positionMs)
        ? Math.max(0, input.positionMs)
        : 0;
      let playing = input.playing;
      if (modeB) {
        positionMs = 0;
        playing = false;
      } else if (uiPaused) {
        playing = false;
      }
      if (trackChanged && modeB) {
        positionMs = 0;
        playing = false;
      }

      playheadSampleRef.current = {
        trackId: trackId || prev?.trackId || "",
        positionMs,
        durationMs: Number.isFinite(input.durationMs)
          ? Math.max(0, input.durationMs)
          : 0,
        receivedAt: Date.now(),
        playing,
      };
      playheadStallRescueRef.current = false;

      if (input.track) {
        lastPublishedTrackRef.current = {
          ...input.track,
          id: input.track.id ?? (trackId || null),
          positionMs,
          isPaused: !playing,
        };
      } else if (lastPublishedTrackRef.current) {
        lastPublishedTrackRef.current = {
          ...lastPublishedTrackRef.current,
          positionMs,
          isPaused: !playing,
        };
      }

      setCompanionPlayback({
        progressMs: positionMs,
        durationMs: playheadSampleRef.current.durationMs,
        isPlaying: playing,
      });

      if (playing && !modeB && !uiPaused) {
        startPlayheadClock();
      } else {
        stopPlayheadClock();
      }
    },
    [isUiPaused, startPlayheadClock, stopPlayheadClock],
  );
  applyTransportSampleRef.current = applyTransportSample;

  const publishPlayheadPositionOnly = useCallback(
    (progressMs: number, isPaused: boolean) => {
      const last = lastPublishedTrackRef.current;
      setCompanionPlayback((prev) =>
        prev
          ? { ...prev, progressMs, isPlaying: !isPaused }
          : {
              progressMs,
              durationMs: playheadSampleRef.current?.durationMs ?? 0,
              isPlaying: !isPaused,
            },
      );
      if (!last) return;
      const next = { ...last, positionMs: progressMs, isPaused };
      lastPublishedTrackRef.current = next;
      publishActiveTrackState(orchestratorRef.current, next);
    },
    [],
  );

  tickPlayheadInterpolationRef.current = () => {
    const sample = playheadSampleRef.current;
    if (!sample?.playing) return;
    if (playheadSeekingRef.current) return;
    if (isUiPaused()) return;
    if (orchestratorRef.current?.isModeBTransportHold()) return;

    const now = Date.now();
    if (now - sample.receivedAt > PLAYHEAD_STALL_RESCUE_MS) {
      void reanchorPlayheadRef.current();
      return;
    }
    publishPlayheadPositionOnly(
      interpolatePlayheadProgressMs(sample, now),
      false,
    );
  };

  reanchorPlayheadRef.current = async () => {
    if (playheadStallRescueRef.current) return;
    playheadStallRescueRef.current = true;
    try {
      const player = spotifySdkPlayerRef.current;
      const sdkState = player ? await player.getCurrentState() : null;
      const fromSdk = sdkState ? activeTrackFromSdkState(sdkState) : null;
      if (fromSdk) {
        const paused = isUiPaused() || Boolean(fromSdk.isPaused);
        applyTransportSampleRef.current({
          trackId: fromSdk.id?.trim() || "",
          positionMs: fromSdk.positionMs ?? 0,
          durationMs: fromSdk.durationMs ?? 0,
          playing: !paused,
          track: { ...fromSdk, isPaused: paused },
        });
        if (fromSdk.title && fromSdk.artist) {
          publishActiveTrackState(orchestratorRef.current, {
            ...fromSdk,
            isPaused: paused,
          });
        }
        return;
      }

      const token = await getValidSpotifyAccessToken();
      if (!token) return;
      const live = await getCurrentlyPlaying(token);
      if (!live) return;
      const track = activeTrackFromSpotifyTrack(live);
      const paused = isUiPaused() || Boolean(track.isPaused);
      applyTransportSampleRef.current({
        trackId: track.id?.trim() || "",
        positionMs: track.positionMs ?? 0,
        durationMs: track.durationMs ?? 0,
        playing: !paused,
        track: { ...track, isPaused: paused },
      });
      publishActiveTrackState(orchestratorRef.current, {
        ...track,
        isPaused: paused,
      });
    } catch (err) {
      console.error("[LinerLore TRACE ERROR] playhead re-anchor failed", err);
    } finally {
      playheadStallRescueRef.current = false;
    }
  };

  useEffect(() => {
    return () => {
      stopPlayheadClock();
    };
  }, [stopPlayheadClock]);

  /**
   * Force Spotify SDK + REST pause (and suspend Web Audio) when the deck is
   * paused but the SDK auto-resumed after tab idle / WebSocket reconnect.
   */
  const enforceUiPausedTransport = useCallback(async () => {
    if (!isUiPaused()) return;

    console.log(
      "[LinerLore TRACE] Enforcing UI paused transport (visibility/SDK guard)",
    );

    const player = spotifySdkPlayerRef.current;
    if (player) {
      try {
        await player.pause();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
    }

    const live = orchestratorRef.current;
    if (live) {
      await live.enforcePausedTransport();
    } else {
      uiPausedIntentRef.current = true;
      try {
        const token = await getValidSpotifyAccessToken();
        if (token) await spotifyPause(token);
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
      try {
        const ctx = getMasterAnalyser().getAudioContext();
        if (ctx && ctx.state === "running") {
          void ctx.suspend().catch((suspendErr) => {
            console.error("[LinerLore TRACE ERROR]", suspendErr);
          });
        }
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
    }

    setCompanionPlayback((prev) =>
      prev ? { ...prev, isPlaying: false } : prev,
    );
    stopPlayheadClock();
    const sample = playheadSampleRef.current;
    if (sample) {
      playheadSampleRef.current = { ...sample, playing: false };
    }
  }, [isUiPaused, stopPlayheadClock]);

  /**
   * Visibility + window guards: after background throttling / idle, reconcile
   * SDK playback with React pause intent so reconnect cannot ghost-play.
   */
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const reconcileIfNeeded = () => {
      const hidden = document.hidden;
      const recovered = wasDocumentHiddenRef.current && !hidden;
      wasDocumentHiddenRef.current = hidden;
      if (!recovered && hidden) return;
      if (!isUiPaused()) return;
      void enforceUiPausedTransport();
    };

    const onVisibilityChange = () => {
      reconcileIfNeeded();
    };

    const onFocus = () => {
      // Focus can fire without a visibility flip after WS reconnect.
      if (isUiPaused()) {
        void enforceUiPausedTransport();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [enforceUiPausedTransport, isUiPaused]);

  const dismissCompanionNotice = useCallback(() => {
    setCompanionNotice(null);
  }, []);

  const destroySpotifySdkPlayer = useCallback(() => {
    const player = spotifySdkPlayerRef.current;
    if (player) {
      try {
        player.disconnect();
      } catch {
        // Player may already be torn down.
      }
    }
    spotifySdkPlayerRef.current = null;
    spotifySdkReadyDeviceRef.current = null;
    stopPlayheadClock();
    playheadSampleRef.current = null;
    registerSpotifySdkPlayer(null);
    setSpotifyActiveDeviceId(null);
  }, [stopPlayheadClock]);

  const clearStationLaunchLock = useCallback(() => {
    isLaunchingStationRef.current = false;
    launchTargetUriRef.current = null;
    setIsLaunchingStation(false);
  }, []);

  /**
   * Arm the station-launch UI lock. When `uris` is provided, pin the unlock
   * target to `uris[0]` (the launch opener). Call without URIs at handoff
   * start so stale polls cannot paint the previous station during search.
   */
  const beginStationLaunchLock = useCallback((uris?: string | string[]) => {
    isLaunchingStationRef.current = true;
    setIsLaunchingStation(true);
    if (uris === undefined) return;
    const list = (Array.isArray(uris) ? uris : [uris])
      .map((uri) => uri.trim())
      .filter(Boolean);
    launchTargetUriRef.current = list[0] ?? null;
  }, []);

  /**
   * True when an incoming Spotify URI is the launch opener (`uris[0]`),
   * comparing bare catalog ids so `spotify:track:…` aliasing still matches.
   */
  const matchesLaunchTargetUri = useCallback(
    (uri: string | undefined | null) => {
      const target = launchTargetUriRef.current?.trim() || "";
      if (!target) return false;
      const incoming = uri?.trim() || "";
      if (!incoming) return false;
      if (incoming === target) return true;
      const incomingId = normalizeSpotifyTrackId(incoming);
      const targetId = normalizeSpotifyTrackId(target);
      return Boolean(incomingId && targetId && incomingId === targetId);
    },
    [],
  );

  const stopSpotifyPlaybackMonitor = useCallback(() => {
    playbackStopRef.current?.();
    playbackStopRef.current = null;
    nearEndUriRef.current = null;
    endedUriRef.current = null;
    advancingRef.current = false;
    registeredTrackIdRef.current = null;
    // Do not clear isLaunchingStation here — monitor restarts on
    // queueGeneration change mid-handoff and must keep the UI lock.
  }, []);

  const tearDownOrchestrator = useCallback(() => {
    stopSpotifyPlaybackMonitor();
    destroySpotifySdkPlayer();
    clearStationLaunchLock();
    orchestratorRef.current?.clearDjPrefetch();
    orchestratorRef.current?.resetBreakSession();
    orchestratorRef.current?.stopDjAudio();
    orchestratorRef.current = null;
    orchestratorProviderRef.current = null;
    setIsDjBreakInProgress(false);
    setStatus("STANDBY");
    setCompanionNowPlaying(null);
    setCompanionPlayback(null);
    updateCurrentTrackState(null);
    setActiveScriptText("");
    setBroadcastHistory([]);
    resetDjBroadcast();
  }, [
    clearStationLaunchLock,
    destroySpotifySdkPlayer,
    stopSpotifyPlaybackMonitor,
  ]);

  useEffect(() => {
    if (!isConnected || !activeProvider) {
      tearDownOrchestrator();
    }
  }, [isConnected, activeProvider, tearDownOrchestrator]);

  useEffect(() => () => tearDownOrchestrator(), [tearDownOrchestrator]);

  /**
   * When Spotify is connected, boot the Web Playback SDK so LinerLore becomes
   * a Connect device. On `ready`, auto-transfer playback here (play: false)
   * and dismiss the "open Spotify" banner.
   */
  useEffect(() => {
    if (!isConnected || activeProvider !== "spotify") {
      destroySpotifySdkPlayer();
      return;
    }

    let cancelled = false;

    const boot = async () => {
      try {
        const token = await getValidSpotifyAccessToken();
        if (!token || cancelled) return;

        const Spotify = await loadSpotifyWebPlaybackSdk();
        if (cancelled) return;

        // Reuse an already-ready player (e.g. Strict Mode remount).
        if (spotifySdkPlayerRef.current && spotifySdkReadyDeviceRef.current) {
          return;
        }

        destroySpotifySdkPlayer();

        const player = new Spotify.Player({
          name: "LinerLore",
          getOAuthToken: (cb) => {
            void getValidSpotifyAccessToken().then((access) => {
              cb(access ?? "");
            });
          },
          volume: masterVolumeRef.current,
        });

        player.addListener("ready", (payload) => {
          const deviceId =
            payload && typeof payload === "object" && "device_id" in payload
              ? String(
                  (payload as { device_id?: string }).device_id ?? "",
                ).trim()
              : "";
          if (!deviceId || cancelled) return;

          console.log("[Spotify SDK] ready — device_id:", deviceId);
          spotifySdkReadyDeviceRef.current = deviceId;
          setSpotifyActiveDeviceId(deviceId);
          registerSpotifySdkPlayer({
            setVolume: (volumeNormalized) => player.setVolume(volumeNormalized),
            getVolume: () => player.getVolume(),
            pause: () => player.pause(),
            resume: () => player.resume(),
            seek: (positionMs) => player.seek(positionMs),
            getCurrentState: () => player.getCurrentState(),
            device_id: deviceId,
            getDeviceId: () => spotifySdkReadyDeviceRef.current,
          });
          // SDK listener is now the progress driver — drop the REST poll.
          playbackStopRef.current?.();
          playbackStopRef.current = null;

          void transferPlaybackToLocalDevice(deviceId, false).then((result) => {
            if (cancelled) return;
            if (result === true || !isNoActiveDeviceResult(result)) {
              // Device is registered — hide the open-Spotify warning.
              setCompanionNotice(null);
            }
            if (result === true) {
              console.log(
                "[Spotify SDK] Transferred playback to LinerLore device",
                deviceId,
              );
            }
          });
        });

        player.addListener("not_ready", (payload) => {
          const deviceId =
            payload && typeof payload === "object" && "device_id" in payload
              ? String(
                  (payload as { device_id?: string }).device_id ?? "",
                ).trim()
              : "";
          console.warn("[Spotify SDK] not_ready — device_id:", deviceId);
          if (deviceId && spotifySdkReadyDeviceRef.current === deviceId) {
            spotifySdkReadyDeviceRef.current = null;
          }
        });

        // Live track metadata for the deck / MediaSession before REST polls land.
        // Also detects SDK track-end stalls so Autopilot can playNextTrack().
        attachSpotifyPlayerStateListener(player as Parameters<
          typeof attachSpotifyPlayerStateListener
        >[0], {
          shouldApply: (track: ActiveTrackState) => {
            if (!isLaunchingStationRef.current) return true;
            const incomingUri = track.id
              ? `spotify:track:${track.id}`
              : null;
            if (!matchesLaunchTargetUri(incomingUri)) {
              console.log(
                "[LinerLore TRACE] Ignoring stale Spotify player_state_changed — isLaunchingStation",
                {
                  incomingUri,
                  launchTargetUri: launchTargetUriRef.current,
                },
              );
              return false;
            }
            clearStationLaunchLock();
            console.log(
              "[LinerLore TRACE] Launch URI confirmed via player_state_changed",
              { uri: incomingUri },
            );
            return true;
          },
          onTrack: (track: ActiveTrackState) => {
            // Re-publish the full payload (title/artist/album/art/ids) so deck
            // subscribers always see a fresh object after skip / advance.
            const orch = orchestratorRef.current;
            const modeB = orch?.isModeBTransportHold() === true;
            const paused = isUiPaused() || Boolean(track.isPaused) || modeB;
            const positionMs = modeB ? 0 : (track.positionMs ?? 0);
            publishActiveTrackState(orch, {
              ...track,
              positionMs,
              isPaused: paused,
            });
            setCompanionNowPlaying({
              title: track.title,
              artist: track.artist,
              album: track.album,
              albumArtUrl: track.albumArtUrl,
              uri: track.id ? `spotify:track:${track.id}` : undefined,
            });
            applyTransportSampleRef.current({
              trackId: track.id?.trim() || "",
              positionMs,
              durationMs: track.durationMs ?? 0,
              playing: !paused,
              track: {
                ...track,
                positionMs,
                isPaused: paused,
              },
            });
            // SDK is the sole progress driver — fire near-end prefetch here
            // so suppressing the REST poll does not drop Autopilot warmup.
            if (!paused && !modeB) {
              const remainingMs =
                typeof track.durationMs === "number" &&
                typeof positionMs === "number" &&
                Number.isFinite(track.durationMs) &&
                Number.isFinite(positionMs)
                  ? Math.max(0, track.durationMs - positionMs)
                  : null;
              const uri = track.id ? `spotify:track:${track.id}` : null;
              if (
                uri &&
                remainingMs != null &&
                remainingMs <= COMPANION_PREFETCH_NEAR_END_MS
              ) {
                if (nearEndUriRef.current !== uri) {
                  nearEndUriRef.current = uri;
                  onNearEndRef.current?.();
                }
              }
            }
          },
          onTrackStarted: (track: ActiveTrackState) => {
            // Mid-queue auto-advance: register for Duck–Talk–Swell and notify
            // UI sync. Never bump sessionEpoch / flushForStationLaunch here.
            if (isUiPaused()) return;
            const liveTrackId = track.id?.trim() || null;
            const orch = orchestratorRef.current;
            // Fail-closed: freeze Track B before registerTrack awaits history/TTS.
            if (orch?.shouldHoldIncomingTransport(liveTrackId)) {
              void orch.freezeIncomingCompanionTransport();
            }
            // Mode B speech: SDK auto-advance must not run Track B under the host.
            // Prefetch holds still register so history / the break can start.
            if (orch?.isModeBSpeechHold()) {
              void orch.holdModeBCompanionPlayhead();
              if (liveTrackId) orch.noteActualPlayback(liveTrackId);
              if (liveTrackId && liveTrackId !== startedTrackIdRef.current) {
                startedTrackIdRef.current = liveTrackId;
                onTrackStartedRef.current?.({
                  spotifyId: track.id,
                  title: track.title,
                  artist: track.artist,
                });
              }
              return;
            }
            if (
              liveTrackId &&
              liveTrackId !== registeredTrackIdRef.current
            ) {
              if (orchestratorRef.current?.isRunning) {
                orchestratorRef.current.noteActualPlayback(liveTrackId);
              } else {
                registeredTrackIdRef.current = liveTrackId;
                orchestratorRef.current?.registerTrack(liveTrackId);
                setIsDjBreakInProgress(false);
              }
            }
            if (liveTrackId && liveTrackId !== startedTrackIdRef.current) {
              startedTrackIdRef.current = liveTrackId;
              onTrackStartedRef.current?.({
                spotifyId: track.id,
                title: track.title,
                artist: track.artist,
              });
            }
          },
          onTrackEnded: (track: ActiveTrackState) => {
            if (orchestratorRef.current?.isModeBTransportHold()) {
              void orchestratorRef.current.holdModeBCompanionPlayhead();
              return;
            }
            if (advancingRef.current) return;
            const endedKey =
              track.id?.trim() ||
              `spotify:track:${track.title}\0${track.artist}`;
            if (endedUriRef.current === endedKey) return;
            endedUriRef.current = endedKey;
            advancingRef.current = true;
            orchestratorRef.current?.releaseBreakLocks();
            setIsDjBreakInProgress(false);
            console.log(
              "[LinerLore TRACE] SDK player_state_changed track end — playNextTrack",
              { trackId: track.id, title: track.title },
            );
            onTrackEndedRef.current?.({
              spotifyId: track.id,
              title: track.title,
              artist: track.artist,
            });
          },
          isUiPaused,
          forcePause: () => {
            void enforceUiPausedTransport();
          },
        });

        const connected = await player.connect();
        if (cancelled) {
          try {
            player.disconnect();
          } catch {
            // ignore
          }
          return;
        }

        if (!connected) {
          console.warn("[Spotify SDK] player.connect() returned false");
          return;
        }

        spotifySdkPlayerRef.current = player;
      } catch (error) {
        console.warn("[Spotify SDK] failed to initialize:", error);
      }
    };

    void boot();

    return () => {
      cancelled = true;
      // Tear down so a Strict Mode remount always re-registers + re-transfers.
      destroySpotifySdkPlayer();
    };
  }, [
    isConnected,
    activeProvider,
    destroySpotifySdkPlayer,
    clearStationLaunchLock,
    matchesLaunchTargetUri,
    isUiPaused,
    enforceUiPausedTransport,
  ]);

  const ensureOrchestrator = useCallback(async (): Promise<WebOrchestrator | null> => {
    const provider = activeProviderRef.current;
    if (!provider || !isConnectedRef.current) return null;

    let spotifyAccessToken: string | undefined;
    if (provider === "spotify") {
      const token = await getValidSpotifyAccessToken();
      if (!token) return null;
      spotifyAccessToken = token;
    }

    const expectedProvider = toOrchestratorProvider(provider);

    // Reuse the live orchestrator so autopilot DJ prefetch survives across
    // queue advances. resolveSpotifyToken() always refreshes the access token.
    if (
      orchestratorRef.current &&
      orchestratorProviderRef.current === expectedProvider
    ) {
      return orchestratorRef.current;
    }

    orchestratorRef.current?.clearDjPrefetch();
    orchestratorRef.current?.stopDjAudio();
    const orchestrator = createWebOrchestrator({
      provider: expectedProvider,
      spotifyAccessToken,
      initialDjVolume: djVolumeRef.current,
      onNoActiveDevice: () => {
        setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
        setIsDjBreakInProgress(false);
        setStatus("STANDBY");
      },
      onScript: (script) => {
        const live = orchestratorRef.current;
        const nextScript = live?.activeScriptText || script;
        const nextHistory = live ? [...live.broadcastHistory] : [];
        setActiveScriptText(nextScript);
        setBroadcastHistory(nextHistory);
      },
      onDjStart: (info: DjStartInfo) => {
        setIsDjBreakInProgress(true);
        const live = orchestratorRef.current;
        const script = (live?.activeScriptText || "").trim();
        if (!script) return;
        const latest = live?.broadcastHistory[live.broadcastHistory.length - 1];
        const { title, artist } = parseBroadcastTrackLabel(latest?.track);
        startDjSegment({
          kind: info.kind,
          transition: djTransitionForKind(info.kind),
          script,
          songTitle: title,
          artistName: artist,
        });
      },
      onDjEnd: () => {
        setIsDjBreakInProgress(false);
        finishDjSegment();
      },
      onStatusChange: (next) => {
        setStatus(next);
        if (next === "ON_AIR") setIsDjBreakInProgress(true);
        else if (next === "STANDBY") setIsDjBreakInProgress(false);
      },
      onError: () => {
        setIsDjBreakInProgress(false);
        setStatus("STANDBY");
        finishDjSegment({ interrupted: true });
      },
    });
    orchestrator.setIsPro(isProRef.current);
    orchestrator.setPersona(activePersonaIdRef.current);
    orchestrator.setDjVolume(djVolumeRef.current);
    orchestrator.setMasterVolume(masterVolumeRef.current);
    orchestrator.setAllowExplicit(allowExplicitRef.current);
    orchestrator.setCommentaryFormat(commentaryFormatRef.current);
    orchestrator.setVibePrompt(vibePromptRef.current);
    if (studioManifestRef.current) {
      orchestrator.loadStudioManifest(studioManifestRef.current);
    }
    syncedPersonaIdRef.current = activePersonaIdRef.current;
    orchestratorRef.current = orchestrator;
    orchestratorProviderRef.current = expectedProvider;
    setStatus(orchestrator.orchestratorStatus);

    return orchestrator;
  }, []);

  /**
   * Mid-session persona change: instantly update orchestrator host voice and
   * flush any prefetched TTS generated with the previous persona.
   */
  const setCompanionPersona = useCallback(
    (personaId: PersonaId | string) => {
      const next = String(personaId).trim();
      if (!next) return;
      const effective = getEffectivePersona(next, isProRef.current);
      activePersonaIdRef.current = (
        isOpenAiHostVoice(String(effective)) ? next : String(effective)
      ) as PersonaId;
      syncedPersonaIdRef.current = String(effective);
      const orchestrator = orchestratorRef.current;
      if (!orchestrator) return;
      orchestrator.setIsPro(isProRef.current);
      // setPersona already aborts in-flight speech and clears prefetch
      // when the resolved host actually changes — do not flush again.
      orchestrator.setPersona(String(effective));
    },
    [],
  );

  // Keep the live orchestrator in sync when UserPreferences changes the host.
  useEffect(() => {
    const effective = String(getEffectivePersona(activePersonaId, isPro));
    const previous = syncedPersonaIdRef.current;
    if (previous === effective) return;

    syncedPersonaIdRef.current = effective;
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;

    orchestrator.setIsPro(isPro);
    orchestrator.setPersona(effective);
    // Flush only on a real mid-session switch (not the first stamp).
    if (previous !== null) {
      orchestrator.flushPrefetch();
    }
  }, [activePersonaId, isPro]);

  const resolveTrackInput = useCallback(
    async (
      orchestrator: WebOrchestrator,
      personaId: PersonaId | string,
      seed?: CompanionTrackSeed | null,
    ): Promise<OrchestratorTrackInput | null> => {
      const effective = getEffectivePersona(String(personaId), isProRef.current);
      const persona = getPersonaById(
        isOpenAiHostVoice(String(effective)) ? String(personaId) : String(effective),
      );
      const voiceId = isProRef.current
        ? (resolveSessionVoiceId(persona?.id ?? String(effective))
          ?? persona?.elevenLabsVoiceId
          ?? persona?.voice)
        : String(effective);
      if (!voiceId) return null;

      // Prefer the launch/queue seed so lore matches the track about to play.
      // Live Spotify metadata often lags URI handoff and would script the
      // previous song (e.g. whatever was playing before People Are Strange).
      if (seed?.trackId && seed.title && seed.artist) {
        const normalized = seedWithNormalizedTrackId(seed);
        // title / artist / trackId must stay on the same object for TTS.
        if (!normalized.title || !normalized.artist || !normalized.trackId) {
          return null;
        }
        return {
          trackId: normalized.trackId,
          title: normalized.title,
          artist: normalized.artist,
          album: normalized.album,
          introDuration: normalized.introDuration,
          voiceId,
          // Free: OpenAI voice id only — never an ElevenLabs host persona.
          personaId: isProRef.current
            ? (persona?.id ?? String(personaId))
            : String(effective),
          mode: normalized.mode,
        };
      }

      const live = await orchestrator.getCurrentlyPlayingTrack().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return null;
      });
      if (live) {
        const trackId =
          normalizeSpotifyTrackId(live.uri) ||
          normalizeSpotifyTrackId(live.id) ||
          live.id;
        return {
          trackId,
          title: live.title,
          artist: live.artist,
          album: live.album,
          voiceId,
          personaId: isProRef.current
            ? (persona?.id ?? String(personaId))
            : String(effective),
          mode: seed?.mode,
        };
      }

      return null;
    },
    [],
  );

  const runCompanionDjBreak = useCallback(
    async (input: {
      personaId: PersonaId | string;
      seed?: CompanionTrackSeed | null;
      scriptContext?: DjScriptContext;
    }): Promise<RunDjBreakResult | null> => {
      try {
        const orchestrator = await ensureOrchestrator();
        if (!orchestrator) return null;

        const track = await resolveTrackInput(
          orchestrator,
          input.personaId,
          input.seed,
        );
        if (!track) return null;

        // New trackId → clear sticky isBreakInProgress / AudioContext locks
        // before Duck–Talk–Swell so Track 2+ is never blocked by Track 1.
        if (track.trackId && track.trackId !== registeredTrackIdRef.current) {
          registeredTrackIdRef.current = track.trackId;
          orchestrator.registerTrack(track.trackId);
        }

        const result = await orchestrator.runDjBreak(track, input.scriptContext);

        if (result.ok === false && result.reason === "NO_ACTIVE_DEVICE") {
          setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
          setIsDjBreakInProgress(false);
          return result;
        }

        if (result.ok === false) {
          setIsDjBreakInProgress(false);
        }

        return result;
      } catch (err) {
        // Companion breaks must never surface as unhandled exceptions to the
        // station launch path — Spotify idle / network blips stay non-blocking.
        console.error("[LinerLore TRACE ERROR]", err);
        setIsDjBreakInProgress(false);
        return null;
      }
    },
    [ensureOrchestrator, resolveTrackInput],
  );

  const prefetchCompanionDjBreak = useCallback(
    async (input: {
      personaId: PersonaId | string;
      seed: CompanionTrackSeed;
      scriptContext?: DjScriptContext;
    }): Promise<void> => {
      try {
        const orchestrator = await ensureOrchestrator();
        if (!orchestrator) return;

        const track = await resolveTrackInput(
          orchestrator,
          input.personaId,
          input.seed,
        );
        if (!track) return;

        await orchestrator.prefetchDjBreak(track, input.scriptContext);
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
    },
    [ensureOrchestrator, resolveTrackInput],
  );

  const setCompanionDjMode = useCallback(
    (mode: DjMode) => {
      void ensureOrchestrator().then((orchestrator) => {
        orchestrator?.setDjMode(mode);
      });
    },
    [ensureOrchestrator],
  );

  const setCompanionDjPacingFrequency = useCallback(
    (pacing: number) => {
      void ensureOrchestrator().then((orchestrator) => {
        orchestrator?.setDjPacingFrequency(pacing);
      });
    },
    [ensureOrchestrator],
  );

  const setCompanionDjTuning = useCallback(
    (tuning: {
      mood?: DjMood;
      personality?: DjPersonality;
      knowledge?: DjKnowledge;
    }) => {
      void ensureOrchestrator().then((orchestrator) => {
        // setDjTuning aborts in-flight generate-script + clears warmed buffers
        // when mood / personality / knowledge actually change.
        orchestrator?.setDjTuning(tuning);
      });
    },
    [ensureOrchestrator],
  );

  const setCompanionScriptContext = useCallback((context: DjScriptContext) => {
    orchestratorRef.current?.setScriptContext(context);
  }, []);

  const loadStudioManifestBreaks = useCallback(
    (input: StudioManifestLoadInput) => {
      studioManifestRef.current = input;
      const live = orchestratorRef.current;
      if (live) {
        live.loadStudioManifest(input);
        return;
      }
      void ensureOrchestrator().then((orchestrator) => {
        orchestrator?.loadStudioManifest(input);
      });
    },
    [ensureOrchestrator],
  );

  const willCompanionBreakOnNextTrack = useCallback((): boolean => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return true;
    return orchestrator.willBreakOnNextTrack();
  }, []);

  const triggerBreakNow = useCallback(async (): Promise<RunDjBreakResult | null> => {
    try {
      const orchestrator = await ensureOrchestrator();
      if (!orchestrator) return null;
      // Explicitly pass the live UI persona into generate-script.
      const livePersonaId = activePersonaIdRef.current;
      orchestrator.setPersona(livePersonaId);
      const result = await orchestrator.triggerBreakNow();
      if (result.ok === false && result.reason === "NO_ACTIVE_DEVICE") {
        setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
        setIsDjBreakInProgress(false);
        setStatus("STANDBY");
      } else if (result.ok === false) {
        setIsDjBreakInProgress(false);
      }
      return result;
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
      setIsDjBreakInProgress(false);
      setStatus("STANDBY");
      return null;
    }
  }, [ensureOrchestrator]);

  const skipActiveBreak = useCallback(() => {
    orchestratorRef.current?.skipActiveBreak();
    setIsDjBreakInProgress(false);
    setStatus("STANDBY");
    finishDjSegment({ interrupted: true });
  }, []);

  const resolvePrefetchTarget = useCallback(
    async (
      stationUpcoming: CompanionTrackSeed[],
    ): Promise<{
      seed: CompanionTrackSeed | null;
      upcomingQueue: OrchestratorTrackRef[];
      source: "spotify_queue" | "station_queue" | "none";
    }> => {
      // Prefer Spotify's live player queue so prefetched lore matches the
      // exact song the remote player will advance into.
      try {
        const token = await getValidSpotifyAccessToken();
        if (token) {
          const liveQueue = await getSpotifyPlayerQueue(token);
          const spotifyNext = liveQueue?.queue?.[0];
          if (spotifyNext) {
            const seed: CompanionTrackSeed = {
              trackId: spotifyNext.id,
              title: spotifyNext.name,
              artist: spotifyNext.artists.join(", "),
              album: spotifyNext.album,
              spotifyUri: spotifyNext.uri,
            };
            const upcomingQueue = liveQueue.queue.slice(1, 3).map((t) => ({
              title: t.name,
              artist: t.artists.join(", "),
            }));
            return { seed, upcomingQueue, source: "spotify_queue" };
          }
        }
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }

      // Single-URI plays leave Spotify's queue empty — use LinerLore's station queue.
      const seed = stationUpcoming[0] ?? null;
      if (!seed) {
        return { seed: null, upcomingQueue: [], source: "none" };
      }
      return {
        seed,
        upcomingQueue: stationUpcoming.slice(1, 3).map((t) => ({
          title: t.title,
          artist: t.artist,
        })),
        source: "station_queue",
      };
    },
    [],
  );

  const noticeFromPlaybackResult = useCallback(
    (result: SpotifyPlaybackResult): boolean => {
      if (isNoActiveDeviceResult(result)) {
        setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
        return false;
      }
      return result === true;
    },
    [],
  );

  const withSpotifyToken = useCallback(
    async (
      command: (token: string) => Promise<SpotifyPlaybackResult>,
    ): Promise<SpotifyPlaybackResult> => {
      if (activeProviderRef.current !== "spotify" || !isConnectedRef.current) {
        return false;
      }
      const token = await getValidSpotifyAccessToken();
      if (!token) return false;
      try {
        const result = await command(token);
        noticeFromPlaybackResult(result);
        return result;
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      }
    },
    [noticeFromPlaybackResult],
  );

  /**
   * Deck Play after reboot: route through WebOrchestrator so a restored track
   * without Spotify playback context issues `playTrack(uri)` instead of resume.
   */
  const resumeRemote = useCallback(async (): Promise<SpotifyPlaybackResult> => {
    if (activeProviderRef.current !== "spotify" || !isConnectedRef.current) {
      return false;
    }
    uiPausedIntentRef.current = false;
    try {
      const orchestrator = await ensureOrchestrator();
      if (!orchestrator) {
        const result = await withSpotifyToken((token) => spotifyResume(token));
        if (result !== true) uiPausedIntentRef.current = true;
        return result;
      }
      const result = await orchestrator.resume();
      if (result !== true) uiPausedIntentRef.current = true;
      noticeFromPlaybackResult(result);
      return result;
    } catch (err) {
      console.error("[LinerLore TRACE ERROR] resumeRemote", err);
      uiPausedIntentRef.current = true;
      return false;
    }
  }, [ensureOrchestrator, noticeFromPlaybackResult, withSpotifyToken]);

  const togglePlayRemote = useCallback(async (): Promise<
    "playing" | "paused" | "failed"
  > => {
    if (activeProviderRef.current !== "spotify" || !isConnectedRef.current) {
      return "failed";
    }
    try {
      const orchestrator = await ensureOrchestrator();
      if (!orchestrator) return "failed";
      const result = await orchestrator.togglePlay();
      uiPausedIntentRef.current = result === "paused";
      if (result === "paused") {
        stopPlayheadClock();
        const sample = playheadSampleRef.current;
        if (sample) {
          playheadSampleRef.current = { ...sample, playing: false };
        }
        setCompanionPlayback((prev) =>
          prev ? { ...prev, isPlaying: false } : prev,
        );
      } else if (result === "playing") {
        const sample = playheadSampleRef.current;
        if (sample) {
          playheadSampleRef.current = {
            ...sample,
            playing: true,
            receivedAt: Date.now(),
          };
        }
        setCompanionPlayback((prev) =>
          prev ? { ...prev, isPlaying: true } : prev,
        );
        startPlayheadClock();
      }
      return result;
    } catch (err) {
      console.error("[LinerLore TRACE ERROR] togglePlayRemote", err);
      return "failed";
    }
  }, [ensureOrchestrator, startPlayheadClock, stopPlayheadClock]);

  const pauseRemote = useCallback(async (): Promise<SpotifyPlaybackResult> => {
    uiPausedIntentRef.current = true;
    stopPlayheadClock();
    const sample = playheadSampleRef.current;
    if (sample) {
      playheadSampleRef.current = { ...sample, playing: false };
    }
    setCompanionPlayback((prev) =>
      prev ? { ...prev, isPlaying: false } : prev,
    );
    try {
      const orchestrator = await ensureOrchestrator();
      if (orchestrator) {
        await orchestrator.pause();
        return true;
      }
      return await withSpotifyToken((token) => spotifyPause(token));
    } catch (err) {
      console.error("[LinerLore TRACE ERROR] pauseRemote", err);
      return false;
    }
  }, [ensureOrchestrator, stopPlayheadClock, withSpotifyToken]);
  const nextRemote = useCallback(async (): Promise<SpotifyPlaybackResult> => {
    // Skip must never stay gated by a leftover station-launch lock — otherwise
    // player_state_changed updates are dropped and title/artist stick on uris[0].
    clearStationLaunchLock();
    return withSpotifyToken((token) => spotifyNext(token));
  }, [clearStationLaunchLock, withSpotifyToken]);
  const previousRemote = useCallback(async (): Promise<SpotifyPlaybackResult> => {
    clearStationLaunchLock();
    return withSpotifyToken((token) => spotifyPrevious(token));
  }, [clearStationLaunchLock, withSpotifyToken]);
  const seekRemote = useCallback(
    (positionMs: number) => {
      const ms = Math.max(0, Math.floor(positionMs));
      playheadSeekingRef.current = true;
      stopPlayheadClock();
      const sample = playheadSampleRef.current;
      if (sample) {
        playheadSampleRef.current = {
          ...sample,
          positionMs: ms,
          receivedAt: Date.now(),
          playing: false,
        };
      }
      setCompanionPlayback((prev) =>
        prev ? { ...prev, progressMs: ms } : prev,
      );
      const last = lastPublishedTrackRef.current;
      if (last) {
        const next = { ...last, positionMs: ms };
        lastPublishedTrackRef.current = next;
        publishActiveTrackState(orchestratorRef.current, next);
      }
      return withSpotifyToken((token) => spotifySeek(token, ms));
    },
    [stopPlayheadClock, withSpotifyToken],
  );

  const setSpotifyRemoteVolume = useCallback(
    (volumeNormalized: number) =>
      withSpotifyToken((token) => setSpotifyVolume(token, volumeNormalized)),
    [withSpotifyToken],
  );

  /**
   * ControlDeck → WebOrchestrator master bridge. Stores master for companion
   * DJ TTS and applies gain on the active Spotify / Apple Music transport.
   */
  const setVolume = useCallback(
    async (volumeNormalized: number) => {
      masterVolumeRef.current = volumeNormalized;
      const live = orchestratorRef.current;
      if (live) {
        await live.setVolume(volumeNormalized);
        return;
      }
      // Orchestrator not armed yet — still push Spotify so the bed tracks the
      // fader; master syncs when ensureOrchestrator() creates the instance.
      if (activeProviderRef.current === "spotify" && isConnectedRef.current) {
        await withSpotifyToken((token) =>
          setSpotifyVolume(token, volumeNormalized),
        );
      }
    },
    [withSpotifyToken],
  );

  const spotifyRemote = useMemo<SpotifyRemoteControls>(
    () => ({
      resume: resumeRemote,
      pause: pauseRemote,
      next: nextRemote,
      previous: previousRemote,
      seek: seekRemote,
      setVolume: setSpotifyRemoteVolume,
      togglePlay: togglePlayRemote,
    }),
    [
      resumeRemote,
      pauseRemote,
      nextRemote,
      previousRemote,
      seekRemote,
      setSpotifyRemoteVolume,
      togglePlayRemote,
    ],
  );

  /**
   * Start Spotify playback on explicit track URI(s). Prefer this after a
   * station search has already resolved Spotify catalog IDs.
   * Pass `flushSession: true` only for manual station / mix launches.
   */
  const playTrack = useCallback(
    async (input: {
      uri: string | string[];
      personaId?: PersonaId | string;
      seed?: CompanionTrackSeed | null;
      withDjBreak?: boolean;
      scriptContext?: DjScriptContext;
      flushSession?: boolean;
      steerCorrection?: boolean;
    }): Promise<{ uri: string | null; dj: RunDjBreakResult | null }> => {
      const uris = (Array.isArray(input.uri) ? input.uri : [input.uri])
        .map((uri) => uri.trim())
        .filter(Boolean);
      if (!uris.length) {
        clearStationLaunchLock();
        return { uri: null, dj: null };
      }

      if (!isConnectedRef.current || activeProviderRef.current !== "spotify") {
        clearStationLaunchLock();
        return { uri: null, dj: null };
      }

      try {
        const orchestrator = await ensureOrchestrator();
        if (!orchestrator) {
          clearStationLaunchLock();
          return { uri: null, dj: null };
        }

        // Drop sticky monitor debounce so the new URI can register cleanly.
        registeredTrackIdRef.current = null;
        nearEndUriRef.current = null;
        endedUriRef.current = null;
        // Explicit play clears pause intent so visibility guards cannot
        // immediately re-pause a fresh station launch.
        uiPausedIntentRef.current = false;
        // Suppress deck UI flashes until Spotify confirms uris[0].
        beginStationLaunchLock(uris);

        // Manual launches only — never on automated queue advances.
        if (input.flushSession) {
          orchestrator.flushForStationLaunch();
        }

        const played = input.steerCorrection
          ? await orchestrator.steerToStationUri(uris)
          : await orchestrator.playTrack(uris);
        if (played === "NO_ACTIVE_DEVICE") {
          setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
          clearStationLaunchLock();
          return { uri: null, dj: null };
        }
        if (!played) {
          clearStationLaunchLock();
          return { uri: null, dj: null };
        }

        // Mode B speech: Track B may be loaded but must stay frozen at 0:00.
        if (orchestrator.isModeBTransportHold()) {
          await orchestrator.holdModeBCompanionPlayhead();
        }

        const firstUri = uris[0]!;
        const spotifyTrackId = normalizeSpotifyTrackId(firstUri);
        const launchSeed = input.seed
          ? seedWithNormalizedTrackId(
              { ...input.seed, spotifyUri: firstUri },
              firstUri,
            )
          : spotifyTrackId
            ? {
                trackId: spotifyTrackId,
                title: "",
                artist: "",
                spotifyUri: firstUri,
              }
            : null;

        if (launchSeed?.title && launchSeed.artist) {
          setCompanionNowPlaying({
            title: launchSeed.title,
            artist: launchSeed.artist,
            album: launchSeed.album,
            uri: firstUri,
            youtubeId: input.seed?.trackId,
          });
        }
        const modeBHold = orchestrator.isModeBTransportHold();
        applyTransportSampleRef.current({
          trackId: spotifyTrackId || "",
          positionMs: 0,
          durationMs: 0,
          playing: !modeBHold,
        });

        let dj: RunDjBreakResult | null = null;
        if (input.withDjBreak && input.personaId) {
          // Prefer a coherent launch seed (title+artist+normalized Spotify id).
          // When title/artist are missing, resolveTrackInput falls back to live
          // currently-playing metadata while still carrying the clean trackId.
          const djSeed =
            launchSeed ??
            (spotifyTrackId
              ? {
                  trackId: spotifyTrackId,
                  title: "",
                  artist: "",
                  spotifyUri: firstUri,
                }
              : null);
          if (djSeed?.trackId) {
            registeredTrackIdRef.current = djSeed.trackId;
            dj = await runCompanionDjBreak({
              personaId: input.personaId,
              seed: djSeed,
              scriptContext: input.scriptContext,
            });
          }
        }

        return { uri: firstUri, dj };
      } catch (error) {
        console.error("[LinerLore TRACE ERROR]", error);
        console.warn("[useWebOrchestrator] playTrack failed:", error);
        clearStationLaunchLock();
        return { uri: null, dj: null };
      }
    },
    [
      beginStationLaunchLock,
      clearStationLaunchLock,
      ensureOrchestrator,
      runCompanionDjBreak,
    ],
  );

  /**
   * Rogue-track correction: play a known station URI without flushing the
   * DJ session. Uses {@link playTrack} so launch-lock / device handling match
   * a normal queue play.
   */
  const steerToStationUri = useCallback(
    (uri: string | string[]) =>
      playTrack({ uri, flushSession: false, steerCorrection: true }),
    [playTrack],
  );

  /**
   * Manual station-launch entry — arms the UI lock, flushes prior session
   * state (sessionEpoch + prefetch), then plays. Never use for autopilot
   * queue advances.
   */
  const launchStation = useCallback(
    async (input: {
      uri: string | string[];
      personaId?: PersonaId | string;
      seed?: CompanionTrackSeed | null;
      withDjBreak?: boolean;
      scriptContext?: DjScriptContext;
    }): Promise<{ uri: string | null; dj: RunDjBreakResult | null }> => {
      const uris = (Array.isArray(input.uri) ? input.uri : [input.uri])
        .map((uri) => uri.trim())
        .filter(Boolean);
      beginStationLaunchLock(uris);
      return playTrack({ ...input, flushSession: true });
    },
    [beginStationLaunchLock, playTrack],
  );

  const launchSeededSongRadio = useCallback(
    async (input: {
      seedUri: string;
      recommendationUris?: string[];
      personaId?: PersonaId | string;
      seed?: CompanionTrackSeed | null;
      withDjBreak?: boolean;
      scriptContext?: DjScriptContext;
    }): Promise<{ uri: string | null; dj: RunDjBreakResult | null }> => {
      const seedUri = input.seedUri.trim();
      if (!seedUri) {
        return { uri: null, dj: null };
      }

      const seedId = normalizeSpotifyTrackId(seedUri);
      const recommendations = (input.recommendationUris ?? [])
        .map((uri) => uri.trim())
        .filter(Boolean)
        .filter((uri) => {
          const id = normalizeSpotifyTrackId(uri);
          return !seedId || !id || id !== seedId;
        });

      return launchStation({
        uri: [seedUri, ...recommendations],
        personaId: input.personaId,
        seed: input.seed,
        withDjBreak: input.withDjBreak,
        scriptContext: input.scriptContext,
      });
    },
    [launchStation],
  );

  const launchCompanionTrack = useCallback(
    async (input: {
      personaId: PersonaId | string;
      seed: CompanionTrackSeed;
      withDjBreak?: boolean;
      scriptContext?: DjScriptContext;
      flushSession?: boolean;
    }): Promise<{ uri: string | null; dj: RunDjBreakResult | null }> => {
      const withDjBreak = input.withDjBreak !== false;

      if (!isConnectedRef.current || activeProviderRef.current !== "spotify") {
        // Apple (or disconnected): keep the prior DJ-only launch behavior.
        const normalizedSeed = seedWithNormalizedTrackId(input.seed);
        const dj = withDjBreak
          ? await runCompanionDjBreak({
              personaId: input.personaId,
              seed: normalizedSeed,
              scriptContext: input.scriptContext,
            })
          : null;
        return { uri: null, dj };
      }

      try {
        // Prefer a pre-resolved native URI on the queue row; Search is fallback.
        let uri =
          spotifyUriForQueueTrack({
            spotifyId: input.seed.spotifyId,
            uri: input.seed.spotifyUri,
            id: input.seed.trackId,
          }) ||
          input.seed.spotifyUri?.trim() ||
          null;
        if (!uri) {
          const token = await getValidSpotifyAccessToken();
          if (token) {
            uri = await searchSpotifyTrackUri(
              token,
              input.seed.title,
              input.seed.artist,
            );
          }
        }
        if (!uri) {
          clearStationLaunchLock();
          return { uri: null, dj: null };
        }

        // Normalize seed trackId from the launch URI before play/DJ handoff.
        const launchSeed = seedWithNormalizedTrackId(input.seed, uri);

        return playTrack({
          uri,
          personaId: input.personaId,
          seed: launchSeed,
          withDjBreak,
          scriptContext: input.scriptContext,
          flushSession: input.flushSession,
        });
      } catch (error) {
        console.error("[LinerLore TRACE ERROR]", error);
        console.warn("[useWebOrchestrator] launchCompanionTrack failed:", error);
        clearStationLaunchLock();
        return { uri: null, dj: null };
      }
    },
    [clearStationLaunchLock, playTrack, runCompanionDjBreak],
  );

  const handlePlaybackState = useCallback((state: SpotifyPlaybackState) => {
    // Spotify SDK `player_state_changed` stand-in: while a station handoff is
    // in flight, ignore album art / title / artist (and all other UI) updates
    // unless the incoming event URI matches the launch opener (uris[0]).
    if (isLaunchingStationRef.current) {
      const incomingUri = state.track?.uri;
      if (!matchesLaunchTargetUri(incomingUri)) {
        console.log(
          "[LinerLore TRACE] Ignoring stale Spotify player_state_changed — isLaunchingStation",
          {
            incomingUri: incomingUri ?? null,
            launchTargetUri: launchTargetUriRef.current,
          },
        );
        return;
      }
      // SDK confirmed uris[0] — resume normal UI updates.
      clearStationLaunchLock();
      console.log(
        "[LinerLore TRACE] Launch URI confirmed via player_state_changed",
        { uri: incomingUri },
      );
    }

    // Idle / reconnect ghost play via REST poll stand-in.
    if (
      state.track?.isPlaying
      && !state.isEnded
      && isUiPaused()
    ) {
      console.log(
        "[LinerLore TRACE] REST playback while UI paused — forcing pause",
        { uri: state.track.uri },
      );
      void enforceUiPausedTransport();
      const now = toCompanionNowPlaying(state.track);
      publishActiveTrackState(orchestratorRef.current, {
        id: state.track.id,
        title: state.track.name,
        artist: state.track.artists.join(", "),
        album: state.track.album,
        albumArtUrl: state.track.albumArtUrl,
        durationMs: state.track.durationMs,
        positionMs: state.track.progressMs,
        isPaused: true,
      });
      setCompanionNowPlaying(now);
      applyTransportSampleRef.current({
        trackId: state.track.id?.trim() || "",
        positionMs: state.track.progressMs ?? 0,
        durationMs: state.track.durationMs ?? 0,
        playing: false,
        track: {
          id: state.track.id,
          title: state.track.name,
          artist: state.track.artists.join(", "),
          album: state.track.album,
          albumArtUrl: state.track.albumArtUrl,
          durationMs: state.track.durationMs,
          positionMs: state.track.progressMs,
          isPaused: true,
        },
      });
      return;
    }

    if (state.track) {
      const restOrch = orchestratorRef.current;
      const restTrackId = state.track.id?.trim() || null;
      // Fail-closed: freeze incoming Track B before history / TTS awaits.
      if (
        restOrch?.shouldHoldIncomingTransport(restTrackId)
        && state.track.isPlaying
        && !state.isEnded
      ) {
        void restOrch.freezeIncomingCompanionTransport();
      }
      // Mode B speech: freeze SDK / REST auto-advance so Track B cannot play under the host.
      if (
        restOrch?.isModeBSpeechHold()
        && state.track.isPlaying
        && !state.isEnded
      ) {
        void restOrch.holdModeBCompanionPlayhead();
        if (restTrackId) restOrch.noteActualPlayback(restTrackId);
        if (restTrackId && restTrackId !== startedTrackIdRef.current) {
          startedTrackIdRef.current = restTrackId;
          onTrackStartedRef.current?.({
            spotifyId: state.track.id,
            title: state.track.name,
            artist: state.track.artists.join(", "),
          });
        }
        const now = toCompanionNowPlaying(state.track);
        publishActiveTrackState(restOrch, {
          id: state.track.id,
          title: state.track.name,
          artist: state.track.artists.join(", "),
          album: state.track.album,
          albumArtUrl: state.track.albumArtUrl,
          durationMs: state.track.durationMs,
          positionMs: 0,
          isPaused: true,
        });
        setCompanionNowPlaying(now);
        applyTransportSampleRef.current({
          trackId: restTrackId || "",
          positionMs: 0,
          durationMs: state.track.durationMs ?? 0,
          playing: false,
          track: {
            id: state.track.id,
            title: state.track.name,
            artist: state.track.artists.join(", "),
            album: state.track.album,
            albumArtUrl: state.track.albumArtUrl,
            durationMs: state.track.durationMs,
            positionMs: 0,
            isPaused: true,
          },
        });
        onTrackChangeRef.current?.(now);
        return;
      }

      // A new playing URI means the previous end-guard can release.
      if (
        state.track.isPlaying &&
        state.track.uri !== endedUriRef.current &&
        !state.isEnded
      ) {
        advancingRef.current = false;
      }

      // New trackId registered → reset break/audio locks so Tracks 2+ can fire.
      // Skip while a break is mid-flight so a Spotify id mismatch cannot abort
      // the live Duck–Talk–Swell (seed may use youtubeId; poll uses Spotify id).
      // Also notify UI sync (`onTrackStarted`) for Playlist / Broadcast Log —
      // never bump sessionEpoch or flushForStationLaunch on mid-queue hops.
      const liveTrackId = state.track.id?.trim() || null;
      if (
        liveTrackId &&
        state.track.isPlaying &&
        !state.isEnded
      ) {
        if (liveTrackId !== registeredTrackIdRef.current) {
          if (orchestratorRef.current?.isRunning) {
            orchestratorRef.current.noteActualPlayback(liveTrackId);
          } else {
            registeredTrackIdRef.current = liveTrackId;
            orchestratorRef.current?.registerTrack(liveTrackId);
            setIsDjBreakInProgress(false);
          }
        }
        if (liveTrackId !== startedTrackIdRef.current) {
          startedTrackIdRef.current = liveTrackId;
          onTrackStartedRef.current?.({
            spotifyId: state.track.id,
            title: state.track.name,
            artist: state.track.artists.join(", "),
          });
        }
      }

      const now = toCompanionNowPlaying(state.track);
      const holdUi = restOrch?.isModeBTransportHold() === true;
      publishActiveTrackState(orchestratorRef.current, {
        id: state.track.id,
        title: state.track.name,
        artist: state.track.artists.join(", "),
        album: state.track.album,
        albumArtUrl: state.track.albumArtUrl,
        durationMs: state.track.durationMs,
        positionMs: holdUi ? 0 : state.track.progressMs,
        isPaused: holdUi || !state.track.isPlaying || state.isEnded,
      });
      setCompanionNowPlaying(now);
      applyTransportSampleRef.current({
        trackId: state.track.id?.trim() || "",
        positionMs: holdUi ? 0 : state.track.progressMs ?? 0,
        durationMs: state.track.durationMs ?? 0,
        playing: !holdUi && Boolean(state.track.isPlaying) && !state.isEnded,
        track: {
          id: state.track.id,
          title: state.track.name,
          artist: state.track.artists.join(", "),
          album: state.track.album,
          albumArtUrl: state.track.albumArtUrl,
          durationMs: state.track.durationMs,
          positionMs: holdUi ? 0 : state.track.progressMs,
          isPaused: holdUi || !state.track.isPlaying || state.isEnded,
        },
      });
      onTrackChangeRef.current?.(now);
    } else {
      stopPlayheadClock();
      playheadSampleRef.current = null;
      setCompanionPlayback(null);
    }

    if (!state.track) return;

    // Prefetch window (30s / `PREFETCH_LOOKAHEAD_SECONDS`): warm the next track's DJ lore once per URI.
    if (state.isNearEnd && nearEndUriRef.current !== state.track.uri) {
      nearEndUriRef.current = state.track.uri;
      onNearEndRef.current?.();
    }

    const progressSec =
      typeof state.track.progressMs === "number"
        ? state.track.progressMs / 1000
        : Number.NaN;
    const durationSec =
      typeof state.track.durationMs === "number"
        ? state.track.durationMs / 1000
        : Number.NaN;
    const remainingSec =
      state.remainingMs != null && Number.isFinite(state.remainingMs)
        ? state.remainingMs / 1000
        : Number.isFinite(durationSec) && Number.isFinite(progressSec)
          ? Math.max(0, durationSec - progressSec)
          : Number.NaN;
    console.log("[TELEMETRY: DJ Timing Check]", {
      trackId: state.track.uri || (
        state.track.id ? `spotify:track:${state.track.id}` : undefined
      ),
      position: progressSec,
      duration: durationSec,
      remaining: remainingSec,
      shouldTrigger: state.isNearEnd,
      driver: "spotify",
    });

    // Completion: once per URI. Only push the station queue when Spotify has
    // nothing left to auto-play (single-URI / drained launch). Mid-queue hops
    // keep using registerTrack for Duck–Talk–Swell without re-issuing play().
    // Mode B owns Track B — do not playNextTrack or drop break locks mid-speech.
    if (orchestratorRef.current?.isModeBTransportHold()) return;
    if (!state.isEnded) return;
    const endedTrack = state.track;
    if (!endedTrack) return;
    if (endedUriRef.current === endedTrack.uri) return;
    if (advancingRef.current) return;

    endedUriRef.current = endedTrack.uri;
    advancingRef.current = true;

    // Track ended → drop sticky break locks so the next song's Duck–Talk–Swell
    // is not blocked by a hung Track-1 TTS / volume-ramp promise.
    orchestratorRef.current?.releaseBreakLocks();
    setIsDjBreakInProgress(false);

    const endedMeta = {
      spotifyId: endedTrack.id,
      title: endedTrack.name,
      artist: endedTrack.artists.join(", "),
    };
    const endedUri = endedTrack.uri;
    const endedTitle = endedTrack.name;

    void (async () => {
      try {
        const token = await getValidSpotifyAccessToken();
        if (token) {
          const liveQueue = await getSpotifyPlayerQueue(token).catch(() => null);
          if (liveQueue?.queue?.length) {
            console.log(
              "[LinerLore TRACE] Track ended — Spotify still has queue; waiting for SDK advance",
              {
                uri: endedUri,
                upcoming: liveQueue.queue.length,
              },
            );
            // Allow a later drained-queue end to fire for this URI family.
            advancingRef.current = false;
            return;
          }
        }
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }

      console.log("[LinerLore TRACE] Autopilot track ended — playNextTrack", {
        uri: endedUri,
        title: endedTitle,
      });
      onTrackEndedRef.current?.(endedMeta);
    })();
  }, [
    clearStationLaunchLock,
    matchesLaunchTargetUri,
    isUiPaused,
    enforceUiPausedTransport,
    stopPlayheadClock,
  ]);

  const startSpotifyPlaybackMonitor = useCallback(
    (handlers: {
      onNearEnd?: () => void;
      onTrackStarted?: (playing: {
        spotifyId?: string | null;
        title?: string;
        artist?: string;
      }) => void;
      onTrackEnded: (ended?: {
        spotifyId?: string | null;
        title?: string;
        artist?: string;
      }) => void;
      onTrackChange?: (track: CompanionNowPlaying) => void;
    }) => {
      stopSpotifyPlaybackMonitor();

      if (activeProviderRef.current !== "spotify" || !isConnectedRef.current) {
        return;
      }

      onNearEndRef.current = handlers.onNearEnd ?? null;
      onTrackStartedRef.current = handlers.onTrackStarted ?? null;
      onTrackEndedRef.current = handlers.onTrackEnded;
      onTrackChangeRef.current = handlers.onTrackChange ?? null;

      // Single progress driver: when the Web Playback SDK listener is live,
      // or local playhead interpolation is filling SDK gaps, skip the 2000ms
      // REST poll so DJ timing telemetry is not duplicated.
      if (
        (spotifySdkPlayerRef.current && spotifySdkReadyDeviceRef.current) ||
        playheadInterpolationActiveRef.current
      ) {
        console.log(
          "[LinerLore TRACE] SDK player_state_changed is the progress driver — REST poll suppressed",
        );
        return;
      }

      const subscription = subscribeSpotifyPlaybackState(
        getValidSpotifyAccessToken,
        handlePlaybackState,
        { intervalMs: 2000, nearEndMs: COMPANION_PREFETCH_NEAR_END_MS },
      );
      playbackStopRef.current = subscription.stop;
    },
    [handlePlaybackState, stopSpotifyPlaybackMonitor],
  );

  return {
    companionActive: Boolean(isConnected && activeProvider),
    isDjBreakInProgress,
    status,
    breakTransitionPolicy,
    companionNotice,
    dismissCompanionNotice,
    companionNowPlaying,
    companionPlayback,
    spotifyRemote,
    setVolume,
    playTrack,
    steerToStationUri,
    launchStation,
    launchSeededSongRadio,
    launchCompanionTrack,
    runCompanionDjBreak,
    prefetchCompanionDjBreak,
    setCompanionDjMode,
    setCompanionDjPacingFrequency,
    setCompanionDjTuning,
    setCompanionScriptContext,
    loadStudioManifestBreaks,
    willCompanionBreakOnNextTrack,
    triggerBreakNow,
    setCompanionPersona,
    skipActiveBreak,
    resolvePrefetchTarget,
    startSpotifyPlaybackMonitor,
    stopSpotifyPlaybackMonitor,
    isLaunchingStation,
    beginStationLaunchLock,
    clearStationLaunchLock,
    activeScriptText,
    broadcastHistory,
  };
}
