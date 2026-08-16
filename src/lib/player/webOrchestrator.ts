/**
 * Companion-stream DJ break orchestrator.
 *
 * Canonical FSM + dual-mode routing per `docs/AUDIO_ORCHESTRATION_SPEC.md`:
 * - Probe TTS `duration` before any transition.
 * - **Mode A** (`duration <= 15s`): duck → speak in-band → logarithmic swell.
 * - **Mode B** (`duration > 15s`): fade to station bed → speak → hard-launch.
 *
 * UI consumers still see {@link OrchestratorStatus}; the internal
 * {@link BroadcastState} is the source of truth for mutex / epoch locking.
 *
 * Volume is routed through the universal {@link WebOrchestrator.getCurrentVolume} /
 * {@link WebOrchestrator.setVolume} transport abstraction.
 */

import {
  getAppleMusicKit,
  getCurrentlyPlayingAppleMusic,
  pauseAppleMusic,
  resumeAppleMusic,
} from "@/lib/player/appleMusicRemote";
import {
  DUCK_RATIO,
  GAIN_SMOOTH_TIME_CONSTANT,
  getMasterAnalyser,
  rampSpeechGainFromSilence,
  setGainSmooth,
  SPEECH_BASELINE_GAIN,
  voiceGain,
} from "@/lib/audio/mix-bus";
import {
  getSharedDjBreakPrefetchEngine,
  PREFETCH_LOOKAHEAD_SECONDS,
  resolveBreakTransitionPolicy,
  STANDARD_BREAK_DUCK_RATIO,
  type BreakTransitionPolicy,
} from "@/lib/dj/prefetchEngine";
import { readPersistedSessionQueue } from "@/lib/queue/session-persistence";
import {
  getStationLaunchLiner,
  shouldPauseForStationLaunchVocals,
} from "@/lib/dj/scriptGenerator";
import { SPEECH_END_TAIL_MS } from "@/lib/volume-ramp";
import { getPersonaById } from "@/data/personas";
import {
  getPersonaForStation,
  resolveActiveHost,
  resolveMilesOrDevonVoiceId,
  resolveSessionVoiceId,
  type StationPersonaInput,
} from "@/lib/dj/personaConfig";
import {
  clampSpotifyVolumeNormalized,
  getCurrentlyPlaying,
  getCurrentSpotifyVolume,
  getSpotifySdkPlayer,
  getValidSpotifyAccessToken,
  isNoActiveDeviceResult,
  lerpSpotifyVolumeLog,
  next as spotifyNext,
  normalizeSpotifyTrackId,
  pauseSpotifyPlayback,
  play as playSpotify,
  previous as spotifyPrevious,
  rampSpotifyVolume,
  resumeSpotifyPlayback,
  searchSpotifyTrackUri,
  setSpotifyVolume,
  toSpotifyRestVolumePercent,
  type SpotifyNoActiveDevice,
  type SpotifyPlaybackResult,
  type SpotifyTrack,
} from "@/lib/player/spotifyRemote";
import {
  DEFAULT_COMMENTARY_FORMAT,
  DEFAULT_DJ_TUNING,
  resolveCommentaryFormat,
  type CommentaryFormat,
  type DjKnowledge,
  type DjMode,
  type DjMood,
  type DjPersonality,
} from "@/types/dj";

/** Explicit Miles ElevenLabs voice — never shares a fallback with Devon or Johnny. */
const milesVoiceId =
  process.env.ELEVENLABS_VOICE_MILES || "gyIv9PAQRvJjSZlk68oE";

/** Explicit Devon ElevenLabs voice — never shares a fallback with Miles or Johnny. */
const devonVoiceId =
  process.env.ELEVENLABS_VOICE_DEVON || "2ajXGJNYBR0iNHpS4VZb";

/**
 * Resolve a persona to its ElevenLabs voice with strict Miles/Devon isolation.
 * Logs `[Voice Resolution]` for every mapped host voice.
 * Free Mode must never call this — use {@link resolveActiveHost} instead.
 */
function resolveOrchestratorVoiceId(personaId: string): string | undefined {
  const key = personaId.trim().toLowerCase();
  if (key === "miles") {
    console.log("[Voice Resolution]", {
      personaId: key,
      resolvedVoiceId: milesVoiceId,
    });
    return milesVoiceId;
  }
  if (key === "devon" || key === "devon-pulse") {
    console.log("[Voice Resolution]", {
      personaId: key,
      resolvedVoiceId: devonVoiceId,
    });
    return devonVoiceId;
  }
  // Prefer shared isolation helper (same IDs) before general session resolution.
  return resolveMilesOrDevonVoiceId(key) ?? resolveSessionVoiceId(personaId);
}

/**
 * Resolve the TTS voice id for the active subscription tier.
 * Free → OpenAI Sam/Maya/Alex voices only (never ElevenLabs).
 * Pro → ElevenLabs host voice map.
 */
function resolveTierAwareVoiceId(
  personaId: string,
  isPro: boolean,
): string | undefined {
  const host = resolveActiveHost(personaId, isPro);
  if (!isPro) {
    console.log("[Voice Resolution]", {
      personaId: String(personaId).trim().toLowerCase(),
      effectivePersona: host.personaId,
      displayName: host.displayName,
      resolvedVoiceId: host.voiceId,
      tier: "free",
    });
    return host.voiceId;
  }
  return host.voiceId || resolveOrchestratorVoiceId(host.personaId);
}

export type { CommentaryFormat, DjMode, DjKnowledge, DjMood, DjPersonality };

export type OrchestratorProvider = "spotify" | "apple_music";

/**
 * Provider-agnostic companion track shape used after MusicKit / Spotify
 * payloads are normalized for DJ scripting and UI handoff.
 */
export type NormalizedMusicTrack = {
  id: string;
  title: string;
  artist: string;
  albumArt?: string;
  durationMs?: number;
  uri: string;
  album?: string;
  isPlaying?: boolean;
};

/** Loose MusicKit MediaItem fields used for normalization. */
type MusicKitMediaItemLike = {
  id?: string;
  title?: string;
  artistName?: string;
  albumName?: string;
  artworkURL?: string;
  artwork?: { url?: string };
  playbackDuration?: number;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    artwork?: { url?: string };
  };
};

/**
 * Normalize a MusicKit `MediaItem` into the shared companion track interface.
 */
export function normalizeMusicKitMediaItem(
  item: MusicKitMediaItemLike | null | undefined,
): NormalizedMusicTrack | null {
  if (!item) return null;

  const attrs = item.attributes;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const title = (attrs?.name ?? item.title ?? "").trim();
  const artist = (attrs?.artistName ?? item.artistName ?? "").trim();
  if (!id || !title || !artist) return null;

  const artworkTemplate =
    attrs?.artwork?.url ?? item.artworkURL ?? item.artwork?.url;
  const albumArt = artworkTemplate
    ? artworkTemplate.replace("{w}", "300").replace("{h}", "300")
    : undefined;

  const durationRaw = attrs?.durationInMillis ?? item.playbackDuration;
  const durationMs =
    typeof durationRaw === "number" && Number.isFinite(durationRaw)
      ? durationRaw
      : undefined;

  const album = (attrs?.albumName ?? item.albumName ?? "").trim() || undefined;

  return {
    id,
    title,
    artist,
    albumArt,
    durationMs,
    uri: `applemusic:song:${id}`,
    album,
  };
}

/** Map a Spotify currently-playing payload onto {@link NormalizedMusicTrack}. */
export function normalizeSpotifyCompanionTrack(
  track: SpotifyTrack,
): NormalizedMusicTrack {
  return {
    id: track.id,
    title: track.name,
    artist: track.artists.join(", "),
    albumArt: track.albumArtUrl,
    durationMs: track.durationMs,
    uri: track.uri,
    album: track.album,
    isPlaying: track.isPlaying,
  };
}

/**
 * Deck / MediaSession now-playing snapshot. Updated from the Web Playback SDK
 * `player_state_changed` listener and from station-queue openers so the UI can
 * show title/artist before the first SDK event arrives.
 */
export type ActiveTrackState = {
  id?: string | null;
  title: string;
  artist: string;
  album?: string;
  albumArtUrl?: string;
  durationMs?: number;
  positionMs?: number;
  isPaused?: boolean;
};

/** Loose Spotify Web Playback SDK track object inside track_window. */
export type SpotifyPlayerTrackWindowItem = {
  id: string | null;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url?: string }>;
  };
};

/** Loose Spotify Web Playback SDK player_state_changed payload. */
export type SpotifyPlayerStateChangedPayload = {
  paused: boolean;
  duration: number;
  position: number;
  track_window?: {
    current_track?: SpotifyPlayerTrackWindowItem | null;
    previous_tracks?: SpotifyPlayerTrackWindowItem[];
  } | null;
};

type SpotifyPlayerStateListenerHost = {
  addListener: (
    event: "player_state_changed",
    callback: (state: SpotifyPlayerStateChangedPayload | null) => void,
  ) => void;
  /** Optional SDK pause used when UI is paused but reconnect auto-resumes. */
  pause?: () => Promise<void> | void;
};

/** Near-end / completion window for SDK duration checks (ms). */
const SDK_TRACK_END_EPSILON_MS = 500;

/**
 * @deprecated Prefer {@link DEFAULT_INTRO_DURATION_SEC} +
 * {@link resolveDjBreakExecutionScenario}. Kept for older call sites that still
 * treat a fixed 5s window as "instrumental intro".
 */
export const DJ_VOCAL_SAFE_INTRO_MS = 5_000;

/** Fallback instrumental intro when a track omits `introDuration` (seconds). */
export const DEFAULT_INTRO_DURATION_SEC = 6;

/**
 * Intros shorter than this are treated as cold vocal starts — hard-pause only
 * (Scenario C), never ride the host over the downbeat.
 */
export const COLD_VOCAL_INTRO_THRESHOLD_SEC = 3;

/**
 * Scenario A swell: ducked bed (0.18) → full (1.0) after speech `ended`.
 * Distinct from {@link SPOTIFY_RESTORE_RAMP_MS} used by outro / extended paths.
 * Mood overrides: Chill 1200ms, Hyped 400ms (see {@link resolveModeASwellMs}).
 */
export const INTRO_RAMP_RESTORE_MS = 800;

/** Mode A / Mode B speech-duration threshold (seconds). */
export const MODE_A_DURATION_THRESHOLD_SEC = 15.0;

/** Mode A linear duck ramp (outgoing track → duck floor). */
export const MODE_A_DUCK_RAMP_MS = 600;

/** Mode A duck floors by Host Settings mood. */
export const MODE_A_DUCK_RATIO_DEFAULT = 0.18;
export const MODE_A_DUCK_RATIO_CHILL = 0.12;
export const MODE_A_DUCK_RATIO_HYPED = 0.25;

/** Mode A swell windows by mood (logarithmic). */
export const MODE_A_SWELL_MS_DEFAULT = 800;
export const MODE_A_SWELL_MS_CHILL = 1200;
export const MODE_A_SWELL_MS_HYPED = 400;

/** Mode B: fade outgoing track fully out, then hold a station bed under speech. */
export const MODE_B_FADE_MS = 1500;
export const MODE_B_BED_GAIN = 0.25;
export const MODE_B_BED_DECAY_MS = 400;

/** Optimistic DJ-length estimate when metadata probe is unavailable (seconds). */
export const FALLBACK_DJ_AUDIO_DURATION_SEC = 5;

/**
 * Canonical broadcast FSM (see `docs/AUDIO_ORCHESTRATION_SPEC.md`).
 * Mapped to {@link OrchestratorStatus} for UI consumers.
 */
export type BroadcastState =
  | "IDLE"
  | "PLAYING_MUSIC"
  | "PREFETCHING_BREAK"
  | "MODE_A_DUCKING"
  | "MODE_A_SPEAKING"
  | "MODE_A_SWELLING"
  | "MODE_B_BED_FADE"
  | "MODE_B_SPEAKING"
  | "MODE_B_LAUNCH";

/** Mood-aware Mode A duck ratio (default 0.18 / Chill 0.12 / Hyped 0.25). */
export function resolveModeADuckRatio(mood: DjMood): number {
  if (mood === "chill") return MODE_A_DUCK_RATIO_CHILL;
  if (mood === "hyped") return MODE_A_DUCK_RATIO_HYPED;
  return MODE_A_DUCK_RATIO_DEFAULT;
}

/** Mood-aware Mode A swell duration (default 800 / Chill 1200 / Hyped 400). */
export function resolveModeASwellMs(mood: DjMood): number {
  if (mood === "chill") return MODE_A_SWELL_MS_CHILL;
  if (mood === "hyped") return MODE_A_SWELL_MS_HYPED;
  return MODE_A_SWELL_MS_DEFAULT;
}

/** Linear amplitude lerp for Mode A duck ramps. */
export function lerpVolumeLinear(
  from: number,
  to: number,
  t: number,
): number {
  const clampedT = Math.min(1, Math.max(0, t));
  return from + (to - from) * clampedT;
}

/** Default DJ HTML5 Audio element gain (0–1) when nothing is persisted. */
export const DEFAULT_DJ_VOICE_VOLUME = 0.85;

/**
 * Read persisted DJ voice gain. Prefers `songhost_dj_volume` (spec key), then
 * the canonical `songghost_dj_volume`, falling back to {@link DEFAULT_DJ_VOICE_VOLUME}.
 */
export function readPersistedDjVolume(
  fallback: number = DEFAULT_DJ_VOICE_VOLUME,
): number {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const keys = ["songhost_dj_volume", "songghost_dj_volume"] as const;
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed)) continue;
      return Math.min(1, Math.max(0, parsed));
    }
  } catch {
    // private mode / blocked storage
  }
  return fallback;
}

/** How music + host are staged for a single break. */
export type DjBreakExecutionScenario = "intro_ramp" | "outro_duck" | "hard_pause";

/**
 * Resolve a track's instrumental intro length in seconds.
 * Invalid / missing values fall back to {@link DEFAULT_INTRO_DURATION_SEC}.
 */
export function resolveIntroDurationSec(track?: {
  introDuration?: number | null;
} | null): number {
  const value = track?.introDuration;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return DEFAULT_INTRO_DURATION_SEC;
}

/**
 * Choose intro-ramp / outro-duck / hard-pause for a voiced break.
 *
 * - Scenario C when the intro is a cold vocal start, or the DJ clip is longer
 *   than the instrumental intro.
 * - Scenario B when the caller reports remaining instrumental bed on the
 *   outgoing (or still-playing) track.
 * - Scenario A otherwise — duck under the incoming intro and swell on `ended`.
 */
export function resolveDjBreakExecutionScenario(input: {
  introDurationSec: number;
  djAudioDurationSec: number;
  /** Seconds of instrumental bed left under the host, when known. */
  remainingInstrumentalSec?: number | null;
}): DjBreakExecutionScenario {
  const introDurationSec = Number.isFinite(input.introDurationSec)
    ? Math.max(0, input.introDurationSec)
    : DEFAULT_INTRO_DURATION_SEC;
  const djAudioDurationSec = Number.isFinite(input.djAudioDurationSec)
    ? Math.max(0, input.djAudioDurationSec)
    : FALLBACK_DJ_AUDIO_DURATION_SEC;

  if (
    introDurationSec < COLD_VOCAL_INTRO_THRESHOLD_SEC
    || djAudioDurationSec > introDurationSec
  ) {
    return "hard_pause";
  }

  const remaining = input.remainingInstrumentalSec;
  if (
    typeof remaining === "number"
    && Number.isFinite(remaining)
    && remaining > 0
  ) {
    return "outro_duck";
  }

  return "intro_ramp";
}

/**
 * Probe HTML5 audio duration for a URL or in-memory blob (seconds).
 * Returns null when metadata is unavailable — callers should fall back.
 */
export async function probeAudioDurationSeconds(
  source: string | Blob,
  signal?: AbortSignal,
): Promise<number | null> {
  if (typeof Audio === "undefined") return null;
  if (signal?.aborted) return null;

  const objectUrl =
    typeof source === "string" ? null : URL.createObjectURL(source);
  const src = typeof source === "string" ? source : objectUrl!;

  try {
    const audio = new Audio();
    audio.preload = "metadata";

    const duration = await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        audio.onloadedmetadata = null;
        audio.onerror = null;
        resolve(value);
      };

      audio.onloadedmetadata = () => {
        const value = audio.duration;
        finish(Number.isFinite(value) && value > 0 ? value : null);
      };
      audio.onerror = () => finish(null);

      if (signal) {
        signal.addEventListener("abort", () => finish(null), { once: true });
      }

      audio.src = src;
    });

    return duration;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * True when the Web Playback SDK reports a finished track that did not
 * auto-advance — the classic stall signal for single-URI / drained queues:
 * `position === 0 && paused && previous_tracks.length > 0` with the finished
 * track still sitting in `current_track`, or position at/near duration.
 */
export function isSpotifySdkTrackEnded(
  state: SpotifyPlayerStateChangedPayload,
): boolean {
  const previousTracks = state.track_window?.previous_tracks ?? [];
  const current = state.track_window?.current_track;
  if (!current) return false;

  const finishedByDuration =
    state.duration > 0 &&
    state.position > 0 &&
    state.position >= state.duration - SDK_TRACK_END_EPSILON_MS &&
    state.paused;

  if (finishedByDuration) return true;

  if (!state.paused || state.position !== 0 || previousTracks.length === 0) {
    return false;
  }

  // Stalled on the finished item (current still equals the last previous).
  // When Spotify already advanced, current differs from previous[last].
  const prev = previousTracks[previousTracks.length - 1];
  if (!prev) return false;
  if (prev.id && current.id) return prev.id === current.id;
  return (
    prev.name === current.name &&
    (prev.artists[0]?.name ?? "") === (current.artists[0]?.name ?? "")
  );
}

let sharedCurrentTrackState: ActiveTrackState | null = null;
const currentTrackStateListeners = new Set<() => void>();

function emitCurrentTrackState(): void {
  for (const listener of currentTrackStateListeners) listener();
}

function setSharedCurrentTrackState(
  activeTrack: ActiveTrackState | null,
): void {
  sharedCurrentTrackState = activeTrack;
  emitCurrentTrackState();
}

/** Subscribe to {@link getCurrentTrackState} updates (for `useSyncExternalStore`). */
export function subscribeCurrentTrackState(listener: () => void): () => void {
  currentTrackStateListeners.add(listener);
  return () => {
    currentTrackStateListeners.delete(listener);
  };
}

/** Latest UI now-playing snapshot (null when idle / torn down). */
export function getCurrentTrackState(): ActiveTrackState | null {
  return sharedCurrentTrackState;
}

/**
 * Stamp the shared UI now-playing track. Safe to call from queue init before
 * any Web Playback SDK event has fired.
 */
export function updateCurrentTrackState(
  activeTrack: ActiveTrackState | null,
): void {
  setSharedCurrentTrackState(activeTrack);
}

/**
 * Wire Spotify Web Playback SDK `player_state_changed` → shared UI track state.
 * Optional `shouldApply` / `onTrack` hooks let the React glue layer enforce
 * station-launch locks and mirror into local companion state.
 *
 * `onTrackStarted` fires when `rawTrack.id` changes while playback is active
 * (multi-URI auto-advance) so the station queue cursor / Broadcast Log can
 * sync without bumping `sessionEpoch` or re-issuing `play()`. When the
 * playing URI is not in the station queue (`syncIndexToPlayingTrack` → `-1`),
 * the page MUST call {@link WebOrchestrator.steerToStationUri} /
 * {@link WebOrchestrator.playTrack} for the intended station item — never
 * prepend the rogue track into React queue state.
 *
 * `onTrackEnded` fires once per finished track when the SDK stalls after a
 * song completes (empty Spotify queue / single-URI play) so Autopilot can
 * invoke `playNextTrack()` and keep the station queue moving.
 *
 * Rebinds DJ timing telemetry to the Spotify URI whenever the SDK is the
 * active playback driver (replacing any residual YouTube / HTML5 track ids).
 */
export function attachSpotifyPlayerStateListener(
  player: SpotifyPlayerStateListenerHost,
  options?: {
    shouldApply?: (track: ActiveTrackState) => boolean;
    onTrack?: (track: ActiveTrackState) => void;
    onTrackStarted?: (track: ActiveTrackState, prevId: string | null) => void;
    onTrackEnded?: (track: ActiveTrackState) => void;
    /**
     * React / orchestrator UI paused intent. When true, an unexpected
     * `state.paused === false` (tab idle recovery / SDK WebSocket reconnect)
     * MUST force an immediate pause and must not treat the event as playback.
     */
    isUiPaused?: () => boolean;
    /** Optional hook-side pause (SDK + REST + speech teardown). */
    forcePause?: () => void;
  },
): void {
  let lastEndedKey: string | null = null;
  let lastTrackId: string | null = null;

  player.addListener("player_state_changed", (state) => {
    if (!state || !state.track_window) return;
    const rawTrack = state.track_window.current_track;
    if (!rawTrack) return;

    // Background-tab / SDK reconnect ghost play: UI is paused but SDK resumed.
    if (!state.paused && options?.isUiPaused?.()) {
      console.log(
        "[LinerLore TRACE] SDK playing while UI paused — forcing pause",
        { trackId: rawTrack.id, title: rawTrack.name },
      );
      try {
        void player.pause?.();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
      options.forcePause?.();

      const forcedPausedTrack: ActiveTrackState = {
        id: rawTrack.id,
        title: rawTrack.name,
        artist: rawTrack.artists.map((a) => a.name).join(", "),
        album: rawTrack.album.name,
        albumArtUrl: rawTrack.album.images[0]?.url,
        durationMs: state.duration,
        positionMs: state.position,
        isPaused: true,
      };
      if (options?.shouldApply && !options.shouldApply(forcedPausedTrack)) {
        return;
      }
      setSharedCurrentTrackState(forcedPausedTrack);
      options?.onTrack?.(forcedPausedTrack);
      return;
    }

    const spotifyUri =
      rawTrack.id?.trim()
        ? `spotify:track:${rawTrack.id.trim()}`
        : undefined;
    const positionSec =
      typeof state.position === "number" && Number.isFinite(state.position)
        ? state.position / 1000
        : Number.NaN;
    const durationSec =
      typeof state.duration === "number" && Number.isFinite(state.duration)
        ? state.duration / 1000
        : Number.NaN;
    const remaining =
      Number.isFinite(durationSec) && Number.isFinite(positionSec)
        ? Math.max(0, durationSec - positionSec)
        : Number.NaN;
    console.log("[TELEMETRY: DJ Timing Check]", {
      trackId: spotifyUri,
      position: positionSec,
      duration: durationSec,
      remaining,
      shouldTrigger:
        Number.isFinite(remaining) && remaining <= PREFETCH_LOOKAHEAD_SECONDS,
      driver: "spotify",
    });

    const activeTrack: ActiveTrackState = {
      id: rawTrack.id,
      title: rawTrack.name,
      artist: rawTrack.artists.map((a) => a.name).join(", "),
      album: rawTrack.album.name,
      albumArtUrl: rawTrack.album.images[0]?.url,
      durationMs: state.duration,
      positionMs: state.position,
      isPaused: state.paused,
    };

    // A live playhead clears the end-guard so the same URI can end again later.
    if (!state.paused && state.position > SDK_TRACK_END_EPSILON_MS) {
      lastEndedKey = null;
    }

    if (options?.shouldApply && !options.shouldApply(activeTrack)) {
      return;
    }

    setSharedCurrentTrackState(activeTrack);
    options?.onTrack?.(activeTrack);

    const incomingId = rawTrack.id?.trim() || null;
    if (
      incomingId &&
      incomingId !== lastTrackId &&
      !state.paused
    ) {
      const prevId = lastTrackId;
      lastTrackId = incomingId;
      options?.onTrackStarted?.(activeTrack, prevId);
    }

    if (!options?.onTrackEnded || !isSpotifySdkTrackEnded(state)) return;

    const endedKey =
      rawTrack.id?.trim() ||
      `${rawTrack.name}\0${rawTrack.artists.map((a) => a.name).join(",")}`;
    if (lastEndedKey === endedKey) return;
    lastEndedKey = endedKey;

    console.log(
      "[LinerLore TRACE] Spotify SDK track ended — requesting queue advance",
      { trackId: rawTrack.id, title: rawTrack.name },
    );
    options.onTrackEnded(activeTrack);
  });
}

export type OrchestratorTrackInput = {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  /**
   * Instrumental intro length in seconds. Drives
   * {@link resolveDjBreakExecutionScenario}; defaults to
   * {@link DEFAULT_INTRO_DURATION_SEC} when omitted.
   */
  introDuration?: number;
  voiceId: string;
  /** UI host id — preferred by generate-script for roster → voice mapping. */
  personaId?: string;
  mode?: string;
};

/**
 * Prefer a native Spotify catalog id when a station queue track was seeded
 * from Smart Search / Song Radio.
 */
export function spotifyUriForQueueTrack(track: {
  spotifyId?: string | null;
  uri?: string | null;
  id?: string | null;
}): string | null {
  const nativeUri = track.uri?.trim();
  if (nativeUri?.startsWith("spotify:track:")) return nativeUri;

  const spotifyId =
    track.spotifyId?.trim() ||
    normalizeSpotifyTrackId(track.id ?? "") ||
    normalizeSpotifyTrackId(nativeUri ?? "");
  return spotifyId ? `spotify:track:${spotifyId}` : null;
}

/**
 * Next station-queue item to force-play when Spotify SDK Autoplay (or any
 * unrecognized URI) hijacks the stream. Prefers the upcoming slot, then the
 * current playhead.
 */
export function resolveIntendedStationTrack<T>(
  queue: readonly T[],
  currentIndex: number,
): T | undefined {
  if (!queue.length) return undefined;
  const index = Number.isInteger(currentIndex) ? currentIndex : 0;
  return queue[index + 1] ?? queue[index] ?? queue[0];
}

/** Compact title/artist refs for DJ script history + queue teasers. */
export type OrchestratorTrackRef = {
  title: string;
  artist: string;
  /** Present on live playback history so the current track can be excluded from recaps. */
  trackId?: string;
};

/** Real-time Duck–Talk–Swell lifecycle for UI consumers. */
export type OrchestratorStatus =
  | "STANDBY"
  | "PREFETCHING"
  | "DUCKING"
  | "ON_AIR"
  | "RAMPING_UP";

/** Map internal FSM states onto the legacy UI status enum. */
export function broadcastStateToOrchestratorStatus(
  state: BroadcastState,
): OrchestratorStatus {
  switch (state) {
    case "PREFETCHING_BREAK":
      return "PREFETCHING";
    case "MODE_A_DUCKING":
    case "MODE_B_BED_FADE":
      return "DUCKING";
    case "MODE_A_SPEAKING":
    case "MODE_B_SPEAKING":
      return "ON_AIR";
    case "MODE_A_SWELLING":
    case "MODE_B_LAUNCH":
      return "RAMPING_UP";
    case "IDLE":
    case "PLAYING_MUSIC":
    default:
      return "STANDBY";
  }
}

export type DjScriptContext = {
  /** Last played tracks for multi-song recaps (live Spotify history preferred). */
  recentHistory?: OrchestratorTrackRef[];
  /** Next 1–2 queued tracks for upcoming teasers. */
  upcomingQueue?: OrchestratorTrackRef[];
  /** Live station name for Track #0 fast launch liners. */
  stationName?: string;
};

/**
 * Authored studio break cue loaded from a shared SongHost Studio manifest.
 * Inspected at break resolution time before any dynamic LLM/TTS fetch.
 */
export type StudioBreakCueInput = {
  cuePointSec: number;
  trackIndex?: number;
  kind?: string;
  /** Pre-rendered R2 / CDN audio — play exactly; skip generate-script. */
  audioUrl?: string;
  /** Authored host copy for direct TTS (no persona LLM generation). */
  customText?: string;
  /** Explicit ElevenLabs voice for {@link customText}. */
  voiceId?: string;
  label?: string;
};

export type StudioManifestLoadInput = {
  tracks: Array<{ title: string; artist: string; youtubeId?: string }>;
  djBreaks: StudioBreakCueInput[];
};

export type DjBreakScriptResponse = {
  audioUrl: string;
  script?: string;
  cached?: boolean;
  cost?: number;
};

/** One aired (or prefetched) DJ script entry for Teleprompter / Broadcast Log. */
export type BroadcastHistoryEntry = {
  timestamp: string;
  track: string;
  script: string;
};

export type WebOrchestratorOptions = {
  provider: OrchestratorProvider;
  /** Required when `provider` is `"spotify"`. */
  spotifyAccessToken?: string;
  /**
   * Persisted Host Settings DJ Voice Volume (0–1). Applied to every TTS
   * `AudioBufferSourceNode` speech gain via {@link voiceGain}. Defaults to
   * {@link DEFAULT_DJ_VOICE_VOLUME} only when omitted.
   */
  initialDjVolume?: number;
  /** Optional override for the script endpoint (defaults to `/api/generate-script`). */
  scriptEndpoint?: string;
  /** Fired when Spotify has no active device to duck/resume. */
  onNoActiveDevice?: (status: SpotifyNoActiveDevice) => void;
  /** Fired with the DJ script text when the generate-script response includes it. */
  onScript?: (script: string) => void;
  /** Fired when the DJ clip begins playing. */
  onDjStart?: () => void;
  /** Fired when the DJ clip finishes and music has been asked to swell/resume. */
  onDjEnd?: () => void;
  /** Fired whenever the Duck–Talk–Swell state machine advances. */
  onStatusChange?: (status: OrchestratorStatus) => void;
  /** Fired on unrecoverable orchestration errors. */
  onError?: (error: Error) => void;
};

export type RunDjBreakResult =
  | { ok: true; audioUrl: string; script?: string; cached?: boolean }
  | { ok: false; reason: "NO_ACTIVE_DEVICE" }
  | {
      ok: false;
      reason:
        | "SCRIPT_FAILED"
        | "DUCK_FAILED"
        | "PLAYBACK_FAILED"
        | "SWELL_FAILED"
        | "PAUSE_FAILED"
        | "RESUME_FAILED";
      error: Error;
    };

/**
 * Spotify companion duck ratio for standard / short breaks — matches
 * {@link DUCK_RATIO} / {@link STANDARD_BREAK_DUCK_RATIO} (18% of pre-break
 * volume). Live breaks ramp to `preBreakVolume * SPOTIFY_DUCK_RATIO`.
 * Extended formats pause or use {@link EXTENDED_BREAK_AMBIENT_FLOOR} instead.
 * Never pass this raw to `volume_percent`; {@link setSpotifyVolume} scales it
 * and applies SDK + REST together.
 */
export const SPOTIFY_DUCK_RATIO = STANDARD_BREAK_DUCK_RATIO;
/** Fade-down window before DJ voice (perceptual log ramp, not a hard jump). */
export const SPOTIFY_DUCK_RAMP_MS = 400;
/** Fade-up window after DJ voice finishes (perceptual log swell). */
export const SPOTIFY_RESTORE_RAMP_MS = 600;
/**
 * Hold music ducked after the speech element fires `ended` so natural voice
 * decay is not cut by the swell. Unduck must wait for this cushion.
 */
export const DJ_SPEECH_END_TAIL_MS = SPEECH_END_TAIL_MS;
/**
 * Fallback Spotify volume when no pre-break capture is available.
 * Live Duck–Talk–Swell restores {@link WebOrchestrator}'s `preBreakVolume`.
 */
export const SPOTIFY_UNDUCKED_GAIN = 1;

/** Default companion pacing when no station override is supplied (standard min gap). */
const DEFAULT_DJ_PACING_FREQUENCY = 2;

/** Default DJ mode — standard radio DJ every ~2 tracks. */
const DEFAULT_DJ_MODE: DjMode = "balanced";

/** Songs that must elapse before a break is due for each DJ mode. */
const DJ_MODE_THRESHOLDS: Record<DjMode, number> = {
  no_dj: Number.POSITIVE_INFINITY,
  active: 1,
  balanced: 2,
  in_depth: 4,
};

function isDjMode(value: unknown): value is DjMode {
  return (
    value === "no_dj" ||
    value === "active" ||
    value === "balanced" ||
    value === "in_depth"
  );
}

/** Max Spotify/Apple tracks retained for DJ recap context. */
const ACTUAL_PLAYBACK_HISTORY_LIMIT = 5;

function clampDjVoiceVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DJ_VOICE_VOLUME;
  return Math.min(1, Math.max(0, value));
}

function normalizeTrackRefs(
  refs: OrchestratorTrackRef[] | undefined,
  limit: number,
): OrchestratorTrackRef[] {
  if (!Array.isArray(refs) || limit <= 0) return [];
  const out: OrchestratorTrackRef[] = [];
  for (const raw of refs) {
    const title = typeof raw?.title === "string" ? raw.title.trim() : "";
    const artist = typeof raw?.artist === "string" ? raw.artist.trim() : "";
    if (!title || !artist) continue;
    out.push({ title, artist });
    if (out.length >= limit) break;
  }
  return out;
}

/** REST percent for the ducked level — documented so callers never guess. */
export const SPOTIFY_DUCK_VOLUME_PERCENT = toSpotifyRestVolumePercent(
  SPOTIFY_DUCK_RATIO,
);

/**
 * Continuous silent WAV data URI — keeps Android Chrome from suspending the
 * tab / Web Audio graph when the listener switches to Maps or locks the phone.
 * Must be started inside a user gesture (Play / Launch Station).
 */
const SILENT_ANCHOR_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

/** Module-level so Play/Launch can prime before a WebOrchestrator exists. */
let sharedSilentAnchor: HTMLAudioElement | null = null;

function ensureSharedSilentAnchor(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  if (sharedSilentAnchor) return sharedSilentAnchor;

  const audio = document.createElement("audio");
  audio.src = SILENT_ANCHOR_WAV;
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0.001;
  audio.setAttribute("aria-hidden", "true");
  audio.setAttribute("playsinline", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);
  sharedSilentAnchor = audio;
  return audio;
}

/**
 * Start (or resume) the looping silent `<audio>` anchor.
 * Call synchronously inside the Play / Launch Station click handler.
 */
export function startSilentAudioAnchor(): void {
  const audio = ensureSharedSilentAnchor();
  if (!audio) return;
  void audio.play().catch((err) => {
    console.warn("[LinerLore] Silent audio anchor play() blocked", err);
  });
}

/** Tear down the silent anchor when the companion session is cleared. */
export function stopSilentAudioAnchor(): void {
  const audio = sharedSilentAnchor;
  if (!audio) return;
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.remove();
  } catch (err) {
    console.error("[LinerLore TRACE ERROR]", err);
  }
  sharedSilentAnchor = null;
}

/**
 * Coordinates a single DJ break cycle against Spotify or Apple Music
 * using universal Duck–Talk–Swell volume control.
 */
export class WebOrchestrator {
  private readonly provider: OrchestratorProvider;
  private readonly spotifyAccessToken?: string;
  private readonly scriptEndpoint: string;
  private readonly onNoActiveDevice?: (status: SpotifyNoActiveDevice) => void;
  private readonly onScript?: (script: string) => void;
  private readonly onDjStart?: () => void;
  private readonly onDjEnd?: () => void;
  private readonly onStatusChange?: (status: OrchestratorStatus) => void;
  private readonly onError?: (error: Error) => void;

  /** Live DJ TTS buffer source — one-shot Web Audio node per break. */
  private activeSpeechSource: AudioBufferSourceNode | null = null;
  /** Dedicated speech GainNode (`speechGain`) for the live DJ TTS clip. */
  private activeSpeechGain: GainNode | null = null;
  /**
   * HTMLAudioElement fallback only when Web Audio is unavailable.
   * Prefer {@link activeSpeechSource} / {@link activeSpeechGain}.
   */
  private activeDjAudio: HTMLAudioElement | null = null;
  /**
   * ControlDeck master fader (0–1). Scales companion DJ TTS via
   * {@link effectiveDjVoiceGain}. Never folded into music duck/swell ramps —
   * those use {@link setTransportVolume} only.
   */
  private masterVolume = 0.5;
  /**
   * Listener DJ voice gain (0–1). Scales ElevenLabs TTS and user voice-break
   * speechGain playback. Live-updates the active clip when changed.
   */
  private djVolume = DEFAULT_DJ_VOICE_VOLUME;
  /**
   * Global abort for in-flight generate-script / TTS work.
   * Reset on station switch, host persona change, or settings update via
   * {@link bumpSessionEpoch} so stale speech blobs cannot air.
   */
  private currentAbortController: AbortController | null = null;
  /**
   * Track identity for the break about to run / currently scripting.
   * Cleared on station launch so a prior session's id cannot seed R2/TTS.
   */
  private currentTrack: OrchestratorTrackInput | null = null;
  /** Alias of the live DJ-break track (same object as {@link currentTrack}). */
  private activeTrack: OrchestratorTrackInput | null = null;
  /** Break-in-progress lock — must clear on track end / new trackId. */
  private running = false;
  /**
   * Canonical FSM state (spec). {@link status} mirrors this for UI consumers
   * via {@link broadcastStateToOrchestratorStatus}.
   */
  private broadcastState: BroadcastState = "IDLE";
  /** Duck–Talk–Swell UI status — instance-owned so React remounts cannot reset it. */
  private status: OrchestratorStatus = "STANDBY";
  /**
   * Session generation counter. Incremented ONLY on explicit user interactions
   * (manual station selection / mix launch, host persona swap, or host settings
   * edits) — never on automated track transitions or queue advances. Async
   * speech fetches capture the epoch at request time and discard blobs when
   * `requestEpoch !== sessionEpoch`.
   */
  private sessionEpoch = 0;
  /** Live companion track id — `breakExecutedForCurrentTrack` resets only when this changes. */
  private currentTrackId: string | null = null;
  /** Genre station-bed loop for Mode B long-form breaks. */
  private stationBedAudio: HTMLAudioElement | null = null;
  private stationBedObjectUrl: string | null = null;
  /** True after a music duck has been applied and not yet restored. */
  private musicDucked = false;
  /** True when music was paused for an extended-format break and not yet resumed. */
  private musicPausedForBreak = false;
  /**
   * Listener / UI pause intent. Survives Spotify SDK WebSocket reconnects that
   * auto-resume playback while the deck still shows paused.
   */
  private pausedIntent = false;
  /**
   * URI currently being force-played to correct a Spotify Autoplay hijack.
   * Prevents re-entrant {@link steerToStationUri} while the SDK settles.
   */
  private stationSteerInFlightUri: string | null = null;
  /**
   * Exact music volume captured immediately before a DJ break duck.
   * Swell / error reset restore to this — never hardcoded 1.0 — so volume
   * cannot creep above the listener's pre-break level.
   */
  private preBreakVolume: number | null = null;
  /**
   * Absolute device volume held under the host (`preBreakVolume * duckRatio`).
   * Captured when the hold begins so swell restores from the same floor even
   * when duck started before live TTS finished.
   */
  private breakDuckTarget: number | null = null;
  /**
   * Live DJ persona id for generate-script / TTS. Updated via {@link setPersona}
   * when the user changes hosts mid-session.
   */
  private activePersonaId: string | null = null;
  /**
   * Subscription tier gate — Free Mode remaps ElevenLabs hosts to Sam/Maya/Alex
   * via {@link resolveActiveHost} and never resolves ElevenLabs voice ids.
   */
  private isPro = false;
  /**
   * Debounce: last trackId that successfully entered `runDjBreak`.
   * Prevents double-firing the same song while still allowing tracks 2+.
   */
  private lastBreakTrackId: string | null = null;
  /**
   * Track-level single-break lock. Set `true` the moment any DJ break (fast
   * liner or full LLM break) begins playing for the current registered track.
   * Late-arriving LLM speech payloads for the same track are discarded.
   */
  private breakExecutedForCurrentTrack = false;
  /**
   * All trackIds that already received a break this session (covers youtubeId
   * vs Spotify id aliasing across prefetch → registerTrack → runDjBreak).
   */
  private readonly executedBreakTrackIds = new Set<string>();
  /** Cancels an in-flight duck/swell ramp when locks are released. */
  private volumeRampAbort: AbortController | null = null;
  /** Cancels in-flight generate-script prefetch requests. */
  private prefetchAbort: AbortController | null = null;
  /**
   * Autopilot lookahead: warmed generate-script responses keyed by trackId.
   * Survives across queue advances so Duck–Talk–Swell can start without a
   * cold network round-trip at the transition.
   */
  private readonly djPrefetchByTrackId = new Map<
    string,
    {
      track: OrchestratorTrackInput;
      promise: Promise<DjBreakScriptResponse>;
    }
  >();
  /** Most recently warmed lookahead key (youtubeId may differ from Spotify id). */
  private nextPrefetchKey: string | null = null;
  /** Last trackId handed to {@link registerTrack}. */
  private registeredTrackId: string | null = null;
  /**
   * Songs since the last successfully completed DJ break.
   * Lives on the orchestrator instance (not React state) so remounts / HMR
   * cannot reset chatty-mode cadence mid-session.
   */
  private songsSinceLastBreak = 0;
  /** Station pacing frequency (legacy numeric window min gap). */
  private djPacingFrequency = DEFAULT_DJ_PACING_FREQUENCY;
  /**
   * Companion DJ mode.
   * - `no_dj`: never prefetch / duck / speak
   * - `active`: speak when `songsSinceLastBreak >= 1`
   * - `balanced` (default): speak when `songsSinceLastBreak >= 2`
   * - `in_depth`: speak when `songsSinceLastBreak >= 4`
   */
  private djMode: DjMode = DEFAULT_DJ_MODE;
  /** Tuning Console vocal energy → ElevenLabs voice_settings. */
  private mood: DjMood = DEFAULT_DJ_TUNING.mood;
  /** Tuning Console narrative tone. */
  private personality: DjPersonality = DEFAULT_DJ_TUNING.personality;
  /** Tuning Console trivia depth guardrail. */
  private knowledge: DjKnowledge = DEFAULT_DJ_TUNING.knowledge;
  /**
   * Clean Mode gate forwarded to generate-script.
   * Guests default false; signed-in listeners may opt in via Host Settings.
   */
  private allowExplicit = false;
  /** Lore / commentary depth forwarded to generate-script prompt builder. */
  private commentaryFormat: CommentaryFormat = DEFAULT_COMMENTARY_FORMAT;
  /** Latest history/queue context for generate-script recaps + teasers. */
  private scriptContext: DjScriptContext = {};
  /**
   * Armed by {@link flushForStationLaunch} / {@link resetBreakSession}.
   * The next voiced break skips the LLM and uses {@link getStationLaunchLiner}.
   */
  private sessionLaunchPending = false;
  /** Display name for fast launch liners (fallback when script context omits it). */
  private stationName = "SongHost Radio";
  /**
   * Shared studio playlist used to map live title/artist → break cue index.
   * Empty when no studio manifest is loaded (normal companion radio).
   */
  private studioPlaylist: Array<{
    title: string;
    artist: string;
    youtubeId?: string;
  }> = [];
  /** Authored break cues keyed by trackIndex from the studio timeline. */
  private studioBreaksByTrackIndex = new Map<number, StudioBreakCueInput>();
  /**
   * Exact tracks observed on the companion stream (Spotify/Apple), newest last.
   * Sourced from every {@link registerTrack} — not the station queue guess.
   */
  private actualPlaybackHistory: OrchestratorTrackRef[] = [];
  /** Voice / persona / mode remembered from the last prefetch or break for live fallback. */
  private lastVoiceId: string | null = null;
  private lastPersonaId: string | null = null;
  private lastMode: string | undefined;
  /**
   * Serializes registerTrack work so a subsequent `runDjBreak` can await the
   * autopilot prefetch execution before starting a duplicate live break.
   */
  private registerTrackWork: Promise<void> = Promise.resolve();
  /** Live transcript for the most recently received generate-script payload. */
  private _activeScriptText = "";
  /** Session transcript log for Teleprompter / Broadcast Log consumers. */
  private _broadcastHistory: BroadcastHistoryEntry[] = [];
  /** True after MediaSession action handlers have been bound for this instance. */
  private mediaSessionHandlersBound = false;

  constructor(options: WebOrchestratorOptions) {
    this.provider = options.provider;
    this.spotifyAccessToken = options.spotifyAccessToken;
    this.scriptEndpoint = options.scriptEndpoint ?? "/api/generate-script";
    this.onNoActiveDevice = options.onNoActiveDevice;
    this.onScript = options.onScript;
    this.onDjStart = options.onDjStart;
    this.onDjEnd = options.onDjEnd;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;
    this.currentAbortController = new AbortController();
    // Spec: multiply speech by djVolume from localStorage (`songhost_dj_volume`)
    // or fallback 0.85. Explicit constructor override still wins.
    this.djVolume = clampDjVoiceVolume(
      options.initialDjVolume != null
        ? options.initialDjVolume
        : readPersistedDjVolume(DEFAULT_DJ_VOICE_VOLUME),
    );
  }

  private static isAbortError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    if (err instanceof Error && err.name === "AbortError") return true;
    return false;
  }

  /**
   * Abort in-flight DJ break fetches, tear down any live TTS element, and
   * mint a fresh {@link currentAbortController}.
   */
  private resetBreakAbortController(reason = "Station relaunch"): void {
    try {
      this.currentAbortController?.abort(reason);
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
    this.currentAbortController = new AbortController();
    this.disposeDjAudio();
    this.stopStationBed();
  }

  /**
   * Increment {@link sessionEpoch} and abort any in-flight speech work.
   * Call only for explicit user interactions (station launch, host persona
   * swap, host settings edits) — never for automated queue progression.
   */
  private bumpSessionEpoch(reason: string): void {
    this.sessionEpoch += 1;
    console.log("[LinerLore TRACE] sessionEpoch bumped", {
      sessionEpoch: this.sessionEpoch,
      reason,
    });
    this.resetBreakAbortController(reason);
  }

  /**
   * Cancel pending generate-script / TTS work and drop warmed break buffers.
   * Used when Host Settings change (persona, Pro tier, knowledge depth) so a
   * stale voice or lore clip cannot air after the override lands.
   */
  private abortPendingSpeechAndClearBuffers(
    reason = "Host settings change",
  ): void {
    console.log("[LinerLore TRACE] abortPendingSpeechAndClearBuffers", {
      reason,
      prefetchCount: this.djPrefetchByTrackId.size,
      wasRunning: this.running,
      sessionEpoch: this.sessionEpoch,
    });
    this.bumpSessionEpoch(reason);
    this.abortPrefetchRequests();
    this.clearDjPrefetch();
    if (
      (this.broadcastState === "PREFETCHING_BREAK" || this.status === "PREFETCHING")
      && !this.running
    ) {
      this.setBroadcastState("PLAYING_MUSIC");
    }
  }

  /** Signal for generate-script / TTS downloads — always defined after construct. */
  private breakAbortSignal(): AbortSignal {
    if (!this.currentAbortController) {
      this.currentAbortController = new AbortController();
    }
    return this.currentAbortController.signal;
  }

  /**
   * Combine the global break controller with an optional prefetch supersession
   * signal so either abort cancels the fetch.
   */
  private combineAbortSignals(
    ...signals: Array<AbortSignal | undefined>
  ): AbortSignal {
    const active = signals.filter((s): s is AbortSignal => Boolean(s));
    if (active.length === 0) return this.breakAbortSignal();
    if (active.length === 1) return active[0]!;
    const anyFn = (
      AbortSignal as typeof AbortSignal & {
        any?: (signals: AbortSignal[]) => AbortSignal;
      }
    ).any;
    if (typeof anyFn === "function") {
      return anyFn(active);
    }
    // Fallback: listen to all and abort a local controller.
    const local = new AbortController();
    const onAbort = () => {
      try {
        local.abort("Station relaunch");
      } catch {
        // ignore
      }
    };
    for (const signal of active) {
      if (signal.aborted) {
        onAbort();
        break;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return local.signal;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get orchestratorStatus(): OrchestratorStatus {
    return this.status;
  }

  get broadcastFsmState(): BroadcastState {
    return this.broadcastState;
  }

  get currentSessionEpoch(): number {
    return this.sessionEpoch;
  }

  get lastExecutedBreakTrackId(): string | null {
    return this.lastBreakTrackId;
  }

  get songsSinceBreak(): number {
    return this.songsSinceLastBreak;
  }

  /** Most recent DJ script text received from generate-script / prefetch. */
  get activeScriptText(): string {
    return this._activeScriptText;
  }

  /** Session transcript history (oldest → newest) for Broadcast Log UI. */
  get broadcastHistory(): readonly BroadcastHistoryEntry[] {
    return this._broadcastHistory;
  }

  /** Update companion pacing used by the registerTrack live-fallback safety net. */
  setDjPacingFrequency(pacing: number): void {
    if (typeof pacing === "number" && Number.isFinite(pacing) && pacing >= 0) {
      this.djPacingFrequency = Math.max(0, Math.floor(pacing));
    }
  }

  /**
   * Configure companion DJ mode (content depth + break cadence).
   * `no_dj` immediately disables prefetch and volume ducking.
   */
  setDjMode(mode: DjMode): void {
    if (!isDjMode(mode)) return;
    if (mode === this.djMode) return;
    this.djMode = mode;
    this.abortPendingSpeechAndClearBuffers("DJ mode change");
    if (mode === "no_dj") {
      this.abortPrefetchRequests();
      this.clearDjPrefetch();
      this.djPacingFrequency = 0;
    } else if (mode === "active") {
      this.djPacingFrequency = 1;
    } else if (this.djPacingFrequency <= 0) {
      this.djPacingFrequency = DEFAULT_DJ_PACING_FREQUENCY;
    }
  }

  getDjMode(): DjMode {
    return this.djMode;
  }

  /** Tuning Console mood / personality / knowledge for generate-script. */
  setDjTuning(input: {
    mood?: DjMood;
    personality?: DjPersonality;
    knowledge?: DjKnowledge;
  }): void {
    const prevMood = this.mood;
    const prevPersonality = this.personality;
    const prevKnowledge = this.knowledge;
    if (input.mood) this.mood = input.mood;
    if (input.personality) this.personality = input.personality;
    if (input.knowledge) this.knowledge = input.knowledge;
    const changed =
      (input.mood != null && input.mood !== prevMood)
      || (input.personality != null && input.personality !== prevPersonality)
      || (input.knowledge != null && input.knowledge !== prevKnowledge);
    if (changed) {
      this.abortPendingSpeechAndClearBuffers("Host tuning change");
    }
  }

  /** Persist Clean Mode for upcoming generate-script calls. */
  setAllowExplicit(allow: boolean): void {
    const next = Boolean(allow);
    if (next === this.allowExplicit) return;
    this.allowExplicit = next;
    this.abortPendingSpeechAndClearBuffers("Allow explicit change");
  }

  getAllowExplicit(): boolean {
    return this.allowExplicit;
  }

  /** Persist lore / commentary depth for upcoming generate-script calls. */
  setCommentaryFormat(format: CommentaryFormat | string): void {
    const next = resolveCommentaryFormat(format);
    if (next === this.commentaryFormat) return;
    this.commentaryFormat = next;
    this.abortPendingSpeechAndClearBuffers("Commentary format change");
  }

  getCommentaryFormat(): CommentaryFormat {
    return this.commentaryFormat;
  }

  /**
   * Set companion DJ voice gain (0–1 from the Host Settings 0–100% slider).
   * Applies immediately to any in-flight TTS / voice-break audio element via
   * `voiceGain(master, djVolume)` ≡ master × (dj% / 100) × VOICE_HEADROOM_BOOST.
   *
   * Music ducking stays at {@link SPOTIFY_DUCK_RATIO} of pre-break volume
   * (independent of this slider) so ducked beds keep the same relative floor
   * under whatever vocal level the listener chose.
   */
  setDjVolume(volume: number): void {
    this.djVolume = clampDjVoiceVolume(volume);
    this.applyLiveDjVoiceGain();
  }

  getDjVolume(): number {
    return this.djVolume;
  }

  /**
   * Sync ControlDeck master for companion DJ TTS gain without a transport write.
   * Used when the orchestrator is (re)created so TTS tracks the fader even
   * before the next {@link setVolume} call.
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = clampSpotifyVolumeNormalized(volume);
    this.applyLiveDjVoiceGain();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  /**
   * Effective speechGain for the live DJ clip.
   * Always routes through {@link voiceGain} so the persisted Host Settings
   * multiplier (`songhost_dj_volume`) is applied on every speech playback.
   */
  private effectiveDjVoiceGain(): number {
    return voiceGain(this.masterVolume, this.djVolume);
  }

  /** Push {@link effectiveDjVoiceGain} onto the live Web Audio / HTML5 clip. */
  private applyLiveDjVoiceGain(): void {
    const gain = this.effectiveDjVoiceGain();
    if (this.activeSpeechGain) {
      setGainSmooth(
        this.activeSpeechGain.gain,
        gain,
        this.activeSpeechGain.context,
        GAIN_SMOOTH_TIME_CONSTANT,
      );
    }
    if (this.activeDjAudio) {
      this.activeDjAudio.volume = gain;
      this.activeDjAudio.muted = false;
    }
  }

  /**
   * Resolve the shared Web Audio context used for DJ TTS buffer playback.
   * Unlocks / resumes a suspended graph before returning.
   */
  private resolveSpeechAudioContext(): AudioContext | null {
    try {
      getMasterAnalyser().unlock();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
    return getMasterAnalyser().getAudioContext();
  }

  getDjTuning(): {
    mood: DjMood;
    personality: DjPersonality;
    knowledge: DjKnowledge;
  } {
    return {
      mood: this.mood,
      personality: this.personality,
      knowledge: this.knowledge,
    };
  }

  /**
   * Subscription tier for voice resolution. Free Mode forces OpenAI
   * Sam/Maya/Alex via {@link resolveActiveHost}; Pro keeps ElevenLabs hosts.
   */
  setIsPro(isPro: boolean): void {
    const next = Boolean(isPro);
    if (this.isPro === next) return;
    this.isPro = next;
    // Drop in-flight Free/Pro speech before re-stamping the host voice.
    this.abortPendingSpeechAndClearBuffers("Subscription tier change");
    // Re-stamp voice context so a mid-session upgrade/downgrade cannot keep
    // an ElevenLabs id on Free (or an OpenAI id after upgrading to Pro).
    if (this.activePersonaId) {
      this.setPersona(this.activePersonaId, { skipAbort: true });
    }
  }

  getIsPro(): boolean {
    return this.isPro;
  }

  /**
   * Switch the live DJ persona mid-session. Updates `activePersonaId` /
   * voice context so the next generate-script call uses the new host.
   * Aborts in-flight script fetches and clears warmed break buffers so the
   * previous host cannot air. Pass `{ skipAbort: true }` when the caller
   * already aborted (e.g. {@link setIsPro}).
   *
   * Free Mode: stores the Free host id (sam/maya/alex) + OpenAI voice from
   * {@link resolveActiveHost} and never resolves ElevenLabs voice ids.
   */
  setPersona(
    newPersonaId: string,
    options?: { skipAbort?: boolean },
  ): void {
    const trimmed = newPersonaId.trim();
    if (!trimmed) return;

    const host = resolveActiveHost(trimmed, this.isPro);
    const previousPersonaId = this.activePersonaId;
    const nextPersonaId = !this.isPro
      ? host.personaId
      : (getPersonaById(host.personaId)?.id ?? host.personaId);
    const personaChanged =
      previousPersonaId != null && previousPersonaId !== nextPersonaId;

    if (!options?.skipAbort && personaChanged) {
      // Abort in-flight speech so a Miles override cannot race a Devon clip.
      this.abortPendingSpeechAndClearBuffers("Host persona change");
    }

    if (!this.isPro) {
      // Free: Sam / Maya / Alex — never touch ElevenLabs maps.
      this.activePersonaId = host.personaId;
      this.lastPersonaId = this.activePersonaId;
      this.lastVoiceId = host.voiceId;
      console.log("[LinerLore TRACE] setPersona", {
        personaId: this.activePersonaId,
        displayName: host.displayName,
        voiceId: this.lastVoiceId,
        tier: "free",
        sourcePersona: trimmed,
      });
      return;
    }

    const persona = getPersonaById(host.personaId);
    this.activePersonaId = persona?.id ?? host.personaId;
    this.lastPersonaId = this.activePersonaId;
    const mappedVoiceId =
      host.voiceId
      || resolveTierAwareVoiceId(this.activePersonaId, true)
      || persona?.elevenLabsVoiceId
      || persona?.voice;
    if (mappedVoiceId) {
      this.lastVoiceId = mappedVoiceId;
    }

    console.log("[LinerLore TRACE] setPersona", {
      personaId: this.activePersonaId,
      displayName: host.displayName,
      voiceId: this.lastVoiceId,
      tier: "pro",
    });
  }

  /**
   * Resolve a station's host from explicit assignment or genre/decade affinity
   * ({@link getPersonaForStation}), then apply via {@link setPersona}.
   */
  setPersonaForStation(station: StationPersonaInput): string {
    const persona = getPersonaForStation(station);
    this.setPersona(persona.id);
    return persona.id;
  }

  getActivePersonaId(): string | null {
    return this.activePersonaId;
  }

  /**
   * Push live SDK / queue metadata into the shared UI now-playing store and
   * MediaSession. Prefer this over writing React state alone so the deck can
   * render title/artist before the first playback poll arrives.
   */
  updateCurrentTrackState(activeTrack: ActiveTrackState | null): void {
    setSharedCurrentTrackState(activeTrack);
    if (!activeTrack?.title?.trim() || !activeTrack?.artist?.trim()) return;
    void this.syncMediaSession({
      title: activeTrack.title,
      artist: activeTrack.artist,
      album: activeTrack.album,
      albumArt: activeTrack.albumArtUrl,
    });
    this.setMediaSessionPlaybackState(
      activeTrack.isPaused ? "paused" : "playing",
    );
  }

  /**
   * Resolve a Spotify URI for a track restored from UI / queue storage when the
   * Web Playback SDK has no active playback context after a page reboot.
   *
   * Prefers the hydrated sessionStorage queue (`songhost_active_queue`) so
   * resume cannot race a fallback preset before React rehydrates.
   */
  resolveRestoredTrackUri(): string | null {
    const persisted = readPersistedSessionQueue();
    const persistedTrack =
      persisted?.nowPlayingTrack ??
      (persisted && persisted.queue.length
        ? persisted.queue[
            Math.min(
              Math.max(0, persisted.currentIndex),
              persisted.queue.length - 1,
            )
          ]
        : null);
    if (persistedTrack) {
      const fromSession = spotifyUriForQueueTrack({
        id: persistedTrack.spotifyId,
        spotifyId: persistedTrack.spotifyId,
      });
      if (fromSession) return fromSession;
    }

    const shared = getCurrentTrackState();
    if (shared) {
      const fromShared = spotifyUriForQueueTrack({
        id: shared.id,
        spotifyId: shared.id,
      });
      if (fromShared) return fromShared;
    }

    if (this.currentTrack?.trackId) {
      const fromCurrent = spotifyUriForQueueTrack({
        id: this.currentTrack.trackId,
        spotifyId: this.currentTrack.trackId,
      });
      if (fromCurrent) return fromCurrent;
    }

    if (this.activeTrack?.trackId) {
      const fromActive = spotifyUriForQueueTrack({
        id: this.activeTrack.trackId,
        spotifyId: this.activeTrack.trackId,
      });
      if (fromActive) return fromActive;
    }

    return null;
  }

  /**
   * True when Spotify has no currently-playing item to bare-`resume()` into
   * (typical after refresh: UI shows a restored track, SDK context is empty).
   */
  private async spotifyNeedsExplicitPlay(): Promise<boolean> {
    if (this.provider !== "spotify") return false;
    try {
      const live = await getCurrentlyPlaying(await this.resolveSpotifyToken());
      return !live;
    } catch (error) {
      console.warn(
        "[LinerLore] currently-playing probe failed — treating as no context",
        error,
      );
      return true;
    }
  }

  /**
   * After a reboot the SDK device may be registered but have no track context.
   * Prefer an explicit `playTrack(uri)` from the hydrated session queue over a
   * silent `resume()` no-op, so playback does not resume against a fallback
   * preset before `useStationQueue` hydrates.
   */
  private async playRestoredTrackOrResume(): Promise<SpotifyPlaybackResult> {
    const needsPlay = await this.spotifyNeedsExplicitPlay();
    const restoredUri = this.resolveRestoredTrackUri();

    if (needsPlay && restoredUri) {
      console.log(
        "[LinerLore] No Spotify playback context — playTrack(hydrated session queue)",
        restoredUri,
      );
      const played = await this.playTrack(restoredUri);
      if (played === "NO_ACTIVE_DEVICE") return { success: false, reason: "NO_ACTIVE_DEVICE" };
      return played === true;
    }

    const resumed = await this.resumeActivePlayer();
    if (resumed) return true;

    // Bare resume failed (empty context / stale device) — retry with URI.
    if (restoredUri) {
      console.log(
        "[LinerLore] resume() failed — retrying playTrack(restored)",
        restoredUri,
      );
      const played = await this.playTrack(restoredUri);
      if (played === "NO_ACTIVE_DEVICE") return { success: false, reason: "NO_ACTIVE_DEVICE" };
      return played === true;
    }

    return false;
  }

  /**
   * Resume the active Spotify / Apple Music transport and keep the silent
   * media-session anchor running for mobile background persistence.
   *
   * When the UI restored a track after refresh but Spotify has no active
   * context, this falls back to {@link playTrack} instead of a bare resume.
   */
  async resume(): Promise<SpotifyPlaybackResult> {
    this.startSilentAnchor();
    this.bindMediaSessionHandlers();
    this.pausedIntent = false;

    if (this.provider === "spotify") {
      const result = await this.playRestoredTrackOrResume();
      if (isNoActiveDeviceResult(result)) {
        this.onNoActiveDevice?.(result);
        this.pausedIntent = true;
        this.setMediaSessionPlaybackState("paused");
        return result;
      }
      if (result !== true) {
        this.pausedIntent = true;
      }
      this.setMediaSessionPlaybackState(result === true ? "playing" : "paused");
      return result;
    }

    const ok = await this.resumeActivePlayer();
    if (!ok) this.pausedIntent = true;
    this.setMediaSessionPlaybackState(ok ? "playing" : "paused");
    return ok;
  }

  /**
   * True when the listener / deck has requested pause. Used by visibility
   * guards and `player_state_changed` to suppress SDK auto-resume ghost audio.
   */
  get isPausedIntent(): boolean {
    return this.pausedIntent;
  }

  /**
   * Play / pause toggle with session hydration: when paused and Spotify has no
   * active track context, plays the restored `nowPlaying` URI on the SDK device
   * rather than calling a no-op `player.resume()`.
   */
  async togglePlay(): Promise<"playing" | "paused" | "failed"> {
    this.startSilentAnchor();
    this.bindMediaSessionHandlers();

    const live = await this.getCurrentlyPlayingTrack().catch((err) => {
      console.warn("[LinerLore] togglePlay currently-playing lookup failed", err);
      return null;
    });
    const shared = getCurrentTrackState();
    const isPlaying =
      live?.isPlaying === true ||
      (live == null && shared?.isPaused === false);

    if (isPlaying) {
      await this.pause();
      return "paused";
    }

    const result = await this.resume();
    if (result === true) return "playing";
    return "failed";
  }

  /**
   * Pause the active Spotify / Apple Music transport.
   *
   * Also tears down live DJ `AudioBufferSourceNode` speech, suspends the
   * shared Web Audio graph, and verifies the Spotify SDK acknowledges pause
   * so background-tab / WebSocket reconnect cannot leave ghost audio running.
   */
  async pause(): Promise<void> {
    this.pausedIntent = true;
    this.haltSpeechForUserPause();

    const result = await this.pauseActivePlayer();
    if (result === "NO_ACTIVE_DEVICE") {
      this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
    }

    if (this.provider === "spotify") {
      await this.verifySpotifyPauseAcknowledged();
    }

    const shared = getCurrentTrackState();
    if (shared && !shared.isPaused) {
      setSharedCurrentTrackState({ ...shared, isPaused: true });
    }
    this.setMediaSessionPlaybackState("paused");
  }

  /**
   * Re-assert pause after tab foregrounding or SDK reconnect when
   * {@link isPausedIntent} is still true. Safe to call repeatedly.
   */
  async enforcePausedTransport(): Promise<void> {
    if (!this.pausedIntent) return;
    await this.pause();
  }

  /**
   * Stop / disconnect active speech nodes and suspend the shared AudioContext
   * without resuming companion music (unlike {@link stopDjAudio}).
   */
  private haltSpeechForUserPause(): void {
    this.abortVolumeRamp();
    this.disposeDjAudio();
    this.stopStationBed({ revokeUrl: false });
    this.running = false;
    // Drop duck bookkeeping — transport is fully paused; next resume starts clean.
    this.musicDucked = false;
    this.musicPausedForBreak = false;
    this.breakDuckTarget = null;
    this.preBreakVolume = null;

    if (
      this.broadcastState !== "IDLE"
      && this.broadcastState !== "PLAYING_MUSIC"
      && this.broadcastState !== "PREFETCHING_BREAK"
    ) {
      this.setBroadcastState("PLAYING_MUSIC");
    }

    try {
      const ctx = getMasterAnalyser().getAudioContext();
      if (ctx && ctx.state === "running") {
        void ctx.suspend().catch((err) => {
          console.error("[LinerLore TRACE ERROR]", err);
        });
      }
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
  }

  /**
   * Confirm Spotify Web Playback SDK / Connect reports paused after
   * {@link pauseActivePlayer}. Re-issues pause once if still playing.
   */
  private async verifySpotifyPauseAcknowledged(): Promise<void> {
    try {
      const sdk = getSpotifySdkPlayer();
      if (sdk?.getCurrentState) {
        const state = await sdk.getCurrentState();
        if (state && state.paused === false) {
          console.log(
            "[LinerLore TRACE] Pause not acknowledged — re-issuing spotifyPlayer.pause()",
          );
          await sdk.pause?.();
          const retry = await this.pauseActivePlayer();
          if (retry === "NO_ACTIVE_DEVICE") {
            this.onNoActiveDevice?.({
              success: false,
              reason: "NO_ACTIVE_DEVICE",
            });
          }
        }
        return;
      }
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }

    // REST fallback probe when SDK state is unavailable.
    try {
      const live = await this.getCurrentlyPlayingTrack();
      if (live?.isPlaying) {
        console.log(
          "[LinerLore TRACE] REST still playing after pause — re-issuing pause",
        );
        const retry = await this.pauseActivePlayer();
        if (retry === "NO_ACTIVE_DEVICE") {
          this.onNoActiveDevice?.({
            success: false,
            reason: "NO_ACTIVE_DEVICE",
          });
        }
      }
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
  }

  /** Skip to the next track on the active companion transport. */
  async skipTrack(): Promise<void> {
    if (this.provider === "spotify") {
      const token = await this.resolveSpotifyToken();
      const result = await spotifyNext(token);
      if (isNoActiveDeviceResult(result)) {
        this.onNoActiveDevice?.(result);
      }
      return;
    }

    try {
      const kit = await getAppleMusicKit();
      if (typeof kit.player.skipToNextItem === "function") {
        await kit.player.skipToNextItem();
      }
    } catch (error) {
      console.warn("[LinerLore] Apple Music skipTrack failed", error);
    }
  }

  /** Skip to the previous track on the active companion transport. */
  async previousTrack(): Promise<void> {
    if (this.provider === "spotify") {
      const token = await this.resolveSpotifyToken();
      const result = await spotifyPrevious(token);
      if (isNoActiveDeviceResult(result)) {
        this.onNoActiveDevice?.(result);
      }
      return;
    }

    try {
      const kit = await getAppleMusicKit();
      if (typeof kit.player.skipToPreviousItem === "function") {
        await kit.player.skipToPreviousItem();
      }
    } catch (error) {
      console.warn("[LinerLore] Apple Music previousTrack failed", error);
    }
  }

  /**
   * Invalidate warmed generate-script / TTS clips (e.g. after a mid-session
   * persona change so the old voice cannot air). Also aborts in-flight
   * generate-script fetches tied to {@link currentAbortController}.
   * No-ops without bumping {@link sessionEpoch} when there is nothing to clear.
   */
  flushPrefetch(): void {
    const hasWarmedPrefetch = this.djPrefetchByTrackId.size > 0;
    const hasInFlightSpeech = this.prefetchAbort != null;
    if (!hasWarmedPrefetch && !hasInFlightSpeech) {
      console.log("[LinerLore TRACE] flushPrefetch — no flush required", {
        prefetchCount: 0,
        sessionEpoch: this.sessionEpoch,
      });
      return;
    }
    console.log("[LinerLore TRACE] flushPrefetch — clearing warmed DJ clips", {
      prefetchCount: this.djPrefetchByTrackId.size,
    });
    this.abortPendingSpeechAndClearBuffers("Prefetch flush");
  }

  private breakThreshold(): number {
    return DJ_MODE_THRESHOLDS[this.djMode];
  }

  private setStatus(next: OrchestratorStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.onStatusChange?.(next);
  }

  /** Advance the canonical FSM and mirror onto {@link OrchestratorStatus}. */
  private setBroadcastState(next: BroadcastState): void {
    if (this.broadcastState === next) return;
    this.broadcastState = next;
    // Spec: arm the per-track mutex the instant Mode A/B transition begins.
    if (next === "MODE_A_DUCKING" || next === "MODE_B_BED_FADE") {
      this.breakExecutedForCurrentTrack = true;
      console.log("[LinerLore TRACE] breakExecutedForCurrentTrack = true", {
        source: next,
        trackId: this.currentTrackId ?? this.registeredTrackId ?? null,
        sessionEpoch: this.sessionEpoch,
      });
    }
    this.setStatus(broadcastStateToOrchestratorStatus(next));
  }

  private clearScriptTranscripts(): void {
    this._activeScriptText = "";
    this._broadcastHistory = [];
  }

  /**
   * Log + store a generate-script transcript for Teleprompter / Broadcast Log,
   * then notify UI listeners via {@link onScript}.
   */
  private publishScriptText(
    title: string,
    artist: string,
    scriptText: string,
  ): void {
    const trimmed = scriptText.trim();
    if (!trimmed) return;

    console.log(
      `[LinerLore DJ Script Payload] Track: "${title}" by ${artist} → "${trimmed}"`,
    );

    this._activeScriptText = trimmed;
    this._broadcastHistory = [
      ...this._broadcastHistory,
      {
        timestamp: new Date().toISOString(),
        track: `"${title}" by ${artist}`,
        script: trimmed,
      },
    ];
    this.onScript?.(trimmed);
  }

  /**
   * Supply recently played + upcoming queue tracks so generate-script can weave
   * multi-song recaps and "coming up next" teasers into the lore break.
   */
  setScriptContext(context: DjScriptContext): void {
    const stationName = context.stationName?.trim();
    if (stationName) this.stationName = stationName;
    this.scriptContext = {
      // Live registerTrack history wins at fetch time; keep queue-sourced
      // fallback for prefetch windows before the first companion poll.
      recentHistory: normalizeTrackRefs(
        context.recentHistory,
        ACTUAL_PLAYBACK_HISTORY_LIMIT,
      ),
      upcomingQueue: normalizeTrackRefs(context.upcomingQueue, 2),
      stationName: this.stationName,
    };
  }

  /** Update the station name used by Track #0 fast launch liners. */
  setStationName(stationName: string): void {
    const trimmed = stationName.trim();
    this.stationName = trimmed || "SongHost Radio";
    this.scriptContext = {
      ...this.scriptContext,
      stationName: this.stationName,
    };
  }

  /**
   * Load authored break cues from a shared studio manifest.
   * Subsequent Duck–Talk–Swell cycles prefer pre-rendered `audioUrl` or
   * `customText`+`voiceId` over dynamic persona LLM script generation.
   */
  loadStudioManifest(input: StudioManifestLoadInput): void {
    this.studioPlaylist = (input.tracks ?? []).map((track) => ({
      title: track.title.trim(),
      artist: track.artist.trim(),
      youtubeId: track.youtubeId?.trim() || undefined,
    }));
    this.studioBreaksByTrackIndex.clear();

    for (const cue of input.djBreaks ?? []) {
      if (
        typeof cue.trackIndex !== "number" ||
        !Number.isInteger(cue.trackIndex) ||
        cue.trackIndex < 0
      ) {
        continue;
      }
      const audioUrl = cue.audioUrl?.trim() || undefined;
      const customText = cue.customText?.trim() || undefined;
      const voiceId = cue.voiceId?.trim() || undefined;
      if (!audioUrl && !(customText && voiceId)) {
        continue;
      }
      const normalized: StudioBreakCueInput = {
        cuePointSec: cue.cuePointSec,
        trackIndex: cue.trackIndex,
        kind: cue.kind,
        audioUrl,
        customText,
        voiceId,
        label: cue.label?.trim() || undefined,
      };
      const existing = this.studioBreaksByTrackIndex.get(cue.trackIndex);
      // Prefer pre-rendered audio over script-only when both land on a slot.
      if (
        !existing ||
        (audioUrl && !existing.audioUrl) ||
        (!existing.customText && customText)
      ) {
        this.studioBreaksByTrackIndex.set(cue.trackIndex, normalized);
      }
    }

    console.log("[SongHost] webOrchestrator loaded studio break cues", {
      trackCount: this.studioPlaylist.length,
      breakCount: this.studioBreaksByTrackIndex.size,
      cues: Array.from(this.studioBreaksByTrackIndex.entries()).map(
        ([trackIndex, cue]) => ({
          trackIndex,
          kind: cue.kind,
          audioUrl: cue.audioUrl ? "[set]" : undefined,
          customText: cue.customText ? "[set]" : undefined,
          voiceId: cue.voiceId ? "[set]" : undefined,
        }),
      ),
    });
  }

  /** True when a shared studio playlist is armed for custom break resolution. */
  hasStudioManifest(): boolean {
    return this.studioPlaylist.length > 0;
  }

  clearStudioManifest(): void {
    this.studioPlaylist = [];
    this.studioBreaksByTrackIndex.clear();
  }

  /**
   * True when the next track advance should get a voiced break — used so
   * autopilot only warms TTS when a break is actually due.
   */
  willBreakOnNextTrack(): boolean {
    if (this.djMode === "no_dj" || this.djPacingFrequency <= 0) return false;
    return this.songsSinceLastBreak + 1 >= this.breakThreshold();
  }

  /**
   * Explicitly clear break-in-progress + TTS audio locks and nudge the
   * AudioContext awake. Call whenever a track ends or a new trackId lands so
   * tracks 2+ are never blocked by a sticky Track-1 lock.
   */
  releaseBreakLocks(): void {
    this.abortVolumeRamp();
    this.disposeDjAudio();
    this.stopStationBed({ revokeUrl: false });
    this.running = false;
    try {
      getMasterAnalyser().unlock();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
  }

  /**
   * Register the live companion trackId on a song change.
   *
   * When Autopilot has warmed a DJ break for the incoming track, this is the
   * execution trigger: duck → play prefetched TTS → swell. Otherwise, if a
   * break is due for the station pacing frequency, generate and run a live
   * break over the current stream.
   */
  registerTrack(trackId: string): void {
    const raw = trackId.trim();
    if (!raw) return;
    // Prefer a bare Spotify catalog id so prefetch keys / debounce match
    // the id used for R2 cache + generate-script.
    const id = normalizeSpotifyTrackId(raw) || raw;

    this.registerTrackWork = this.registerTrackWork
      .then(() => this.handleTrackRegistration(id))
      .catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
      });
  }

  private async handleTrackRegistration(trackId: string): Promise<void> {
    // Same Spotify poll tick / duplicate handoff — ignore.
    if (trackId === this.registeredTrackId) return;

    console.log("[LinerLore TRACE] registerTrack — releasing break locks", {
      trackId,
      previousBreakTrackId: this.lastBreakTrackId,
      wasRunning: this.running,
      breakExecutedForCurrentTrack: this.breakExecutedForCurrentTrack,
    });

    // Never abort a mid-flight Duck–Talk–Swell from a stale id race.
    if (this.running) return;

    this.registeredTrackId = trackId;
    // Spec: reset the per-track mutex ONLY when currentTrackId changes.
    if (this.currentTrackId !== trackId) {
      this.currentTrackId = trackId;
      this.breakExecutedForCurrentTrack = false;
    }
    this.releaseBreakLocks();

    // Instance-owned cadence counter — survives React remounts / HMR.
    this.songsSinceLastBreak += 1;

    // Always record what Spotify/Apple actually played — even when the break
    // is skipped — so the next lore recap names the real prior songs.
    await this.recordActualPlayback(trackId);

    const live = await this.buildLiveTrackInput(trackId);
    const studioCue = live ? this.findStudioBreakForTrack(live) : null;

    // Shared studio mixes only voice authored cue points — never invent LLM
    // filler between custom breaks.
    if (this.hasStudioManifest()) {
      if (!studioCue || !live) {
        console.log(
          "[SongHost] Studio manifest armed — skipping break (no cue for track)",
          { trackId },
        );
        return;
      }
      const warmedStudio = await this.takePrefetchForTrack(trackId);
      if (warmedStudio) {
        console.log(
          "[SongHost] Executing prefetched studio DJ break for track:",
          trackId,
        );
        this.rememberVoiceContext(warmedStudio.track);
        await this.executePrefetchedDjBreak(trackId, warmedStudio);
        return;
      }
      console.log("[SongHost] Running authored studio DJ break for track:", {
        trackId,
        hasAudioUrl: Boolean(studioCue.audioUrl),
        hasCustomText: Boolean(studioCue.customText && studioCue.voiceId),
      });
      await this.runDjBreakInternal(live);
      return;
    }

    const breakDue = this.isDjBreakDue();
    const warmed = await this.takePrefetchForTrack(trackId);
    if (warmed) {
      if (!breakDue) {
        // Prefetch was warmed for a later gap — do not force a break early.
        console.log(
          "[LinerLore TRACE Autopilot] Discarding prefetch — break not due",
          { trackId, djMode: this.djMode },
        );
        return;
      }
      console.log(
        "[LinerLore TRACE Autopilot] Executing prefetched DJ break for track:",
        trackId,
      );
      this.rememberVoiceContext(warmed.track);
      await this.executePrefetchedDjBreak(trackId, warmed);
      return;
    }

    // Safety net: no warmup, but station cadence says a break is due.
    if (breakDue && live) {
      console.log(
        "[LinerLore TRACE Autopilot] No prefetch — running live DJ break for track:",
        trackId,
      );
      // Call the internal path directly — awaiting `runDjBreak` here would
      // deadlock on `registerTrackWork` (we're already inside it).
      await this.runDjBreakInternal(live);
    }
  }

  private isDjBreakDue(): boolean {
    if (this.djMode === "no_dj" || this.djPacingFrequency <= 0) return false;
    return this.songsSinceLastBreak >= this.breakThreshold();
  }

  /** Match a live track to an authored studio break cue by playlist index. */
  private findStudioBreakForTrack(
    track: Pick<OrchestratorTrackInput, "title" | "artist" | "trackId">,
  ): StudioBreakCueInput | null {
    if (!this.hasStudioManifest()) return null;
    const title = track.title.trim().toLowerCase();
    const artist = track.artist.trim().toLowerCase();
    const trackId = track.trackId?.trim() ?? "";

    let index = this.studioPlaylist.findIndex(
      (entry) =>
        entry.title.toLowerCase() === title &&
        entry.artist.toLowerCase() === artist,
    );
    if (index < 0 && trackId) {
      index = this.studioPlaylist.findIndex(
        (entry) => entry.youtubeId && entry.youtubeId === trackId,
      );
    }
    if (index < 0) return null;
    return this.studioBreaksByTrackIndex.get(index) ?? null;
  }

  /**
   * Append the live companion track to {@link actualPlaybackHistory}.
   * Keeps the most recent {@link ACTUAL_PLAYBACK_HISTORY_LIMIT} entries.
   */
  private async recordActualPlayback(trackId: string): Promise<void> {
    let title = "";
    let artist = "";

    const live = await this.getCurrentlyPlayingTrack().catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return null;
    });

    if (live) {
      title = live.title?.trim() ?? "";
      artist = live.artist?.trim() ?? "";
    }

    if (!title || !artist) {
      const warmed =
        this.djPrefetchByTrackId.get(trackId)
        ?? (this.nextPrefetchKey
          ? this.djPrefetchByTrackId.get(this.nextPrefetchKey)
          : undefined);
      if (warmed?.track.title && warmed.track.artist) {
        title = warmed.track.title.trim();
        artist = warmed.track.artist.trim();
      }
    }

    if (!title || !artist) {
      console.warn(
        "[LinerLore TRACE] registerTrack — could not resolve title/artist for history",
        { trackId },
      );
      return;
    }

    this.actualPlaybackHistory = [
      ...this.actualPlaybackHistory,
      { title, artist, trackId },
    ].slice(-ACTUAL_PLAYBACK_HISTORY_LIMIT);

    console.log("[LinerLore TRACE] actualPlaybackHistory updated", {
      trackId,
      title,
      artist,
      length: this.actualPlaybackHistory.length,
    });

    // Lock-screen / notification controls track the live companion song.
    void this.syncMediaSession({
      title,
      artist,
      album: live?.album,
      albumArt: live?.albumArt,
    });
  }

  private rememberVoiceContext(track: OrchestratorTrackInput): void {
    if (track.voiceId) this.lastVoiceId = track.voiceId;
    if (track.personaId) {
      this.lastPersonaId = track.personaId;
      this.activePersonaId = track.personaId;
    }
    if (track.mode !== undefined) this.lastMode = track.mode;
  }

  /**
   * Stamp the live {@link activePersonaId} (+ resolved voice) onto a track
   * input so generate-script never sees a stale host after a mid-session switch.
   */
  private applyLivePersona(
    track: OrchestratorTrackInput,
  ): OrchestratorTrackInput {
    const personaId = this.activePersonaId ?? track.personaId ?? null;
    if (!personaId) return track;

    const host = resolveActiveHost(personaId, this.isPro);

    if (!this.isPro) {
      return {
        ...track,
        // Free sessions synthesize OpenAI audio as Sam / Maya / Alex only.
        personaId: host.personaId,
        voiceId: host.voiceId,
      };
    }

    const persona = getPersonaById(host.personaId);
    const resolvedPersonaId = persona?.id ?? host.personaId;
    const voiceId =
      host.voiceId
      || resolveTierAwareVoiceId(resolvedPersonaId, true)
      || persona?.elevenLabsVoiceId
      || persona?.voice
      || track.voiceId
      || this.lastVoiceId;
    if (!voiceId) return { ...track, personaId: resolvedPersonaId };

    return {
      ...track,
      personaId: resolvedPersonaId,
      voiceId,
    };
  }

  private markBreakExecuted(...trackIds: Array<string | null | undefined>): void {
    for (const raw of trackIds) {
      const id = raw?.trim();
      if (!id) continue;
      this.executedBreakTrackIds.add(id);
      this.lastBreakTrackId = id;
    }
  }

  /**
   * True once a DJ clip has started (or been committed) for the registered track
   * and we are no longer inside that break. Late LLM payloads must check this
   * before speaking. Mid-break (`running`) keeps the flag armed without
   * discarding the speech we just ducked for.
   */
  private shouldDiscardLateSpeechPayload(): boolean {
    return this.breakExecutedForCurrentTrack && !this.running;
  }

  /** Arm the per-track lock the instant a break begins playing (legacy path). */
  private markBreakPlaybackStarted(source: string): void {
    if (this.breakExecutedForCurrentTrack) return;
    this.breakExecutedForCurrentTrack = true;
    console.log("[LinerLore TRACE] breakExecutedForCurrentTrack = true", {
      source,
      trackId: this.currentTrackId ?? this.registeredTrackId ?? this.currentTrack?.trackId ?? null,
    });
  }

  /** Reset chatty-mode cadence only after a DJ break successfully completes. */
  private markBreakCompletedSuccessfully(): void {
    this.songsSinceLastBreak = 0;
  }

  private async buildLiveTrackInput(
    trackId: string,
  ): Promise<OrchestratorTrackInput | null> {
    const personaId = this.activePersonaId ?? this.lastPersonaId;
    let voiceId = this.lastVoiceId;
    if (personaId) {
      const mapped = resolveTierAwareVoiceId(personaId, this.isPro);
      if (mapped) {
        voiceId = mapped;
      } else if (this.isPro) {
        const persona = getPersonaById(personaId);
        voiceId =
          persona?.elevenLabsVoiceId
          ?? persona?.voice
          ?? voiceId;
      }
    }
    if (!voiceId) return null;

    const live = await this.getCurrentlyPlayingTrack().catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return null;
    });

    if (live) {
      const liveId =
        this.provider === "spotify"
          ? normalizeSpotifyTrackId(live.uri) ||
            normalizeSpotifyTrackId(live.id) ||
            live.id ||
            trackId
          : live.id || trackId;
      return this.applyLivePersona({
        trackId: liveId,
        title: live.title,
        artist: live.artist,
        album: live.album,
        voiceId,
        personaId: personaId ?? undefined,
        mode: this.lastMode,
      });
    }

    return null;
  }

  /**
   * Prefer an exact trackId hit; otherwise consume the Autopilot lookahead
   * only when its title/artist matches the live Spotify/Apple item.
   *
   * Queue seeds key prefetch by youtubeId while `registerTrack` often sees the
   * Spotify catalog id — never steal the *next* song's warmup on a rematch.
   */
  private async takePrefetchForTrack(trackId: string): Promise<{
    key: string;
    track: OrchestratorTrackInput;
    promise: Promise<DjBreakScriptResponse>;
  } | null> {
    const exact = this.djPrefetchByTrackId.get(trackId);
    if (exact) {
      this.djPrefetchByTrackId.delete(trackId);
      if (this.nextPrefetchKey === trackId) this.nextPrefetchKey = null;
      return { key: trackId, ...exact };
    }

    const pendingKey = this.nextPrefetchKey;
    if (!pendingKey) return null;
    const pending = this.djPrefetchByTrackId.get(pendingKey);
    if (!pending) {
      this.nextPrefetchKey = null;
      return null;
    }

    const live = await this.getCurrentlyPlayingTrack().catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return null;
    });
    if (!live || !this.prefetchMatchesLiveTrack(pending.track, live)) {
      return null;
    }

    this.djPrefetchByTrackId.delete(pendingKey);
    this.nextPrefetchKey = null;
    return { key: pendingKey, ...pending };
  }

  private prefetchMatchesLiveTrack(
    warmed: OrchestratorTrackInput,
    live: NormalizedMusicTrack,
  ): boolean {
    const liveTitle = live.title.trim().toLowerCase();
    const liveArtist = live.artist.trim().toLowerCase();
    const warmedTitle = warmed.title.trim().toLowerCase();
    const warmedArtist = warmed.artist.trim().toLowerCase();
    if (!liveTitle || !warmedTitle) return false;
    return liveTitle === warmedTitle && liveArtist === warmedArtist;
  }

  private async executePrefetchedDjBreak(
    trackId: string,
    warmed: {
      key: string;
      track: OrchestratorTrackInput;
      promise: Promise<DjBreakScriptResponse>;
    },
  ): Promise<void> {
    // Station open must speak the fast liner — never a warmed LLM clip.
    if (this.sessionLaunchPending) {
      console.log(
        "[LinerLore TRACE] Discarding prefetch for station launch liner",
        { trackId },
      );
      await this.runDjBreakInternal(warmed.track, { force: true });
      return;
    }

    if (this.running) return;
    if (this.shouldDiscardLateSpeechPayload()) {
      console.log(
        "[LinerLore TRACE] Discarding prefetch — break already executed for track",
        { trackId },
      );
      return;
    }

    // Re-stash so resolveDjAudio can claim the warmed clip under the new
    // duration-first Mode A/B path (takePrefetchForTrack already removed it).
    this.djPrefetchByTrackId.set(warmed.key, {
      track: warmed.track,
      promise: warmed.promise,
    });
    this.nextPrefetchKey = warmed.key;
    this.rememberVoiceContext(warmed.track);
    await this.runDjBreakInternal(warmed.track, { force: true });
  }

  /**
   * Abort an in-flight DJ clip and hard-reset music volume when ducked / paused.
   */
  stopDjAudio(): void {
    this.releaseBreakLocks();
    // Do not clearDjPrefetch() here — autopilot may have already warmed the
    // next track's lore while this clip is aborted.
    if (this.musicPausedForBreak) {
      void this.resumeActivePlayer().finally(() => {
        this.musicPausedForBreak = false;
      });
    } else if (this.musicDucked) {
      void this.resetMusicVolume();
    }
    this.stopStationBed({ revokeUrl: false });
    if (
      this.broadcastState !== "IDLE"
      && this.broadcastState !== "PLAYING_MUSIC"
      && this.broadcastState !== "PREFETCHING_BREAK"
    ) {
      this.setBroadcastState("PLAYING_MUSIC");
    }
  }

  /** Active duck / pause policy for the live `commentaryFormat`. */
  getBreakTransitionPolicy(): BreakTransitionPolicy {
    return resolveBreakTransitionPolicy(this.commentaryFormat);
  }

  /**
   * Manual override: immediately bypass `songsSinceLastBreak`, duck Spotify to
   * {@link SPOTIFY_DUCK_RATIO}, and play/fetch a live DJ break for the current track.
   * Always stamps the live {@link activePersonaId} into generate-script.
   */
  async triggerBreakNow(): Promise<RunDjBreakResult> {
    await this.registerTrackWork;

    let trackId = this.registeredTrackId?.trim() || "";
    if (!trackId) {
      const live = await this.getCurrentlyPlayingTrack().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return null;
      });
      trackId = live?.id?.trim() || "";
    }

    if (!trackId) {
      const error = new Error("No current track available for a manual DJ break");
      this.onError?.(error);
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    const live = await this.buildLiveTrackInput(trackId);
    if (!live) {
      const error = new Error(
        "Cannot trigger DJ break — voice context not ready (prefetch or persona required)",
      );
      this.onError?.(error);
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    // Manual breaks always use the live persona — drop any stale prefetch
    // warmed under a previous host voice.
    const withLivePersona = this.applyLivePersona(live);
    this.rememberVoiceContext(withLivePersona);
    this.flushPrefetch();
    // Manual re-fire is allowed even if this track already voiced once.
    this.breakExecutedForCurrentTrack = false;

    if (this.djMode === "no_dj") {
      console.log("[LinerLore TRACE] triggerBreakNow — skipped (no_dj)");
      return {
        ok: false,
        reason: "PLAYBACK_FAILED",
        error: new Error("DJ mode is No DJ — Music Only"),
      };
    }

    console.log("[LinerLore TRACE] triggerBreakNow — bypassing cadence", {
      trackId,
      personaId: withLivePersona.personaId,
      songsSinceLastBreak: this.songsSinceLastBreak,
      djMode: this.djMode,
    });

    return this.runDjBreakInternal(withLivePersona, { force: true });
  }

  /**
   * Manual override: stop active DJ audio, cancel prefetch requests, and
   * restore music volume to the captured pre-break level immediately.
   */
  skipActiveBreak(): void {
    console.log("[LinerLore TRACE] skipActiveBreak — aborting DJ break", {
      status: this.status,
      wasRunning: this.running,
      musicPausedForBreak: this.musicPausedForBreak,
    });
    this.resetBreakAbortController("Station relaunch");
    this.abortPrefetchRequests();
    this.clearDjPrefetch();
    this.releaseBreakLocks();
    if (this.musicPausedForBreak) {
      void this.resumeActivePlayer()
        .catch((err) => {
          console.error("[LinerLore TRACE ERROR]", err);
          return false;
        })
        .finally(() => {
          this.musicPausedForBreak = false;
        });
    } else {
      void this.resetMusicVolume().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
    }
    this.setStatus("STANDBY");
  }

  /**
   * Read the active transport volume on a normalized 0.0–1.0 scale.
   * Spotify: Web Playback SDK / Connect REST. Apple Music: MusicKit player.
   */
  async getCurrentVolume(): Promise<number> {
    if (this.provider === "spotify") {
      const token = await this.resolveSpotifyToken();
      return getCurrentSpotifyVolume(token);
    }

    try {
      const kit = await getAppleMusicKit();
      const vol =
        typeof kit.player.volume === "number"
          ? kit.player.volume
          : kit.volume;
      if (typeof vol === "number" && Number.isFinite(vol)) {
        return clampSpotifyVolumeNormalized(vol);
      }
    } catch (error) {
      console.warn("[LinerLore] Apple Music getCurrentVolume failed", error);
    }
    return 1;
  }

  /**
   * Music-bed transport volume only (Spotify / Apple Music).
   * Deliberately does **not** touch {@link masterVolume} / speech gain — duck
   * and swell ramps must never compound into DJ voice
   * (`userVol * ttsVol * duckScalar`).
   */
  private async setTransportVolume(
    vol: number,
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    const clamped = clampSpotifyVolumeNormalized(vol);
    console.log("[TELEMETRY: SDK Volume]", clamped);

    if (this.provider === "spotify") {
      const token = await this.resolveSpotifyToken();
      const result = await setSpotifyVolume(token, clamped);
      if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
      return result === true;
    }

    try {
      const kit = await getAppleMusicKit();
      // MusicKit JS expects 0.0–1.0 on the player (and often the instance).
      kit.player.volume = clamped;
      kit.volume = clamped;
      return true;
    } catch (error) {
      console.warn("[LinerLore] Apple Music setVolume failed", error);
      return false;
    }
  }

  /**
   * Listener fader: sync speech master + music transport together.
   * Duck/swell paths must call {@link setTransportVolume} instead so speech
   * stays at the ControlDeck baseline ({@link SPEECH_BASELINE_GAIN} range).
   */
  async setVolume(
    vol: number,
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    const clamped = clampSpotifyVolumeNormalized(vol);
    this.setMasterVolume(clamped);
    return this.setTransportVolume(clamped);
  }

  /**
   * Smooth fade for Spotify or Apple Music ducking / swell.
   * Mode A duck uses `"linear"`; swells / Mode B fades use `"log"`.
   */
  private async rampMusicVolume(
    fromVolume: number,
    toVolume: number,
    durationMs: number,
    signal?: AbortSignal,
    curve: "linear" | "log" = "log",
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    if (this.provider === "spotify" && curve === "log") {
      const token = await this.resolveSpotifyToken();
      const result = await rampSpotifyVolume(
        token,
        fromVolume,
        toVolume,
        durationMs,
        signal ? { signal } : undefined,
      );
      if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
      return result === true;
    }

    const steps = 12;
    const from = clampSpotifyVolumeNormalized(fromVolume);
    const to = clampSpotifyVolumeNormalized(toVolume);
    const safeDuration =
      typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
        ? durationMs
        : SPOTIFY_DUCK_RAMP_MS;
    const intervalMs = safeDuration / steps;
    let lastOk: true | false | "NO_ACTIVE_DEVICE" = true;

    console.log("[LinerLore TRACE] rampMusicVolume", {
      provider: this.provider,
      from,
      to,
      durationMs: safeDuration,
      steps,
      intervalMs,
      curve,
    });

    for (let i = 1; i <= steps; i++) {
      if (signal?.aborted) {
        console.log("[LinerLore TRACE] rampMusicVolume aborted", { step: i });
        break;
      }

      const t = i / steps;
      const current =
        curve === "linear"
          ? lerpVolumeLinear(from, to, t)
          : lerpSpotifyVolumeLog(from, to, t);
      lastOk = await this.setTransportVolume(current);
      if (lastOk !== true) return lastOk;

      if (i < steps) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, intervalMs);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          if (signal) {
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      }
    }

    if (signal?.aborted) return lastOk;
    return this.setTransportVolume(to);
  }

  async getCurrentlyPlayingTrack(): Promise<NormalizedMusicTrack | null> {
    if (this.provider === "spotify") {
      const token = await this.resolveSpotifyToken();
      const live = await getCurrentlyPlaying(token);
      return live ? normalizeSpotifyCompanionTrack(live) : null;
    }

    try {
      const kit = await getAppleMusicKit();
      const normalized = normalizeMusicKitMediaItem(kit.player.nowPlayingItem);
      if (!normalized) {
        // Fallback through the thin remote mapper when MediaItem shape differs.
        const fallback = await getCurrentlyPlayingAppleMusic();
        if (!fallback) return null;
        return normalizeMusicKitMediaItem({
          id: fallback.id,
          title: fallback.name,
          artistName: fallback.artistName,
          albumName: fallback.albumName,
          artworkURL: fallback.artworkUrl,
          playbackDuration: fallback.durationMs,
          attributes: {
            name: fallback.name,
            artistName: fallback.artistName,
            albumName: fallback.albumName,
            durationInMillis: fallback.durationMs,
            artwork: fallback.artworkUrl
              ? { url: fallback.artworkUrl }
              : undefined,
          },
        });
      }
      return {
        ...normalized,
        isPlaying: Boolean(kit.player.isPlaying),
      };
    } catch (error) {
      console.warn("[LinerLore] Apple Music now-playing lookup failed", error);
      return null;
    }
  }

  /**
   * Immediate flush of DJ audio, prefetch buffers, and track identity so a
   * manual station / mix launch can never play stale lore from a previous
   * session. Call ONLY from explicit UI launches ({@link launchStation}) —
   * never from automated queue progression (`playNextTrack`, Spotify
   * `player_state_changed` track-end, or autopilot advances).
   */
  flushForStationLaunch(): void {
    console.log("[LinerLore TRACE] flushForStationLaunch — clearing prior session", {
      hadCurrentTrack: Boolean(this.currentTrack),
      prefetchCount: this.djPrefetchByTrackId.size,
      wasRunning: this.running,
      sessionEpoch: this.sessionEpoch,
    });
    // Kill in-flight generate-script / TTS before any new URI starts.
    this.bumpSessionEpoch("Station relaunch");
    this.abortPrefetchRequests();
    this.abortVolumeRamp();
    this.clearDjPrefetch();
    this.running = false;
    this.currentTrack = null;
    this.activeTrack = null;
    this.lastBreakTrackId = null;
    this.breakExecutedForCurrentTrack = false;
    this.executedBreakTrackIds.clear();
    this.registeredTrackId = null;
    this.currentTrackId = null;
    this.songsSinceLastBreak = 0;
    this.sessionLaunchPending = true;
    this.scriptContext = {
      stationName: this.stationName,
    };
    this.actualPlaybackHistory = [];
    // Preserve the live host across station/URI flushes; re-resolve voice from
    // the roster so a mid-session persona pick is not wiped by playTrack.
    const preservedPersonaId = this.activePersonaId ?? this.lastPersonaId;
    this.lastVoiceId = null;
    this.lastPersonaId = null;
    this.lastMode = undefined;
    if (preservedPersonaId) {
      this.setPersona(preservedPersonaId, { skipAbort: true });
    } else {
      this.activePersonaId = null;
    }
    this.clearScriptTranscripts();
    // Drop any queued registerTrack / script work from the prior session.
    this.registerTrackWork = Promise.resolve();
    // Restore ducked volume using preBreakVolume before clearing the capture.
    if (this.musicDucked) {
      void this.resetMusicVolume()
        .catch((err) => {
          console.error("[LinerLore TRACE ERROR]", err);
          return false;
        })
        .finally(() => {
          this.preBreakVolume = null;
        });
    } else {
      this.preBreakVolume = null;
    }
    this.setBroadcastState("IDLE");
  }

  /**
   * Force the active Spotify device onto a concrete URI.
   * Does NOT flush session state or bump {@link sessionEpoch} — safe for
   * automated queue advances that must keep prefetched DJ breaks valid.
   */
  async playSpotifyUri(trackUri: string): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    if (this.provider !== "spotify") {
      throw new Error("playSpotifyUri is only available for the Spotify provider");
    }
    this.startSilentAnchor();
    this.bindMediaSessionHandlers();
    const token = await this.resolveSpotifyToken();
    const result = await playSpotify(token, { uris: [trackUri] });
    if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
    if (result === true) {
      this.startSilentAnchor();
      this.setMediaSessionPlaybackState("playing");
      void this.syncMediaSession();
    }
    return result === true;
  }

  /**
   * Start Spotify playback on one or more track URIs (Connect / Web Playback).
   * Does NOT flush session state or bump {@link sessionEpoch} — prefetched DJ
   * breaks remain valid across automated track transitions. Use
   * {@link launchStation} for manual station / mix launches.
   *
   * Also the transport used by {@link steerToStationUri} to snap Autoplay
   * hijacks back onto the station queue without mutating React queue state.
   */
  async playTrack(
    uri: string | string[],
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    if (this.provider !== "spotify") {
      throw new Error("playTrack is only available for the Spotify provider");
    }
    const uris = (Array.isArray(uri) ? uri : [uri])
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!uris.length) return false;

    // Gesture may already have primed the anchor; keep it alive across await.
    this.startSilentAnchor();
    this.bindMediaSessionHandlers();

    const token = await this.resolveSpotifyToken();
    const result = await playSpotify(token, { uris });
    if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
    if (result === true) {
      this.pausedIntent = false;
      this.startSilentAnchor();
      this.setMediaSessionPlaybackState("playing");
      void this.syncMediaSession();
    }
    return result === true;
  }

  /**
   * Force Spotify Connect / Web Playback back onto a known station-queue URI
   * after SDK Autoplay (or any unrecognized track) hijacked the stream.
   * Does NOT flush {@link sessionEpoch} — this is a correction, not a launch.
   */
  async steerToStationUri(
    uri: string | string[],
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    const uris = (Array.isArray(uri) ? uri : [uri])
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!uris.length) return false;
    if (this.stationSteerInFlightUri === uris[0]) return true;
    this.stationSteerInFlightUri = uris[0] ?? null;
    try {
      return await this.playTrack(uris);
    } finally {
      this.stationSteerInFlightUri = null;
    }
  }

  /**
   * Manual station / mix launch: flush prior session state (bumps
   * {@link sessionEpoch}, clears prefetched breaks), then play the URI(s).
   * Do not use for automated queue progression.
   */
  async launchStation(
    uri: string | string[],
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    // Flush synchronously before play so relaunch invalidates prior speech
    // even if playTrack early-returns on empty URIs.
    this.flushForStationLaunch();
    return this.playTrack(uri);
  }

  /**
   * Seeded Song Radio companion launch: requested track URI at index 0, then
   * Spotify recommendation URIs (energy-matched via `seed_tracks`). Dedupes the
   * seed if it also appears in the recommendation list. Opening DJ break uses
   * URI[0] metadata so the host announces the listener's requested song.
   *
   * Heavy Rotation (top listening history) uses {@link launchStation} with a
   * fixed URI list instead — same opener-first invariant, no seed/rec split.
   */
  async launchSeededSongRadio(
    seedUri: string,
    recommendationUris: readonly string[] = [],
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    const seed = seedUri.trim();
    if (!seed) return false;

    const seedId = normalizeSpotifyTrackId(seed);
    const tail = recommendationUris
      .map((uri) => uri.trim())
      .filter(Boolean)
      .filter((uri) => {
        const id = normalizeSpotifyTrackId(uri);
        return !seedId || !id || id !== seedId;
      });

    return this.launchStation([seed, ...tail]);
  }

  /**
   * Drop warmed DJ clips and abort any in-flight generate-script / TTS so a
   * queue clear cannot leave zombie audio prefetches playing.
   */
  clearQueue(): void {
    this.resetBreakAbortController("Station relaunch");
    this.abortPrefetchRequests();
    this.abortVolumeRamp();
    this.clearDjPrefetch();
    this.running = false;
    this.currentTrack = null;
    this.activeTrack = null;
    this.nextPrefetchKey = null;
    this.stopSilentAnchor();
    this.setMediaSessionPlaybackState("none");
    this.setStatus("STANDBY");
  }

  /**
   * Resolve title/artist → Spotify URI, then start playback on the active device.
   */
  async playCatalogTrack(input: {
    title: string;
    artist: string;
    uri?: string | null;
  }): Promise<
    | { ok: true; uri: string }
    | { ok: false; reason: "NO_ACTIVE_DEVICE" | "URI_NOT_FOUND" | "PLAY_FAILED" }
  > {
    if (this.provider !== "spotify") {
      return { ok: false, reason: "PLAY_FAILED" };
    }

    const token = await this.resolveSpotifyToken();
    const uri =
      input.uri?.trim() ||
      (await searchSpotifyTrackUri(token, input.title, input.artist));
    if (!uri) {
      return { ok: false, reason: "URI_NOT_FOUND" };
    }

    const played = await this.playSpotifyUri(uri);
    if (played === "NO_ACTIVE_DEVICE") {
      this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
      return { ok: false, reason: "NO_ACTIVE_DEVICE" };
    }
    if (!played) {
      return { ok: false, reason: "PLAY_FAILED" };
    }
    return { ok: true, uri };
  }

  /**
   * Warm the DJ lore clip for an upcoming queue track during the near-end
   * window so autopilot can Duck–Talk–Swell without waiting on TTS at the cut.
   */
  async prefetchDjBreak(
    track: OrchestratorTrackInput,
    context?: DjScriptContext,
  ): Promise<void> {
    const normalized = this.normalizeTrackForBreak(track);
    if (!normalized) return;
    const key = normalized.trackId;
    if (this.djMode === "no_dj") {
      console.log("[LinerLore TRACE] Autopilot skip prefetch — no_dj", {
        trackId: key,
      });
      return;
    }
    if (this.djPrefetchByTrackId.has(key)) return;

    const studioCue = this.findStudioBreakForTrack(normalized);
    if (this.hasStudioManifest()) {
      if (!studioCue) {
        console.log("[SongHost] Autopilot skip prefetch — no studio cue", {
          trackId: key,
        });
        return;
      }
    } else if (!this.willBreakOnNextTrack()) {
      // Cadence gate: skip warmup when the next advance will not voice a break.
      console.log("[LinerLore TRACE] Autopilot skip prefetch — break not due", {
        trackId: key,
        djMode: this.djMode,
        songsSinceLastBreak: this.songsSinceLastBreak,
        threshold: this.breakThreshold(),
      });
      return;
    }

    this.rememberVoiceContext(normalized);
    if (context) this.setScriptContext(context);

    console.log("[LinerLore TRACE] Autopilot prefetch DJ break", {
      trackId: key,
      title: normalized.title,
      artist: normalized.artist,
      studioCue: Boolean(studioCue),
      recentHistory:
        this.actualPlaybackHistory.length
        || (this.scriptContext.recentHistory?.length ?? 0),
      upcomingQueue: this.scriptContext.upcomingQueue?.length ?? 0,
    });

    if (this.status === "STANDBY") {
      this.setStatus("PREFETCHING");
    }

    const prefetchSignal = this.beginPrefetchAbort();
    const signal = this.combineAbortSignals(
      this.breakAbortSignal(),
      prefetchSignal,
    );
    const pending = (
      studioCue
        ? this.resolveStudioBreakAudio(normalized, studioCue, signal).then(
            (payload) => {
              if (!payload) {
                return this.fetchDjAudio(
                  normalized,
                  this.scriptContext,
                  signal,
                );
              }
              return payload;
            },
          )
        : this.fetchDjAudio(normalized, this.scriptContext, signal)
    ).catch((err) => {
        this.djPrefetchByTrackId.delete(key);
        if (this.nextPrefetchKey === key) this.nextPrefetchKey = null;
        if (WebOrchestrator.isAbortError(err)) {
          console.log("[LinerLore] Aborted stale DJ break");
        } else {
          console.error("[LinerLore TRACE ERROR]", err);
        }
        throw err;
      });
    this.djPrefetchByTrackId.set(key, { track: normalized, promise: pending });
    this.nextPrefetchKey = key;

    try {
      await pending;
    } catch {
      // Prefetch is best-effort — live runDjBreak / registerTrack fallback will retry.
    } finally {
      if (this.status === "PREFETCHING" && !this.running) {
        this.setStatus("STANDBY");
      }
    }
  }

  /** Drop any warmed clips (station switch / teardown). */
  clearDjPrefetch(): void {
    this.djPrefetchByTrackId.clear();
    this.nextPrefetchKey = null;
  }

  /** Full teardown of break debounce state (station switch). */
  resetBreakSession(): void {
    this.bumpSessionEpoch("Station relaunch");
    this.abortPrefetchRequests();
    this.releaseBreakLocks();
    this.clearDjPrefetch();
    this.currentTrack = null;
    this.activeTrack = null;
    this.lastBreakTrackId = null;
    this.breakExecutedForCurrentTrack = false;
    this.executedBreakTrackIds.clear();
    this.registeredTrackId = null;
    this.currentTrackId = null;
    this.songsSinceLastBreak = 0;
    this.sessionLaunchPending = true;
    this.scriptContext = {
      stationName: this.stationName,
    };
    this.actualPlaybackHistory = [];
    const preservedPersonaId = this.activePersonaId ?? this.lastPersonaId;
    this.lastVoiceId = null;
    this.lastPersonaId = null;
    this.lastMode = undefined;
    this.preBreakVolume = null;
    if (preservedPersonaId) {
      this.setPersona(preservedPersonaId, { skipAbort: true });
    } else {
      this.activePersonaId = null;
    }
    this.clearScriptTranscripts();
    this.registerTrackWork = Promise.resolve();
    this.setBroadcastState("IDLE");
  }

  /**
   * Synchronously normalize `track.trackId` from a Spotify URI (or bare id)
   * *before* constructing the R2 cache key or calling generate-script.
   * Also stamps {@link currentTrack} / {@link activeTrack} so title, artist,
   * and trackId always refer to the same object for TTS.
   */
  private normalizeTrackForBreak(
    track: OrchestratorTrackInput,
    uriHint?: string | null,
  ): OrchestratorTrackInput | null {
    const title = track.title?.trim() ?? "";
    const artist = track.artist?.trim() ?? "";
    const rawId = track.trackId?.trim() ?? "";
    const fromHint = uriHint ? normalizeSpotifyTrackId(uriHint) : null;
    const fromTrackId = rawId ? normalizeSpotifyTrackId(rawId) : null;
    // Prefer a clean Spotify catalog id; fall back to the seed id (youtubeId)
    // only when no Spotify URI/id is available.
    const trackId = fromHint || fromTrackId || rawId;

    if (!title || !artist || !trackId) {
      console.warn(
        "[LinerLore TRACE] normalizeTrackForBreak — incoherent track object",
        { title, artist, trackId, rawId, uriHint },
      );
      return null;
    }

    const normalized: OrchestratorTrackInput = {
      ...track,
      trackId,
      title,
      artist,
      album: track.album?.trim() || track.album,
    };

    // Synchronous stamp — must land before any async R2 / LLM work.
    this.currentTrack = normalized;
    this.activeTrack = normalized;

    console.log("[LinerLore TRACE] normalizeTrackForBreak", {
      trackId: normalized.trackId,
      title: normalized.title,
      artist: normalized.artist,
      fromHint,
      fromTrackId,
      rawId: rawId !== trackId ? rawId : undefined,
    });

    return normalized;
  }

  /**
   * Full DJ break cycle for the given track + voice.
   * Spotify and Apple Music: duck → talk → swell via {@link rampMusicVolume}.
   */
  async runDjBreak(
    track: OrchestratorTrackInput,
    context?: DjScriptContext,
  ): Promise<RunDjBreakResult> {
    // Let Autopilot registerTrack finish executing a warmed clip first so we
    // do not double-fire Duck–Talk–Swell on the same transition.
    await this.registerTrackWork;
    if (context) this.setScriptContext(context);
    return this.runDjBreakInternal(track);
  }

  private async runDjBreakInternal(
    track: OrchestratorTrackInput,
    options?: { force?: boolean },
  ): Promise<RunDjBreakResult> {
    // Normalize id from URI/id *before* R2 cache key / LLM script generation.
    const normalized = this.normalizeTrackForBreak(track);
    if (!normalized) {
      const error = new Error(
        "DJ break aborted — title, artist, and trackId must refer to the same track",
      );
      this.onError?.(error);
      return { ok: false, reason: "SCRIPT_FAILED", error };
    }

    const trackId = normalized.trackId;
    const force = options?.force === true;
    this.rememberVoiceContext(normalized);
    if (force) {
      // Manual / launch re-entry may speak again on the same registered track.
      this.breakExecutedForCurrentTrack = false;
    }

    // Music-only: never duck / fetch / play DJ audio.
    if (this.djMode === "no_dj") {
      console.log("[LinerLore TRACE] Skipping DJ break — no_dj", { trackId });
      return {
        ok: false,
        reason: "PLAYBACK_FAILED",
        error: new Error("DJ mode is No DJ — Music Only"),
      };
    }

    // Strict track-ID debounce: one break per trackId per session (includes
    // aliases recorded when registerTrack consumed a prefetch).
    // Manual `triggerBreakNow` bypasses this so the host can re-fire on demand.
    if (
      !force &&
      trackId &&
      (trackId === this.lastBreakTrackId ||
        this.executedBreakTrackIds.has(trackId) ||
        this.breakExecutedForCurrentTrack)
    ) {
      console.log(
        "[LinerLore TRACE] Skipping DJ break — already executed for trackId",
        { trackId, breakExecutedForCurrentTrack: this.breakExecutedForCurrentTrack },
      );
      return {
        ok: false,
        reason: "PLAYBACK_FAILED",
        error: new Error("DJ break already executed for this track"),
      };
    }

    if (this.running) {
      const error = new Error("A DJ break is already in progress");
      this.onError?.(error);
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    // Clear sticky Track-1 locks / stale Audio element before every new break.
    this.releaseBreakLocks();

    // First voiced break of a flushed/idle session → fast launch liner.
    if (this.executedBreakTrackIds.size === 0) {
      this.sessionLaunchPending = true;
    }

    this.running = true;
    if (trackId) {
      this.markBreakExecuted(trackId);
      if (this.currentTrackId !== trackId) {
        this.currentTrackId = trackId;
        this.breakExecutedForCurrentTrack = false;
      }
    }

    const requestEpoch = this.sessionEpoch;

    try {
      // Nudge AudioContext so a suspended graph cannot mute Track 2+ TTS.
      try {
        getMasterAnalyser().unlock();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
      const audioContext = { state: getMasterAnalyser().getAudioContextState() };
      console.log("[LinerLore TRACE 2] AudioContext state:", audioContext.state, {
        trackId: trackId || "(none)",
        requestEpoch,
      });

      this.setBroadcastState("PREFETCHING_BREAK");

      // Spec: fetch + probe TTS duration BEFORE any Mode A/B transition.
      const scriptPayload = await this.resolveDjAudio(
        this.currentTrack ?? normalized,
      );
      if (requestEpoch !== this.sessionEpoch) {
        console.log("[LinerLore TRACE] Discarding speech — sessionEpoch mismatch", {
          requestEpoch,
          sessionEpoch: this.sessionEpoch,
          trackId,
        });
        this.setBroadcastState("PLAYING_MUSIC");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error: new Error("Discarded stale DJ speech (session epoch mismatch)"),
        };
      }
      if (this.shouldDiscardLateSpeechPayload()) {
        console.log(
          "[LinerLore TRACE] Discarding late LLM speech payload for track",
          { trackId },
        );
        this.setBroadcastState("PLAYING_MUSIC");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error: new Error("DJ break already executed for this track"),
        };
      }
      if (this.breakAbortSignal().aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.setBroadcastState("PLAYING_MUSIC");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error: new Error("Aborted stale DJ break"),
        };
      }
      if (!scriptPayload.audioUrl) {
        const error = new Error("generate-script response missing audioUrl");
        this.onError?.(error);
        this.setBroadcastState("PLAYING_MUSIC");
        return { ok: false, reason: "SCRIPT_FAILED", error };
      }

      const probed = await probeAudioDurationSeconds(
        scriptPayload.audioUrl,
        this.breakAbortSignal(),
      );
      const ttsDurationSec = probed ?? FALLBACK_DJ_AUDIO_DURATION_SEC;
      console.log("[LinerLore TRACE] TTS duration probed for mode routing", {
        trackId,
        ttsDurationSec,
        mode: ttsDurationSec > MODE_A_DURATION_THRESHOLD_SEC ? "B" : "A",
      });

      if (requestEpoch !== this.sessionEpoch) {
        console.log("[LinerLore TRACE] Discarding speech after probe — epoch mismatch", {
          requestEpoch,
          sessionEpoch: this.sessionEpoch,
        });
        this.setBroadcastState("PLAYING_MUSIC");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error: new Error("Discarded stale DJ speech (session epoch mismatch)"),
        };
      }

      if (ttsDurationSec > MODE_A_DURATION_THRESHOLD_SEC) {
        return await this.runModeBTransition(scriptPayload, requestEpoch);
      }
      return await this.runModeATransition(scriptPayload, requestEpoch);
    } catch (caught) {
      if (WebOrchestrator.isAbortError(caught) || this.breakAbortSignal().aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.setBroadcastState("PLAYING_MUSIC");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error:
            caught instanceof Error
              ? caught
              : new Error("Aborted stale DJ break"),
        };
      }
      const error =
        caught instanceof Error ? caught : new Error("DJ break orchestration failed");
      console.error("[LinerLore TRACE ERROR]", caught);
      this.onError?.(error);
      // If we ducked before the failure escaped, never leave music quiet.
      await this.resetMusicVolume().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
      this.stopStationBed();
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "SCRIPT_FAILED", error };
    } finally {
      this.running = false;
      this.disposeDjAudio();
    }
  }

  /**
   * Relative duck floor matching the YouTube mix-bus invariant:
   * `clamp(preBreakVolume * duckRatio)` — never an absolute device percent.
   */
  private companionDuckTarget(
    preBreakVolume: number,
    duckRatio: number = DUCK_RATIO,
  ): number {
    return clampSpotifyVolumeNormalized(preBreakVolume * duckRatio);
  }

  /**
   * Mode A (TTS ≤ 15s): duck outgoing → speak in-band → logarithmic swell.
   * FSM: MODE_A_DUCKING → MODE_A_SPEAKING → MODE_A_SWELLING → PLAYING_MUSIC.
   */
  private async runModeATransition(
    scriptPayload: DjBreakScriptResponse,
    requestEpoch: number,
  ): Promise<RunDjBreakResult> {
    const duckRatio = resolveModeADuckRatio(this.mood);
    const swellMs = resolveModeASwellMs(this.mood);
    const preBreakVolume = await this.getCurrentVolume();
    this.preBreakVolume = preBreakVolume;
    const duckTarget = this.companionDuckTarget(preBreakVolume, duckRatio);
    this.breakDuckTarget = duckTarget;

    this.setBroadcastState("MODE_A_DUCKING");
    const duckSignal = this.beginVolumeRamp();
    const ducked = await this.rampMusicVolume(
      preBreakVolume,
      duckTarget,
      MODE_A_DUCK_RAMP_MS,
      duckSignal,
      "linear",
    );
    if (ducked === "NO_ACTIVE_DEVICE") {
      this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "NO_ACTIVE_DEVICE" };
    }
    if (ducked !== true) {
      const error = new Error(
        `Failed to duck the active ${this.provider === "spotify" ? "Spotify" : "Apple Music"} player`,
      );
      this.onError?.(error);
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "DUCK_FAILED", error };
    }
    this.musicDucked = true;

    if (requestEpoch !== this.sessionEpoch || this.breakAbortSignal().aborted) {
      await this.resetMusicVolume().catch(() => false);
      this.setBroadcastState("PLAYING_MUSIC");
      return {
        ok: false,
        reason: "PLAYBACK_FAILED",
        error: new Error("Discarded stale DJ speech (session epoch mismatch)"),
      };
    }

    try {
      this.setBroadcastState("MODE_A_SPEAKING");
      await this.playFreshDjClip(scriptPayload.audioUrl, {
        speakingState: "MODE_A_SPEAKING",
        requestEpoch,
      });

      if (requestEpoch !== this.sessionEpoch) {
        await this.resetMusicVolume().catch(() => false);
        this.setBroadcastState("PLAYING_MUSIC");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error: new Error("Discarded stale DJ speech (session epoch mismatch)"),
        };
      }

      this.setBroadcastState("MODE_A_SWELLING");
      const swellSignal = this.beginVolumeRamp();
      const swelled = await this.rampMusicVolume(
        duckTarget,
        this.preBreakVolume ?? preBreakVolume,
        swellMs,
        swellSignal,
        "log",
      );
      if (swelled === "NO_ACTIVE_DEVICE" || swelled !== true) {
        if (swelled === "NO_ACTIVE_DEVICE") {
          this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
        }
        const error = new Error(
          `Failed to restore ${this.provider === "spotify" ? "Spotify" : "Apple Music"} volume after Mode A break`,
        );
        this.onError?.(error);
        await this.resetMusicVolume().catch(() => false);
        this.setBroadcastState("PLAYING_MUSIC");
        return { ok: false, reason: "SWELL_FAILED", error };
      }
      this.musicDucked = false;
      this.breakDuckTarget = null;
    } catch (playError) {
      const error =
        playError instanceof Error
          ? playError
          : new Error("Failed to play DJ audio clip");
      this.onError?.(error);
      await this.resetMusicVolume().catch(() => false);
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    this.markBreakCompletedSuccessfully();
    this.setBroadcastState("PLAYING_MUSIC");
    this.onDjEnd?.();
    void this.syncMediaSession();
    return {
      ok: true,
      audioUrl: scriptPayload.audioUrl,
      script: scriptPayload.script,
      cached: scriptPayload.cached,
    };
  }

  /**
   * Mode B (TTS > 15s): fade to station bed → speak → decay bed + hard launch.
   * FSM: MODE_B_BED_FADE → MODE_B_SPEAKING → MODE_B_LAUNCH → PLAYING_MUSIC.
   *
   * Empty / unloadable TTS must abort *before* any Spotify volume ramp so music
   * stays at full listening level.
   */
  private async runModeBTransition(
    scriptPayload: DjBreakScriptResponse,
    requestEpoch: number,
  ): Promise<RunDjBreakResult> {
    // Probe loadability first — never rampSpotifyVolume → 0% on dead audio.
    try {
      await this.assertDjAudioLoadable(
        scriptPayload.audioUrl,
        this.breakAbortSignal(),
      );
    } catch (loadError) {
      const error =
        loadError instanceof Error
          ? loadError
          : new Error("DJ audio element failed to load");
      console.error(
        "[LinerLore TRACE ERROR] Mode B aborted — TTS unloadable; keeping music at 100%",
        error,
      );
      this.onError?.(error);
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    const preBreakVolume = await this.getCurrentVolume();
    this.preBreakVolume = preBreakVolume;
    this.breakDuckTarget = 0;

    this.setBroadcastState("MODE_B_BED_FADE");
    const fadeSignal = this.beginVolumeRamp();
    // Fade outgoing track to 0 while bringing genre bed up to 0.25.
    const fadePromise = this.rampMusicVolume(
      preBreakVolume,
      0,
      MODE_B_FADE_MS,
      fadeSignal,
      "log",
    );
    const bedPromise = this.startStationBed(MODE_B_BED_GAIN, MODE_B_FADE_MS);
    const faded = await fadePromise;
    await bedPromise;
    if (faded === "NO_ACTIVE_DEVICE") {
      this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
      this.stopStationBed();
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "NO_ACTIVE_DEVICE" };
    }
    if (faded !== true) {
      const error = new Error(
        `Failed to fade ${this.provider === "spotify" ? "Spotify" : "Apple Music"} for Mode B bed`,
      );
      this.onError?.(error);
      this.stopStationBed();
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "DUCK_FAILED", error };
    }
    this.musicDucked = true;

    // Pre-roll incoming track silently (hold at 0 while speech runs).
    await this.setTransportVolume(0).catch(() => false);

    if (requestEpoch !== this.sessionEpoch || this.breakAbortSignal().aborted) {
      this.stopStationBed();
      await this.resetMusicVolume().catch(() => false);
      this.setBroadcastState("PLAYING_MUSIC");
      return {
        ok: false,
        reason: "PLAYBACK_FAILED",
        error: new Error("Discarded stale DJ speech (session epoch mismatch)"),
      };
    }

    try {
      this.setBroadcastState("MODE_B_SPEAKING");
      await this.playFreshDjClip(scriptPayload.audioUrl, {
        speakingState: "MODE_B_SPEAKING",
        requestEpoch,
        onNearEnd: () => {
          void this.decayStationBed(MODE_B_BED_DECAY_MS);
        },
        nearEndMs: MODE_B_BED_DECAY_MS,
      });

      if (requestEpoch !== this.sessionEpoch) {
        this.stopStationBed();
        await this.resetMusicVolume().catch(() => false);
        this.setBroadcastState("PLAYING_MUSIC");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error: new Error("Discarded stale DJ speech (session epoch mismatch)"),
        };
      }

      this.setBroadcastState("MODE_B_LAUNCH");
      this.stopStationBed();
      const launchLevel = this.preBreakVolume ?? SPOTIFY_UNDUCKED_GAIN;
      const launched = await this.setTransportVolume(launchLevel);
      if (this.musicPausedForBreak) {
        await this.resumeActivePlayer().catch(() => false);
        this.musicPausedForBreak = false;
      }
      if (launched === "NO_ACTIVE_DEVICE" || launched !== true) {
        if (launched === "NO_ACTIVE_DEVICE") {
          this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
        }
        const error = new Error(
          `Failed to hard-launch ${this.provider === "spotify" ? "Spotify" : "Apple Music"} after Mode B break`,
        );
        this.onError?.(error);
        await this.resetMusicVolume().catch(() => false);
        this.setBroadcastState("PLAYING_MUSIC");
        return { ok: false, reason: "SWELL_FAILED", error };
      }
      this.musicDucked = false;
      this.breakDuckTarget = null;
    } catch (playError) {
      const error =
        playError instanceof Error
          ? playError
          : new Error("Failed to play DJ audio clip");
      this.onError?.(error);
      this.stopStationBed();
      // Abort Mode B cleanly — restore Spotify to full listening level.
      await this.resetMusicVolume().catch(() => false);
      this.setBroadcastState("PLAYING_MUSIC");
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    this.markBreakCompletedSuccessfully();
    this.setBroadcastState("PLAYING_MUSIC");
    this.onDjEnd?.();
    void this.syncMediaSession();
    return {
      ok: true,
      audioUrl: scriptPayload.audioUrl,
      script: scriptPayload.script,
      cached: scriptPayload.cached,
    };
  }

  /** Build a short looping soft-noise WAV for Mode B station beds. */
  private ensureStationBedObjectUrl(): string {
    if (this.stationBedObjectUrl) return this.stationBedObjectUrl;
    const sampleRate = 22050;
    const seconds = 2;
    const frames = sampleRate * seconds;
    const dataSize = frames * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    let pink = 0;
    for (let i = 0; i < frames; i++) {
      const white = Math.random() * 2 - 1;
      pink = 0.98 * pink + 0.02 * white;
      const sample = Math.max(-1, Math.min(1, pink * 0.35));
      view.setInt16(44 + i * 2, (sample * 0x7fff) | 0, true);
    }
    const blob = new Blob([buffer], { type: "audio/wav" });
    this.stationBedObjectUrl = URL.createObjectURL(blob);
    return this.stationBedObjectUrl;
  }

  /** Fade in the genre station bed loop to `targetGain` over `rampMs`. */
  private async startStationBed(
    targetGain: number = MODE_B_BED_GAIN,
    rampMs: number = MODE_B_FADE_MS,
  ): Promise<void> {
    if (typeof Audio === "undefined") return;
    this.stopStationBed({ revokeUrl: false });
    const audio = new Audio(this.ensureStationBedObjectUrl());
    audio.loop = true;
    audio.volume = 0;
    this.stationBedAudio = audio;
    try {
      await audio.play();
    } catch (err) {
      console.warn("[LinerLore] Station bed play() failed", err);
      return;
    }
    const steps = 12;
    const interval = Math.max(16, rampMs / steps);
    for (let i = 1; i <= steps; i++) {
      if (!this.stationBedAudio) return;
      this.stationBedAudio.volume = clampSpotifyVolumeNormalized(
        lerpVolumeLinear(0, targetGain, i / steps),
      );
      if (i < steps) {
        await new Promise((r) => setTimeout(r, interval));
      }
    }
  }

  /** Decay station bed volume + pitch over the final speech window. */
  private async decayStationBed(
    durationMs: number = MODE_B_BED_DECAY_MS,
  ): Promise<void> {
    const audio = this.stationBedAudio;
    if (!audio) return;
    const fromVol = audio.volume;
    const fromRate = audio.playbackRate || 1;
    const steps = 8;
    const interval = Math.max(16, durationMs / steps);
    for (let i = 1; i <= steps; i++) {
      if (this.stationBedAudio !== audio) return;
      const t = i / steps;
      audio.volume = clampSpotifyVolumeNormalized(lerpVolumeLinear(fromVol, 0, t));
      audio.playbackRate = Math.max(0.5, lerpVolumeLinear(fromRate, 0.7, t));
      if (i < steps) {
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    this.stopStationBed({ revokeUrl: false });
  }

  private stopStationBed(options?: { revokeUrl?: boolean }): void {
    const audio = this.stationBedAudio;
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
      this.stationBedAudio = null;
    }
    if (options?.revokeUrl !== false && this.stationBedObjectUrl) {
      try {
        URL.revokeObjectURL(this.stationBedObjectUrl);
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
      this.stationBedObjectUrl = null;
    }
  }

  /**
   * Latest playhead from the shared SDK / REST stamp. Used to decide whether
   * a break is still inside the instrumental intro window.
   */
  private resolvePlaybackPositionMs(): number {
    const positionMs = getCurrentTrackState()?.positionMs;
    if (typeof positionMs === "number" && Number.isFinite(positionMs) && positionMs >= 0) {
      return positionMs;
    }
    return 0;
  }

  /**
   * Optimistic A/C choice before clip duration is known. Extended lore and
   * cold vocal intros pause; otherwise duck (Scenario A) until finalize.
   */
  private resolveOptimisticBreakScenario(
    policy: BreakTransitionPolicy,
    introDurationSec: number,
  ): DjBreakExecutionScenario {
    if (policy.pauseMusic || introDurationSec < COLD_VOCAL_INTRO_THRESHOLD_SEC) {
      return "hard_pause";
    }
    return "intro_ramp";
  }

  /**
   * Refine the optimistic hold once TTS duration is known. May upgrade a duck
   * hold into a hard pause when the DJ clip outlasts the instrumental intro.
   */
  private async finalizeBreakScenario(input: {
    policy: BreakTransitionPolicy;
    track: OrchestratorTrackInput;
    introDurationSec: number;
    audioUrl: string;
  }): Promise<DjBreakExecutionScenario> {
    if (input.policy.pauseMusic) return "hard_pause";

    const probed = await probeAudioDurationSeconds(
      input.audioUrl,
      this.breakAbortSignal(),
    );
    const djAudioDurationSec = probed ?? FALLBACK_DJ_AUDIO_DURATION_SEC;
    const positionMs = this.resolvePlaybackPositionMs();
    const positionSec = positionMs / 1000;
    const durationMs = getCurrentTrackState()?.durationMs;
    const durationSec =
      typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
        ? durationMs / 1000
        : 0;
    const remainingSec =
      durationSec > 0 ? Math.max(0, durationSec - positionSec) : 0;
    // Outro bed: playhead past the intro with a short instrumental tail left.
    const remainingInstrumentalSec =
      positionSec > input.introDurationSec
      && remainingSec > 0
      && remainingSec <= Math.max(djAudioDurationSec + 1, 8)
        ? remainingSec
        : null;

    const scenario = resolveDjBreakExecutionScenario({
      introDurationSec: input.introDurationSec,
      djAudioDurationSec,
      remainingInstrumentalSec,
    });

    console.log("[LinerLore TRACE] Break execution scenario", {
      trackId: input.track.trackId,
      introDurationSec: input.introDurationSec,
      djAudioDurationSec,
      remainingInstrumentalSec,
      scenario,
      positionSec,
    });

    if (scenario === "hard_pause" && !this.musicPausedForBreak) {
      const paused = await this.pauseActivePlayer();
      if (paused === true) {
        this.musicPausedForBreak = true;
      }
    }

    return scenario;
  }

  /**
   * Duck or pause the bed **before** awaiting live TTS so unducked vocals
   * cannot establish under silence-to-speech latency. Idempotent when a hold
   * is already active from an earlier call in the same break.
   *
   * Scenario A/B duck to 18%. Scenario C / extended lore / Track #0 cold start
   * hard-pause. There is no blanket pause for “playhead past N seconds”.
   */
  private async beginMusicHoldForBreak(
    policy: BreakTransitionPolicy,
    scenario: DjBreakExecutionScenario,
  ): Promise<RunDjBreakResult | null> {
    if (this.musicDucked || this.musicPausedForBreak) return null;

    const preBreakVolume = await this.getCurrentVolume();
    this.preBreakVolume = preBreakVolume;
    const duckTarget = this.companionDuckTarget(preBreakVolume, policy.duckRatio);
    this.breakDuckTarget = duckTarget;
    const positionMs = this.resolvePlaybackPositionMs();
    const launchVocalsAtStart =
      this.sessionLaunchPending
      && shouldPauseForStationLaunchVocals(positionMs);
    const shouldPause =
      policy.pauseMusic
      || scenario === "hard_pause"
      || launchVocalsAtStart;

    console.log("[LinerLore TRACE] Captured preBreakVolume", {
      provider: this.provider,
      preBreakVolume,
      duckTarget,
      duckRatio: policy.duckRatio,
      commentaryFormat: policy.commentaryFormat,
      pauseMusic: policy.pauseMusic,
      positionMs,
      scenario,
      sessionLaunchPending: this.sessionLaunchPending,
      launchVocalsAtStart,
      shouldPause,
    });

    this.setStatus("DUCKING");

    if (shouldPause) {
      console.log("[LinerLore TRACE] Hard-pause hold (Scenario C / extended)", {
        provider: this.provider,
        commentaryFormat: policy.commentaryFormat,
        ambientFloor: duckTarget,
        preBreakVolume,
        positionMs,
        scenario,
        launchVocalsAtStart,
        extendedFormat: policy.pauseMusic,
      });
      const paused = await this.pauseActivePlayer();
      if (paused === "NO_ACTIVE_DEVICE") {
        this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
        this.setStatus("STANDBY");
        return { ok: false, reason: "NO_ACTIVE_DEVICE" };
      }
      if (paused === true) {
        this.musicPausedForBreak = true;
        return null;
      }
      // Pause unavailable — hold the relative ambient floor instead.
    }

    console.log("[TELEMETRY: Duck Start]", {
      duckRatio: policy.duckRatio,
      duckTarget,
      durationMs: SPOTIFY_DUCK_RAMP_MS,
      positionMs,
      scenario,
      stationLaunch: this.sessionLaunchPending,
    });
    const rampSignal = this.beginVolumeRamp();
    const ducked = await this.rampMusicVolume(
      preBreakVolume,
      duckTarget,
      SPOTIFY_DUCK_RAMP_MS,
      rampSignal,
    );
    if (ducked === "NO_ACTIVE_DEVICE") {
      this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
      this.setStatus("STANDBY");
      return { ok: false, reason: "NO_ACTIVE_DEVICE" };
    }
    if (ducked !== true) {
      const error = new Error(
        `Failed to duck the active ${this.provider === "spotify" ? "Spotify" : "Apple Music"} player`,
      );
      console.error("[LinerLore TRACE ERROR]", error);
      this.onError?.(error);
      this.setStatus("STANDBY");
      return { ok: false, reason: "DUCK_FAILED", error };
    }
    this.musicDucked = true;
    return null;
  }

  /**
   * Format-aware host transition for Spotify and Apple Music.
   * Music must already be held via {@link beginMusicHoldForBreak} (duck/pause
   * during TTS wait). This step speaks, then swells / resumes.
   * - intro_ramp → Duck–Talk–Swell with {@link INTRO_RAMP_RESTORE_MS}
   * - outro_duck → Duck–Talk–Swell, incoming resumes at full on `ended`
   * - hard_pause / extended → Pause–Talk–Resume
   */
  private async runDuckTalkSwell(
    scriptPayload: DjBreakScriptResponse,
    scenario: DjBreakExecutionScenario = "intro_ramp",
  ): Promise<RunDjBreakResult> {
    if (this.shouldDiscardLateSpeechPayload()) {
      console.log(
        "[LinerLore TRACE] Discarding late LLM speech payload before playback",
        {
          trackId: this.registeredTrackId ?? this.currentTrack?.trackId ?? null,
        },
      );
      await this.resetMusicVolume().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
      this.setStatus("STANDBY");
      return {
        ok: false,
        reason: "PLAYBACK_FAILED",
        error: new Error("DJ break already executed for this track"),
      };
    }

    const policy = resolveBreakTransitionPolicy(this.commentaryFormat);
    // Ensure hold even if a caller skipped beginMusicHoldForBreak (manual paths).
    const holdError = await this.beginMusicHoldForBreak(policy, scenario);
    if (holdError) return holdError;

    // Vocal-safe holds may pause even on standard formats — resume via the
    // pause path so we never swell a still-paused player.
    if (
      policy.pauseMusic
      || scenario === "hard_pause"
      || this.musicPausedForBreak
    ) {
      return this.runPauseTalkResume(scriptPayload, policy);
    }
    return this.runStandardDuckTalkSwell(scriptPayload, policy, scenario);
  }

  /** Extended lore: resume (or swell from ambient) after the host speaks. */
  private async runPauseTalkResume(
    scriptPayload: DjBreakScriptResponse,
    policy: BreakTransitionPolicy,
  ): Promise<RunDjBreakResult> {
    const audioUrl = scriptPayload.audioUrl;
    const preBreakVolume = this.preBreakVolume ?? (await this.getCurrentVolume());
    const duckTarget =
      this.breakDuckTarget
      ?? this.companionDuckTarget(preBreakVolume, policy.duckRatio);

    try {
      await this.playFreshDjClip(audioUrl);

      this.setStatus("RAMPING_UP");
      if (this.musicPausedForBreak) {
        const resumed = await this.resumeActivePlayer();
        this.musicPausedForBreak = false;
        if (!resumed) {
          const error = new Error(
            `Failed to resume ${this.provider === "spotify" ? "Spotify" : "Apple Music"} after extended DJ break`,
          );
          console.error("[LinerLore TRACE ERROR]", error);
          this.onError?.(error);
          this.setStatus("STANDBY");
          return { ok: false, reason: "SWELL_FAILED", error };
        }
      } else {
        const swellSignal = this.beginVolumeRamp();
        const swelled = await this.rampMusicVolume(
          duckTarget,
          this.preBreakVolume ?? preBreakVolume,
          SPOTIFY_RESTORE_RAMP_MS,
          swellSignal,
        );
        if (swelled === "NO_ACTIVE_DEVICE" || swelled !== true) {
          if (swelled === "NO_ACTIVE_DEVICE") {
            this.onNoActiveDevice?.({
              success: false,
              reason: "NO_ACTIVE_DEVICE",
            });
          }
          const error = new Error(
            `Failed to restore ${this.provider === "spotify" ? "Spotify" : "Apple Music"} volume after extended DJ break`,
          );
          console.error("[LinerLore TRACE ERROR]", error);
          this.onError?.(error);
          await this.resetMusicVolume().catch((err) => {
            console.error("[LinerLore TRACE ERROR]", err);
            return false;
          });
          this.setStatus("STANDBY");
          return { ok: false, reason: "SWELL_FAILED", error };
        }
        this.musicDucked = false;
        this.breakDuckTarget = null;
      }
    } catch (playError) {
      const error =
        playError instanceof Error
          ? playError
          : new Error("Failed to play DJ audio clip");
      console.error("[LinerLore TRACE ERROR]", playError);
      this.onError?.(error);
      if (this.musicPausedForBreak) {
        await this.resumeActivePlayer().catch((err) => {
          console.error("[LinerLore TRACE ERROR]", err);
          return false;
        });
        this.musicPausedForBreak = false;
      } else {
        await this.resetMusicVolume().catch((err) => {
          console.error("[LinerLore TRACE ERROR]", err);
          return false;
        });
      }
      this.setStatus("STANDBY");
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    this.markBreakCompletedSuccessfully();
    this.setStatus("STANDBY");
    this.onDjEnd?.();
    void this.syncMediaSession();

    return {
      ok: true,
      audioUrl: scriptPayload.audioUrl,
      script: scriptPayload.script,
      cached: scriptPayload.cached,
    };
  }

  /** Standard short breaks: speak under a relative duck, then swell. */
  private async runStandardDuckTalkSwell(
    scriptPayload: DjBreakScriptResponse,
    policy: BreakTransitionPolicy,
    scenario: DjBreakExecutionScenario = "intro_ramp",
  ): Promise<RunDjBreakResult> {
    const audioUrl = scriptPayload.audioUrl;
    const preBreakVolume = this.preBreakVolume ?? (await this.getCurrentVolume());
    const duckTarget =
      this.breakDuckTarget
      ?? this.companionDuckTarget(preBreakVolume, policy.duckRatio);
    // Scenario A: 800ms intro ramp. Outro duck keeps the legacy 600ms swell.
    const restoreMs =
      scenario === "intro_ramp" ? INTRO_RAMP_RESTORE_MS : SPOTIFY_RESTORE_RAMP_MS;

    try {
      // Fresh TTS Audio element per break — reusing a buffered element after
      // Track 1 can leave the browser player stuck and mute Tracks 2+.
      // Resolves only on speech `ended` (+ tail cushion), never a duration timeout.
      await this.playFreshDjClip(audioUrl);

      // Perceptual fade up ducked → preBreakVolume ONLY after the speech
      // completion Promise (including its 300ms tail cushion) has resolved.
      this.setStatus("RAMPING_UP");
      const swellSignal = this.beginVolumeRamp();
      const swelled = await this.rampMusicVolume(
        duckTarget,
        this.preBreakVolume ?? preBreakVolume,
        restoreMs,
        swellSignal,
      );
      if (swelled === "NO_ACTIVE_DEVICE" || swelled !== true) {
        if (swelled === "NO_ACTIVE_DEVICE") {
          this.onNoActiveDevice?.({
            success: false,
            reason: "NO_ACTIVE_DEVICE",
          });
        }
        const error = new Error(
          `Failed to restore ${this.provider === "spotify" ? "Spotify" : "Apple Music"} volume after DJ break`,
        );
        console.error("[LinerLore TRACE ERROR]", error);
        this.onError?.(error);
        await this.resetMusicVolume().catch((err) => {
          console.error("[LinerLore TRACE ERROR]", err);
          return false;
        });
        this.setStatus("STANDBY");
        return { ok: false, reason: "SWELL_FAILED", error };
      }
      console.log("[TELEMETRY: Duck Restore]");
      this.musicDucked = false;
      this.breakDuckTarget = null;
    } catch (playError) {
      const error =
        playError instanceof Error
          ? playError
          : new Error("Failed to play DJ audio clip");
      console.error("[LinerLore TRACE ERROR]", playError);
      this.onError?.(error);
      // Hard reset — do not leave the listener at the ducked level.
      await this.resetMusicVolume().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
      this.setStatus("STANDBY");
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    this.markBreakCompletedSuccessfully();
    this.setStatus("STANDBY");
    this.onDjEnd?.();
    // Refresh lock-screen metadata once the host finishes talking.
    void this.syncMediaSession();

    return {
      ok: true,
      audioUrl: scriptPayload.audioUrl,
      script: scriptPayload.script,
      cached: scriptPayload.cached,
    };
  }

  /**
   * Prefer a warmed autopilot prefetch for this trackId; otherwise claim a
   * shared `prefetchedBreaksMap` clip from the station-queue engine; otherwise
   * fetch live. Studio cues with `audioUrl` / `customText`+`voiceId` short-circuit LLM.
   * Station-launch Track #0 bypasses the LLM with {@link getStationLaunchLiner}.
   */
  private async resolveDjAudio(
    track: OrchestratorTrackInput,
  ): Promise<DjBreakScriptResponse> {
    const studioCue = this.findStudioBreakForTrack(track);
    if (studioCue) {
      const studioPayload = await this.resolveStudioBreakAudio(
        track,
        studioCue,
        this.breakAbortSignal(),
      );
      if (studioPayload) {
        this.sessionLaunchPending = false;
        return studioPayload;
      }
    }

    // Track #0 station open: skip LLM + prefetch and TTS the fast liner.
    if (this.sessionLaunchPending) {
      this.sessionLaunchPending = false;
      const coherent = this.applyLivePersona(
        this.normalizeTrackForBreak(track) ?? track,
      );
      const voiceId = coherent.voiceId?.trim();
      if (!voiceId) {
        throw new Error(
          "Station launch liner requires a resolved voiceId for customText TTS",
        );
      }
      const customText = getStationLaunchLiner(
        this.scriptContext.stationName ?? this.stationName,
        coherent.artist,
        coherent.title,
      );
      console.log("[LinerLore TRACE] Station launch liner — bypassing LLM", {
        trackId: coherent.trackId,
        stationName: this.stationName,
        customTextChars: customText.length,
      });
      return this.fetchDjAudio(
        coherent,
        this.scriptContext,
        this.breakAbortSignal(),
        { customText, voiceId },
      );
    }

    const key = track.trackId.trim();
    const warmed = key ? await this.takePrefetchForTrack(key) : null;
    if (warmed) {
      console.log("[LinerLore TRACE] Using prefetched DJ break", {
        trackId: key,
        prefetchKey: warmed.key,
      });
      return warmed.promise;
    }

    const shared = this.takeSharedPrefetchedBreak(track);
    if (shared) {
      console.log("[LinerLore TRACE] Using shared prefetchedBreaksMap clip", {
        trackId: key,
        sharedKey: shared.trackKey,
      });
      return {
        audioUrl: URL.createObjectURL(shared.audioBlob),
        script: shared.script,
        cached: true,
      };
    }

    return this.fetchDjAudio(
      track,
      this.scriptContext,
      this.breakAbortSignal(),
    );
  }

  /**
   * Claim a zero-latency clip from the station-queue {@link prefetchedBreaksMap}.
   * Exact trackId first, then title/artist so youtube-keyed warmups still hit
   * when registerTrack only has a Spotify catalog id.
   */
  private takeSharedPrefetchedBreak(track: OrchestratorTrackInput) {
    return getSharedDjBreakPrefetchEngine().takeForTrack({
      trackKey: track.trackId,
      title: track.title,
      artist: track.artist,
    });
  }

  /**
   * Resolve authored studio break audio:
   * 1. Pre-rendered `audioUrl` (R2 MP3) → play that exact file
   * 2. `customText` + `voiceId` → TTS the authored copy with that voice
   * Returns null when the cue has no playable payload (caller falls through).
   */
  private async resolveStudioBreakAudio(
    track: OrchestratorTrackInput,
    cue: StudioBreakCueInput,
    signal?: AbortSignal,
  ): Promise<DjBreakScriptResponse | null> {
    const fetchSignal = this.combineAbortSignals(
      this.breakAbortSignal(),
      signal,
    );

    if (cue.audioUrl) {
      console.log("[SongHost] Using pre-rendered studio break audioUrl", {
        trackId: track.trackId,
        trackIndex: cue.trackIndex,
      });
      let audioUrl = cue.audioUrl;
      if (!audioUrl.startsWith("blob:")) {
        try {
          audioUrl = await this.fetchAudioObjectUrl(audioUrl, fetchSignal);
        } catch (err) {
          if (WebOrchestrator.isAbortError(err) || fetchSignal.aborted) {
            throw err instanceof Error
              ? err
              : new DOMException("Aborted stale DJ break", "AbortError");
          }
          if (WebOrchestrator.isEmptyTtsBufferError(err)) {
            throw err;
          }
          console.warn(
            "[SongHost] Studio audio download failed; using direct URL",
            err,
          );
        }
      }
      if (cue.customText?.trim()) {
        this.publishScriptText(track.title, track.artist, cue.customText);
      }
      return {
        audioUrl,
        script: cue.customText,
        cached: true,
      };
    }

    const customText = cue.customText?.trim();
    const voiceId = cue.voiceId?.trim();
    if (customText && voiceId) {
      console.log("[SongHost] Synthesizing studio customText with authored voiceId", {
        trackId: track.trackId,
        trackIndex: cue.trackIndex,
        voiceId,
      });
      // Pass customText + voiceId only — omit personaId so Jasper/Kira defaults
      // cannot override the authored host voice in generate-script.
      return this.fetchDjAudio(
        {
          ...track,
          voiceId,
          personaId: undefined,
        },
        this.scriptContext,
        fetchSignal,
        { customText, voiceId },
      );
    }

    return null;
  }

  private async fetchDjAudio(
    track: OrchestratorTrackInput,
    context: DjScriptContext = this.scriptContext,
    signal?: AbortSignal,
    studioOverride?: { customText: string; voiceId: string },
  ): Promise<DjBreakScriptResponse> {
    const fetchSignal = this.combineAbortSignals(
      this.breakAbortSignal(),
      signal,
    );
    // Prefer the synchronously stamped currentTrack (normalized Spotify id)
    // so the R2 key / LLM payload never carries a prior session's id.
    const base =
      this.currentTrack
      && this.currentTrack.trackId === track.trackId.trim()
      && this.currentTrack.title === track.title.trim()
      && this.currentTrack.artist === track.artist.trim()
        ? this.currentTrack
        : this.normalizeTrackForBreak(track);

    if (!base) {
      throw new Error(
        "generate-script aborted — title, artist, and trackId must belong to the same track",
      );
    }

    // Authored studio scripts keep the cue's voiceId; do not remap via persona.
    const coherent = studioOverride
      ? {
          ...base,
          voiceId: studioOverride.voiceId,
          personaId: undefined,
        }
      : this.applyLivePersona(base);
    this.currentTrack = coherent;
    this.activeTrack = coherent;
    this.rememberVoiceContext(coherent);

    // Prefer exact Spotify/Apple playback history so recaps name songs that
    // actually aired — fall back to queue-sourced context only when empty.
    // Filter out current track ID so recentHistory only contains truly past tracks.
    const currentTrackId = coherent.trackId;
    const pastTracksOnly =
      this.actualPlaybackHistory.length > 0
        ? this.actualPlaybackHistory.filter((t) => t.trackId !== currentTrackId)
        : context.recentHistory;
    const recentHistory = normalizeTrackRefs(
      pastTracksOnly,
      ACTUAL_PLAYBACK_HISTORY_LIMIT,
    );
    const upcomingQueue = normalizeTrackRefs(context.upcomingQueue, 2);
    console.log("[LinerLore TRACE 3] Requesting DJ script/TTS...", {
      title: coherent.title,
      artist: coherent.artist,
      trackId: coherent.trackId,
      personaId: coherent.personaId,
      customText: studioOverride ? "[set]" : undefined,
      recentHistory: recentHistory.length,
      upcomingQueue: upcomingQueue.length,
      fromActualPlayback: this.actualPlaybackHistory.length > 0,
    });
    const resolvedHostId = studioOverride
      ? undefined
      : resolveActiveHost(
          coherent.personaId
            ?? this.activePersonaId
            ?? coherent.voiceId
            ?? "miles",
          this.isPro,
        ).personaId;

    let response: Response;
    try {
      const clientTimeZone =
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;
      response = await fetch(this.scriptEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientTimeZone ? { "x-client-timezone": clientTimeZone } : {}),
        },
        body: JSON.stringify({
          trackId: coherent.trackId,
          // Authored studio voice wins via studioOverride; otherwise live persona
          // (Free Mode already stamped Sam/Maya/Alex + OpenAI voiceId).
          voiceId: studioOverride?.voiceId ?? coherent.voiceId,
          // Omit personaId/hostId for studio customText so roster defaults cannot win.
          ...(studioOverride
            ? { customText: studioOverride.customText }
            : {
                // Explicit host override — never fall back to station defaults.
                hostId: resolvedHostId,
                personaId: resolvedHostId,
              }),
          tier: this.isPro ? "pro" : "free",
          title: coherent.title,
          artist: coherent.artist,
          album: coherent.album,
          mode: coherent.mode,
          djMode: this.djMode,
          mood: this.mood,
          personality: this.personality,
          knowledge: this.knowledge,
          allowExplicit: this.allowExplicit,
          commentaryFormat: this.commentaryFormat,
          recentHistory,
          upcomingQueue,
        }),
        signal: fetchSignal,
      });
    } catch (err) {
      if (WebOrchestrator.isAbortError(err) || fetchSignal.aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        throw err instanceof Error
          ? err
          : new DOMException("Aborted stale DJ break", "AbortError");
      }
      throw err;
    }

    if (fetchSignal.aborted) {
      console.log("[LinerLore] Aborted stale DJ break");
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `generate-script failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    const payload = (await response.json()) as DjBreakScriptResponse;

    if (fetchSignal.aborted) {
      console.log("[LinerLore] Aborted stale DJ break");
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }

    // A fast liner (or earlier clip) already aired for this track — drop the
    // late LLM payload so we never double-speak on the same transition.
    if (this.shouldDiscardLateSpeechPayload()) {
      console.log(
        "[LinerLore TRACE] Discarding late LLM speech payload after fetch",
        { trackId: coherent.trackId, hostId: resolvedHostId },
      );
      throw new DOMException(
        "Discarded late DJ speech payload for current track",
        "AbortError",
      );
    }

    // Best-effort: download ElevenLabs / CDN audio under the abort signal so a
    // station relaunch cancels the body. Fall back to the direct URL when CORS
    // blocks fetch — HTMLAudioElement can still play cross-origin media.
    // Empty buffers must NOT fall back: abort before any Mode A/B volume ramp.
    if (payload.audioUrl && !payload.audioUrl.startsWith("blob:")) {
      try {
        payload.audioUrl = await this.fetchAudioObjectUrl(
          payload.audioUrl,
          fetchSignal,
        );
      } catch (err) {
        if (WebOrchestrator.isAbortError(err) || fetchSignal.aborted) {
          console.log("[LinerLore] Aborted stale DJ break");
          throw err instanceof Error
            ? err
            : new DOMException("Aborted stale DJ break", "AbortError");
        }
        if (WebOrchestrator.isEmptyTtsBufferError(err)) {
          console.error(
            "[LinerLore TRACE ERROR] Empty TTS buffer — aborting break before Mode A/B",
            err,
          );
          throw err;
        }
        console.warn(
          "[LinerLore] DJ audio download failed; using direct URL",
          err,
        );
      }
    }

    if (payload.audioUrl) {
      console.log("[LinerLore TRACE 4] DJ Voice audioUrl:", payload.audioUrl);
    }

    // Never push script / UI state for a canceled break.
    if (fetchSignal.aborted) {
      console.log("[LinerLore] Aborted stale DJ break");
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }

    if (typeof payload.script === "string" && payload.script.trim()) {
      this.publishScriptText(coherent.title, coherent.artist, payload.script);
    }

    return payload;
  }

  /**
   * Fetch TTS / CDN audio as a blob object URL so downloads honor AbortSignal.
   * Rejects empty buffers so Mode B never fades Spotify on unusable audio.
   */
  private async fetchAudioObjectUrl(
    audioUrl: string,
    signal: AbortSignal,
  ): Promise<string> {
    const audioResponse = await fetch(audioUrl, { signal });
    if (signal.aborted) {
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }
    if (!audioResponse.ok) {
      throw new Error(`DJ audio download failed (${audioResponse.status})`);
    }
    const arrayBuffer = await audioResponse.arrayBuffer();
    if (signal.aborted) {
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error("TTS API returned an empty array buffer");
    }
    console.log(
      "[LinerLore TRACE] TTS arrayBuffer.byteLength:",
      arrayBuffer.byteLength,
    );
    const contentType =
      audioResponse.headers.get("content-type") || "audio/mpeg";
    const blob = new Blob([arrayBuffer], { type: contentType });
    return URL.createObjectURL(blob);
  }

  /** True when a TTS download failure must abort Mode A/B (never duck/fade). */
  private static isEmptyTtsBufferError(err: unknown): boolean {
    return (
      err instanceof Error
      && /empty array buffer/i.test(err.message)
    );
  }

  /** Immediate volume restore used on DJ load/play failure or abort. */
  private async resetMusicVolume(): Promise<boolean> {
    this.abortVolumeRamp();
    // Extended holds may have paused before TTS resolved — resume first.
    if (this.musicPausedForBreak) {
      const resumed = await this.resumeActivePlayer().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
      this.musicPausedForBreak = false;
      this.breakDuckTarget = null;
      if (resumed) {
        this.musicDucked = false;
        return true;
      }
    }
    try {
      // Restore the captured pre-break level — never force 1.0 (volume creep).
      const restoreLevel = this.preBreakVolume ?? SPOTIFY_UNDUCKED_GAIN;
      const result = await this.setTransportVolume(restoreLevel);
      if (result === true) {
        this.musicDucked = false;
        this.breakDuckTarget = null;
        return true;
      }
      if (result === "NO_ACTIVE_DEVICE") {
        this.musicDucked = false;
        this.breakDuckTarget = null;
        return false;
      }
      return false;
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
      return false;
    }
  }

  private beginVolumeRamp(): AbortSignal {
    this.abortVolumeRamp();
    this.volumeRampAbort = new AbortController();
    return this.volumeRampAbort.signal;
  }

  private abortVolumeRamp(): void {
    if (!this.volumeRampAbort) return;
    try {
      this.volumeRampAbort.abort();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
    this.volumeRampAbort = null;
  }

  private beginPrefetchAbort(): AbortSignal {
    this.abortPrefetchRequests();
    this.prefetchAbort = new AbortController();
    return this.prefetchAbort.signal;
  }

  private abortPrefetchRequests(): void {
    if (!this.prefetchAbort) return;
    try {
      this.prefetchAbort.abort();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
    this.prefetchAbort = null;
  }

  /**
   * Tear down the live TTS speech nodes so the next break always gets a fresh
   * `AudioBufferSourceNode` (one-shot nodes cannot be restarted).
   */
  private disposeDjAudio(): void {
    const source = this.activeSpeechSource;
    const gain = this.activeSpeechGain;
    this.activeSpeechSource = null;
    this.activeSpeechGain = null;
    if (gain) {
      try {
        // Fade to silence before stop/disconnect to avoid a hard-edge click.
        setGainSmooth(gain.gain, 0, gain.context, GAIN_SMOOTH_TIME_CONSTANT);
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
    }
    if (source) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already stopped / never started.
      }
      try {
        source.disconnect();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
    }

    const audio = this.activeDjAudio;
    if (!audio) return;
    try {
      audio.onended = null;
      audio.oncanplay = null;
      audio.onerror = null;
      audio.onpause = null;
      audio.onplay = null;
      audio.pause();
      const src = audio.src;
      // Revoke blob:/object URLs so a prior session's buffer cannot replay.
      if (src && src.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(src);
        } catch (err) {
          console.error("[LinerLore TRACE ERROR]", err);
        }
      }
      audio.removeAttribute("src");
      // Force the element to drop its media resource.
      audio.load();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
    this.activeDjAudio = null;
  }

  /**
   * Confirm TTS media can load before Mode B fades Spotify to 0%.
   * Rejects on empty/corrupt blobs or metadata load errors.
   * (Playback itself always uses {@link playFreshDjClip} / AudioBufferSourceNode.)
   */
  private assertDjAudioLoadable(
    audioUrl: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (typeof Audio === "undefined") {
      return Promise.reject(new Error("HTML5 Audio is not available"));
    }
    if (signal.aborted) {
      return Promise.reject(
        new DOMException("Aborted stale DJ break", "AbortError"),
      );
    }

    return new Promise<void>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      let settled = false;

      const cleanup = () => {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.removeAttribute("src");
        audio.load();
      };

      const finishOk = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const finishErr = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          finishErr(new Error("DJ audio element failed to load"));
          return;
        }
        finishOk();
      };
      audio.onerror = () => {
        finishErr(new Error("DJ audio element failed to load"));
      };
      signal.addEventListener(
        "abort",
        () => {
          finishErr(new DOMException("Aborted stale DJ break", "AbortError"));
        },
        { once: true },
      );
      audio.src = audioUrl;
    });
  }

  /**
   * Decode TTS bytes into an `AudioBufferSourceNode`, route through `speechGain`
   * → `audioContext.destination`, and wait until the buffer ends (or errors).
   * Always disposed in `finally` / `releaseBreakLocks`.
   *
   * Completion is driven strictly by the source `onended` event — never a
   * pre-calculated `durationMs` timeout — with a short tail cushion so
   * unduck/swell cannot start while the last phoneme is still decaying.
   *
   * DJ speech gain is always `voiceGain(master, djVolume)` where `djVolume`
   * comes from localStorage (`songhost_dj_volume`) / Host Settings.
   */
  private async playFreshDjClip(
    audioUrl: string,
    options?: {
      speakingState?: BroadcastState;
      requestEpoch?: number;
      onNearEnd?: () => void;
      nearEndMs?: number;
    },
  ): Promise<void> {
    if (this.breakAbortSignal().aborted) {
      console.log("[LinerLore] Aborted stale DJ break");
      return Promise.reject(
        new DOMException("Aborted stale DJ break", "AbortError"),
      );
    }

    if (
      options?.requestEpoch != null
      && options.requestEpoch !== this.sessionEpoch
    ) {
      console.log("[LinerLore TRACE] Discarding speech blob — epoch mismatch", {
        requestEpoch: options.requestEpoch,
        sessionEpoch: this.sessionEpoch,
      });
      return Promise.reject(
        new DOMException("Discarded stale DJ speech (session epoch mismatch)", "AbortError"),
      );
    }

    if (this.shouldDiscardLateSpeechPayload()) {
      console.log(
        "[LinerLore TRACE] Blocking duplicate DJ clip — break already playing",
        {
          trackId: this.currentTrackId ?? this.registeredTrackId ?? this.currentTrack?.trackId ?? null,
        },
      );
      return Promise.reject(
        new DOMException(
          "Discarded late DJ speech payload for current track",
          "AbortError",
        ),
      );
    }

    // Arm the per-track lock if Mode A/B entry did not already.
    this.markBreakPlaybackStarted("playFreshDjClip");

    this.disposeDjAudio();

    const signal = this.breakAbortSignal();
    const audioResponse = await fetch(audioUrl, { signal });
    if (signal.aborted) {
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }
    if (!audioResponse.ok) {
      throw new Error(`DJ audio download failed (${audioResponse.status})`);
    }
    const arrayBuffer = await audioResponse.arrayBuffer();
    if (signal.aborted) {
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error("TTS API returned an empty array buffer");
    }
    console.log(
      "[LinerLore TRACE] TTS arrayBuffer.byteLength:",
      arrayBuffer.byteLength,
    );

    if (
      options?.requestEpoch != null
      && options.requestEpoch !== this.sessionEpoch
    ) {
      console.log("[LinerLore] Aborted stale DJ break");
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }

    const audioContext = this.resolveSpeechAudioContext();
    if (!audioContext) {
      // Web Audio unavailable — fall back to HTMLAudioElement with explicit unmute.
      return this.playFreshDjClipHtmlAudioFallback(audioUrl, options);
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const decodedAudioBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0),
    );
    if (
      !Number.isFinite(decodedAudioBuffer.duration)
      || decodedAudioBuffer.duration <= 0
    ) {
      throw new Error("DJ audio element failed to load");
    }

    // decodeAudioData should resample to the context rate; flag mismatches that
    // would otherwise surface as static / pitch artifacts.
    if (
      Number.isFinite(decodedAudioBuffer.sampleRate)
      && Number.isFinite(audioContext.sampleRate)
      && Math.abs(decodedAudioBuffer.sampleRate - audioContext.sampleRate) > 1
    ) {
      console.warn("[LinerLore] TTS sample-rate mismatch", {
        bufferRate: decodedAudioBuffer.sampleRate,
        contextRate: audioContext.sampleRate,
      });
    }

    if (
      signal.aborted
      || (options?.requestEpoch != null && options.requestEpoch !== this.sessionEpoch)
    ) {
      console.log("[LinerLore] Aborted stale DJ break");
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }

    const speechSource = audioContext.createBufferSource();
    speechSource.buffer = decodedAudioBuffer;

    const speechGain = audioContext.createGain();
    // Speech rides master × djVolume × headroom only — never duck scalar.
    // Seed from persisted Host Settings, then normalize through voiceGain.
    const targetSpeechGain = this.effectiveDjVoiceGain() || SPEECH_BASELINE_GAIN;
    rampSpeechGainFromSilence(
      speechGain.gain,
      targetSpeechGain,
      audioContext,
    );

    speechSource.connect(speechGain);
    speechGain.connect(audioContext.destination);

    this.activeSpeechSource = speechSource;
    this.activeSpeechGain = speechGain;

    if (options?.speakingState) {
      this.setBroadcastState(options.speakingState);
    } else {
      this.setStatus("ON_AIR");
    }
    this.onDjStart?.();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let nearEndTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (nearEndTimer != null) clearTimeout(nearEndTimer);
        speechSource.onended = null;
        resolve();
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (nearEndTimer != null) clearTimeout(nearEndTimer);
        speechSource.onended = null;
        try {
          speechSource.stop();
        } catch {
          // Already stopped.
        }
        reject(error);
      };

      if (options?.onNearEnd) {
        const nearEndMs = options.nearEndMs ?? MODE_B_BED_DECAY_MS;
        const delay = Math.max(
          0,
          decodedAudioBuffer.duration * 1000 - nearEndMs,
        );
        nearEndTimer = setTimeout(() => {
          options.onNearEnd?.();
        }, delay);
      }

      speechSource.onended = () => {
        console.log("[LinerLore TRACE] DJ voice completed naturally.");
        // Tail cushion before resolving — swell/unduck waits on this Promise.
        setTimeout(finish, DJ_SPEECH_END_TAIL_MS);
      };

      signal.addEventListener(
        "abort",
        () => {
          console.log("[LinerLore] Aborted stale DJ break");
          fail(new DOMException("Aborted stale DJ break", "AbortError"));
        },
        { once: true },
      );

      try {
        speechSource.start(0);
        console.log("[Songhost Speech Node Started]", {
          gain: targetSpeechGain,
          duration: decodedAudioBuffer.duration,
          contextState: audioContext.state,
          sampleRate: audioContext.sampleRate,
          bufferSampleRate: decodedAudioBuffer.sampleRate,
        });
      } catch (err) {
        console.error("[LinerLore TRACE ERROR] DJ speechSource.start() failed:", err);
        fail(
          err instanceof Error
            ? err
            : new Error("DJ audio element failed to load"),
        );
      }
    });
  }

  /**
   * HTMLAudioElement fallback when Web Audio cannot open a context.
   * Always sets `volume` + `muted = false` before `play()` to avoid browser mute bugs.
   */
  private playFreshDjClipHtmlAudioFallback(
    audioUrl: string,
    options?: {
      speakingState?: BroadcastState;
      requestEpoch?: number;
      onNearEnd?: () => void;
      nearEndMs?: number;
    },
  ): Promise<void> {
    if (typeof Audio === "undefined") {
      return Promise.reject(new Error("HTML5 Audio is not available"));
    }

    return new Promise<void>((resolve, reject) => {
      const audio = new Audio();
      // Guard: unmute + volume BEFORE play() — browser mute bugs otherwise stick.
      // Use voiceGain pipeline only (never duck scalar).
      audio.volume = this.effectiveDjVoiceGain() || SPEECH_BASELINE_GAIN;
      audio.muted = false;
      this.activeDjAudio = audio;
      if (options?.speakingState) {
        this.setBroadcastState(options.speakingState);
      } else {
        this.setStatus("ON_AIR");
      }
      this.onDjStart?.();

      let settled = false;
      let nearEndTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (nearEndTimer != null) clearTimeout(nearEndTimer);
        audio.onended = null;
        audio.oncanplay = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        resolve();
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (nearEndTimer != null) clearTimeout(nearEndTimer);
        audio.onended = null;
        audio.oncanplay = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        reject(error);
      };

      const armNearEnd = () => {
        if (!options?.onNearEnd) return;
        const nearEndMs = options.nearEndMs ?? MODE_B_BED_DECAY_MS;
        const duration = audio.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;
        const remainingMs = Math.max(0, (duration - audio.currentTime) * 1000);
        const delay = Math.max(0, remainingMs - nearEndMs);
        if (nearEndTimer != null) clearTimeout(nearEndTimer);
        nearEndTimer = setTimeout(() => {
          options.onNearEnd?.();
        }, delay);
      };

      audio.onloadedmetadata = () => armNearEnd();
      audio.ontimeupdate = () => {
        if (nearEndTimer == null) armNearEnd();
      };

      audio.onended = () => {
        console.log("[LinerLore TRACE] DJ voice completed naturally.");
        setTimeout(finish, DJ_SPEECH_END_TAIL_MS);
      };
      audio.onerror = (err) => {
        console.error(
          "[LinerLore TRACE ERROR] DJ audio playback error:",
          err,
        );
        fail(new Error("DJ audio element failed to load"));
      };

      audio.src = audioUrl;
      if (
        this.breakAbortSignal().aborted
        || (options?.requestEpoch != null && options.requestEpoch !== this.sessionEpoch)
      ) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.disposeDjAudio();
        reject(new DOMException("Aborted stale DJ break", "AbortError"));
        return;
      }
      console.log(
        "[LinerLore TRACE] DJ audio .play() starting (HTMLAudioElement fallback)",
        audioUrl,
      );
      audio.volume = this.effectiveDjVoiceGain();
      audio.muted = false;
      audio.play().catch((err) => {
        console.error("[LinerLore TRACE ERROR] DJ play() rejected:", err);
        fail(
          err instanceof Error
            ? err
            : new Error("DJ audio element failed to load"),
        );
      });
    });
  }

  private async pauseActivePlayer(): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    if (this.provider === "spotify") {
      const result = await pauseSpotifyPlayback(await this.resolveSpotifyToken());
      if (isNoActiveDeviceResult(result)) {
        return "NO_ACTIVE_DEVICE";
      }
      return result === true;
    }

    await pauseAppleMusic();
    return true;
  }

  private async resumeActivePlayer(): Promise<boolean> {
    if (this.provider === "spotify") {
      const result = await resumeSpotifyPlayback(await this.resolveSpotifyToken());
      if (isNoActiveDeviceResult(result)) {
        this.onNoActiveDevice?.(result);
        return false;
      }
      return result === true;
    }

    await resumeAppleMusic();
    return true;
  }

  private playDjClip(
    audioUrl: string,
    options?: { onEnded?: () => void | Promise<void> },
  ): Promise<void> {
    // Always re-instantiate — never reuse a prior buffer source / element.
    this.disposeDjAudio();

    return this.playFreshDjClip(audioUrl).then(() =>
      Promise.resolve()
        .then(() => options?.onEnded?.())
        .then(() => undefined),
    );
  }

  /**
   * Prefer a live access token from the Spotify session; fall back to the
   * token captured when the orchestrator was constructed.
   */
  private async resolveSpotifyToken(): Promise<string> {
    const fresh = await getValidSpotifyAccessToken();
    if (fresh) return fresh;
    if (this.spotifyAccessToken) return this.spotifyAccessToken;
    throw new Error("spotifyAccessToken is required for the Spotify provider");
  }

  /**
   * Push Now Playing metadata + OS media controls (lock screen / notification).
   * Called when a new companion track lands or a DJ break finishes.
   */
  private async syncMediaSession(
    track?: {
      title: string;
      artist: string;
      album?: string;
      albumArt?: string;
    } | null,
  ): Promise<void> {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const current =
      track ??
      (await this.getCurrentlyPlayingTrack().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return null;
      }));

    if (!current?.title?.trim() || !current?.artist?.trim()) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album || "SongGhost Radio",
        artwork: [
          {
            src: current.albumArt || "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });
      this.bindMediaSessionHandlers();
      this.setMediaSessionPlaybackState("playing");
    } catch (err) {
      console.warn("[LinerLore] MediaSession metadata update failed", err);
    }
  }

  private bindMediaSessionHandlers(): void {
    if (this.mediaSessionHandlersBound) return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    try {
      navigator.mediaSession.setActionHandler("play", () => {
        // Hydration-aware resume: restored tracks after refresh need playTrack.
        void this.resume();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        void this.pause();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        void this.skipTrack();
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        void this.previousTrack();
      });
      this.mediaSessionHandlersBound = true;
    } catch (err) {
      console.warn("[LinerLore] MediaSession action handlers failed", err);
    }
  }

  private setMediaSessionPlaybackState(
    state: MediaSessionPlaybackState,
  ): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = state;
    } catch {
      // Older browsers may reject playbackState writes.
    }
  }

  /**
   * Play the invisible looping silent audio element so Android Chrome treats
   * the tab as active media when the listener leaves for Maps / lock.
   * Safe to call repeatedly; prefer calling inside the Play / Launch gesture.
   */
  startSilentAnchor(): void {
    startSilentAudioAnchor();
  }

  private stopSilentAnchor(): void {
    stopSilentAudioAnchor();
  }
}

/** Convenience factory matching the class constructor. */
export function createWebOrchestrator(
  options: WebOrchestratorOptions,
): WebOrchestrator {
  return new WebOrchestrator(options);
}
