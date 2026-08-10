"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { getPersonaById } from "@/data/personas";
import type { PersonaId } from "@/data/personas";
import {
  attachSpotifyPlayerStateListener,
  createWebOrchestrator,
  spotifyUriForQueueTrack,
  updateCurrentTrackState,
  type ActiveTrackState,
  type BroadcastHistoryEntry,
  type DjMode,
  type DjScriptContext,
  type OrchestratorProvider,
  type OrchestratorStatus,
  type OrchestratorTrackInput,
  type OrchestratorTrackRef,
  type RunDjBreakResult,
  type StudioManifestLoadInput,
  type WebOrchestrator,
} from "@/lib/player/webOrchestrator";

export { spotifyUriForQueueTrack };
export type { StudioManifestLoadInput };
import {
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
  DjKnowledge,
  DjMood,
  DjPersonality,
} from "@/types/dj";

/** Companion near-end window — matches the 30s zero-latency prefetch engine. */
const COMPANION_PREFETCH_NEAR_END_MS = PREFETCH_LOOKAHEAD_SECONDS * 1000;

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

const SPOTIFY_SDK_SCRIPT_URL = "https://sdk.scdn.co/spotify-player.js";

type SpotifyWebPlaybackPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
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
  mode?: string;
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
   */
  playTrack: (input: {
    uri: string | string[];
    personaId?: PersonaId | string;
    seed?: CompanionTrackSeed | null;
    withDjBreak?: boolean;
    scriptContext?: DjScriptContext;
  }) => Promise<{ uri: string | null; dj: RunDjBreakResult | null }>;
  /**
   * Station-launch entry: arms `isLaunchingStation`, then delegates to
   * {@link playTrack}. Prefer this (or `playTrack`) on every station handoff.
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
   * the opening DJ break. Call from every Launch Radio path.
   */
  launchCompanionTrack: (input: {
    personaId: PersonaId | string;
    seed: CompanionTrackSeed;
    /** When false, play the URI without a DJ break (queue advances). Default true. */
    withDjBreak?: boolean;
    scriptContext?: DjScriptContext;
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
   * - `onTrackEnded`: station-queue advance via `playNextTrack()`. Fires when
   *   Spotify finishes a URI and does not auto-advance (single-URI / drained
   *   queue), including background playback stalls.
   * - Track transitions: `player_state_changed` (poll stand-in) calls
   *   `registerTrack(newTrackId)` when Spotify starts the next song so any
   *   scheduled DJ break runs over track N + 1.
   */
  startSpotifyPlaybackMonitor: (handlers: {
    onNearEnd?: () => void;
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
    normalizeSpotifyTrackId(seed.trackId);
  return {
    ...seed,
    trackId: fromUri || seed.trackId.trim(),
    title: seed.title.trim(),
    artist: seed.artist.trim(),
    album: seed.album?.trim() || seed.album,
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
  const { activeProvider, isConnected, djVolume } = useMusicSource();
  const { activePersonaId, allowExplicit, commentaryFormat } = useUserPreferences();
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
  const onTrackChangeRef = useRef<
    ((track: CompanionNowPlaying) => void) | null
  >(null);
  const advancingRef = useRef(false);
  /** Last Spotify track id handed to `registerTrack` (lock-reset debounce). */
  const registeredTrackIdRef = useRef<string | null>(null);
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
  /** Clean Mode preference forwarded into generate-script. */
  const allowExplicitRef = useRef(allowExplicit);
  /** Lore depth preference forwarded into generate-script. */
  const commentaryFormatRef = useRef(commentaryFormat);
  /** Last persona synced into the orchestrator (detect mid-session changes). */
  const syncedPersonaIdRef = useRef<string | null>(null);
  /**
   * Pending shared-studio break cues. Re-applied whenever the orchestrator is
   * (re)created so recipient hydration survives Connect handoff.
   */
  const studioManifestRef = useRef<StudioManifestLoadInput | null>(null);

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
    djVolumeRef.current = djVolume;
    orchestratorRef.current?.setDjVolume(djVolume);
  }, [djVolume]);

  useEffect(() => {
    activePersonaIdRef.current = activePersonaId;
  }, [activePersonaId]);

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

  const breakTransitionPolicy = useMemo(
    () => resolveBreakTransitionPolicy(commentaryFormat),
    [commentaryFormat],
  );

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
    registerSpotifySdkPlayer(null);
    setSpotifyActiveDeviceId(null);
  }, []);

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
            device_id: deviceId,
            getDeviceId: () => spotifySdkReadyDeviceRef.current,
          });

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
            publishActiveTrackState(orchestratorRef.current, track);
            setCompanionNowPlaying({
              title: track.title,
              artist: track.artist,
              album: track.album,
              albumArtUrl: track.albumArtUrl,
              uri: track.id ? `spotify:track:${track.id}` : undefined,
            });
            setCompanionPlayback({
              progressMs: track.positionMs ?? 0,
              durationMs: track.durationMs ?? 0,
              isPlaying: !track.isPaused,
            });
          },
          onTrackEnded: (track: ActiveTrackState) => {
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
      onDjStart: () => {
        setIsDjBreakInProgress(true);
        const live = orchestratorRef.current;
        const script = (live?.activeScriptText || "").trim();
        if (!script) return;
        const latest = live?.broadcastHistory[live.broadcastHistory.length - 1];
        const { title, artist } = parseBroadcastTrackLabel(latest?.track);
        startDjSegment({
          kind: "artist_trivia",
          transition: "full_break",
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
    orchestrator.setPersona(activePersonaIdRef.current);
    orchestrator.setDjVolume(djVolumeRef.current);
    orchestrator.setMasterVolume(masterVolumeRef.current);
    orchestrator.setAllowExplicit(allowExplicitRef.current);
    orchestrator.setCommentaryFormat(commentaryFormatRef.current);
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
      activePersonaIdRef.current = next as PersonaId;
      syncedPersonaIdRef.current = next;
      const orchestrator = orchestratorRef.current;
      if (!orchestrator) return;
      orchestrator.setPersona(next);
      orchestrator.flushPrefetch();
    },
    [],
  );

  // Keep the live orchestrator in sync when UserPreferences changes the host.
  useEffect(() => {
    const next = activePersonaId;
    const previous = syncedPersonaIdRef.current;
    if (previous === next) return;

    syncedPersonaIdRef.current = next;
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;

    orchestrator.setPersona(next);
    // Flush only on a real mid-session switch (not the first stamp).
    if (previous !== null) {
      orchestrator.flushPrefetch();
    }
  }, [activePersonaId]);

  const resolveTrackInput = useCallback(
    async (
      orchestrator: WebOrchestrator,
      personaId: PersonaId | string,
      seed?: CompanionTrackSeed | null,
    ): Promise<OrchestratorTrackInput | null> => {
      const persona = getPersonaById(personaId);
      const voiceId = persona?.elevenLabsVoiceId;
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
          voiceId,
          personaId: persona?.id ?? String(personaId),
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
          personaId: persona?.id ?? String(personaId),
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
    try {
      const orchestrator = await ensureOrchestrator();
      if (!orchestrator) {
        return withSpotifyToken((token) => spotifyResume(token));
      }
      const result = await orchestrator.resume();
      noticeFromPlaybackResult(result);
      return result;
    } catch (err) {
      console.error("[LinerLore TRACE ERROR] resumeRemote", err);
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
      return await orchestrator.togglePlay();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR] togglePlayRemote", err);
      return "failed";
    }
  }, [ensureOrchestrator]);

  const pauseRemote = useCallback(
    () => withSpotifyToken((token) => spotifyPause(token)),
    [withSpotifyToken],
  );
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
      setCompanionPlayback((prev) =>
        prev ? { ...prev, progressMs: ms } : prev,
      );
      return withSpotifyToken((token) => spotifySeek(token, ms));
    },
    [withSpotifyToken],
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
   */
  const playTrack = useCallback(
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
        // Suppress deck UI flashes until Spotify confirms uris[0].
        beginStationLaunchLock(uris);

        // playTrack flushes active/prefetched audio + track identity first.
        const played = await orchestrator.playTrack(uris);
        if (played === "NO_ACTIVE_DEVICE") {
          setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
          clearStationLaunchLock();
          return { uri: null, dj: null };
        }
        if (!played) {
          clearStationLaunchLock();
          return { uri: null, dj: null };
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
        setCompanionPlayback((prev) => ({
          progressMs: 0,
          durationMs: prev?.durationMs ?? 0,
          isPlaying: true,
        }));

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
   * Station-launch entry used by handoff paths — arms the UI lock, then
   * delegates to {@link playTrack} (same flush semantics as the orchestrator
   * `launchStation` helper).
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
      return playTrack(input);
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
        // Prefer a pre-resolved URI; otherwise search Spotify catalog once,
        // then hand off to playTrack (never double-issue play).
        let uri = input.seed.spotifyUri?.trim() || null;
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

    if (state.track) {
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
      const liveTrackId = state.track.id?.trim() || null;
      if (
        liveTrackId &&
        liveTrackId !== registeredTrackIdRef.current &&
        state.track.isPlaying &&
        !state.isEnded &&
        !orchestratorRef.current?.isRunning
      ) {
        registeredTrackIdRef.current = liveTrackId;
        orchestratorRef.current?.registerTrack(liveTrackId);
        setIsDjBreakInProgress(false);
      }

      const now = toCompanionNowPlaying(state.track);
      publishActiveTrackState(orchestratorRef.current, {
        id: state.track.id,
        title: state.track.name,
        artist: state.track.artists.join(", "),
        album: state.track.album,
        albumArtUrl: state.track.albumArtUrl,
        durationMs: state.track.durationMs,
        positionMs: state.track.progressMs,
        isPaused: !state.track.isPlaying || state.isEnded,
      });
      setCompanionNowPlaying(now);
      setCompanionPlayback({
        progressMs: state.track.progressMs ?? 0,
        durationMs: state.track.durationMs ?? 0,
        isPlaying: Boolean(state.track.isPlaying) && !state.isEnded,
      });
      onTrackChangeRef.current?.(now);
    } else {
      setCompanionPlayback(null);
    }

    if (!state.track) return;

    // Prefetch window (~15s): warm the next track's DJ lore once per URI.
    if (state.isNearEnd && nearEndUriRef.current !== state.track.uri) {
      nearEndUriRef.current = state.track.uri;
      onNearEndRef.current?.();
    }

    // Completion: once per URI. Only push the station queue when Spotify has
    // nothing left to auto-play (single-URI / drained launch). Mid-queue hops
    // keep using registerTrack for Duck–Talk–Swell without re-issuing play().
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
  }, [clearStationLaunchLock, matchesLaunchTargetUri]);

  const startSpotifyPlaybackMonitor = useCallback(
    (handlers: {
      onNearEnd?: () => void;
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
      onTrackEndedRef.current = handlers.onTrackEnded;
      onTrackChangeRef.current = handlers.onTrackChange ?? null;

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
