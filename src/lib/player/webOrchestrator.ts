/**
 * Companion-stream DJ break orchestrator.
 *
 * Both Spotify and Apple Music use radio-style Duck–Talk–Swell (music keeps
 * playing under a ducked volume while the DJ clip talks over it). Volume is
 * routed through the universal {@link WebOrchestrator.getCurrentVolume} /
 * {@link WebOrchestrator.setVolume} transport abstraction.
 */

import {
  getAppleMusicKit,
  getCurrentlyPlayingAppleMusic,
  pauseAppleMusic,
  resumeAppleMusic,
} from "@/lib/player/appleMusicRemote";
import { getMasterAnalyser } from "@/lib/audio/mix-bus";
import { getPersonaById } from "@/data/personas";
import {
  clampSpotifyVolumeNormalized,
  getCurrentlyPlaying,
  getCurrentSpotifyVolume,
  getValidSpotifyAccessToken,
  isNoActiveDeviceResult,
  lerpSpotifyVolumeLog,
  next as spotifyNext,
  normalizeSpotifyTrackId,
  pauseSpotifyPlayback,
  play as playSpotify,
  rampSpotifyVolume,
  resumeSpotifyPlayback,
  searchSpotifyTrackUri,
  setSpotifyVolume,
  toSpotifyRestVolumePercent,
  type SpotifyNoActiveDevice,
  type SpotifyTrack,
} from "@/lib/player/spotifyRemote";
import type {
  DjKnowledge,
  DjMode,
  DjMood,
  DjPersonality,
} from "@/types/dj";
import { DEFAULT_DJ_TUNING } from "@/types/dj";

export type { DjMode, DjKnowledge, DjMood, DjPersonality };

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

export type OrchestratorTrackInput = {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  voiceId: string;
  /** UI host id — preferred by generate-script for roster → voice mapping. */
  personaId?: string;
  mode?: string;
};

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

export type DjScriptContext = {
  /** Last played tracks for multi-song recaps (live Spotify history preferred). */
  recentHistory?: OrchestratorTrackRef[];
  /** Next 1–2 queued tracks for upcoming teasers. */
  upcomingQueue?: OrchestratorTrackRef[];
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
 * Spotify companion duck target — normalized 0.18 (= 18% REST / SDK 0.18).
 * Matches the standalone mix-bus duck floor for consistent DJ-break ducking.
 * Never pass this raw to `volume_percent`; {@link setSpotifyVolume} scales it
 * and applies SDK + REST together.
 */
export const SPOTIFY_DUCK_RATIO = 0.18;
/** Fade-down window before DJ voice (perceptual log ramp, not a hard jump). */
export const SPOTIFY_DUCK_RAMP_MS = 400;
/** Fade-up window after DJ voice finishes (perceptual log swell). */
export const SPOTIFY_RESTORE_RAMP_MS = 600;
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

/** DJ HTML5 Audio element gain — full level so TTS sits clearly over ducked music. */
const DJ_VOICE_ELEMENT_VOLUME = 1;

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

  private activeDjAudio: HTMLAudioElement | null = null;
  /**
   * Global abort for in-flight generate-script / TTS work.
   * Reset on {@link launchStation}, {@link playTrack}, and {@link clearQueue}
   * so a station relaunch cannot leave zombie prefetches playing.
   */
  private currentBreakAbortController: AbortController | null = null;
  /**
   * Track identity for the break about to run / currently scripting.
   * Cleared on station launch so a prior session's id cannot seed R2/TTS.
   */
  private currentTrack: OrchestratorTrackInput | null = null;
  /** Alias of the live DJ-break track (same object as {@link currentTrack}). */
  private activeTrack: OrchestratorTrackInput | null = null;
  /** Break-in-progress lock — must clear on track end / new trackId. */
  private running = false;
  /** Duck–Talk–Swell state machine — instance-owned so React remounts cannot reset it. */
  private status: OrchestratorStatus = "STANDBY";
  /** True after a music duck has been applied and not yet restored. */
  private musicDucked = false;
  /**
   * Exact music volume captured immediately before a DJ break duck.
   * Swell / error reset restore to this — never hardcoded 1.0 — so volume
   * cannot creep above the listener's pre-break level.
   */
  private preBreakVolume: number | null = null;
  /**
   * Live DJ persona id for generate-script / TTS. Updated via {@link setPersona}
   * when the user changes hosts mid-session.
   */
  private activePersonaId: string | null = null;
  /**
   * Debounce: last trackId that successfully entered `runDjBreak`.
   * Prevents double-firing the same song while still allowing tracks 2+.
   */
  private lastBreakTrackId: string | null = null;
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
  /** Latest history/queue context for generate-script recaps + teasers. */
  private scriptContext: DjScriptContext = {};
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
  /**
   * Invisible looping silent `<audio>` that keeps Android Chrome from
   * suspending the tab when the listener switches to Maps or locks the phone.
   */
  private silentAnchor: HTMLAudioElement | null = null;
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
    this.currentBreakAbortController = new AbortController();
  }

  private static isAbortError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    if (err instanceof Error && err.name === "AbortError") return true;
    return false;
  }

  /**
   * Abort in-flight DJ break fetches, tear down any live TTS element, and
   * mint a fresh {@link currentBreakAbortController}.
   */
  private resetBreakAbortController(reason = "Station relaunch"): void {
    try {
      this.currentBreakAbortController?.abort(reason);
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
    this.currentBreakAbortController = new AbortController();
    this.disposeDjAudio();
  }

  /** Signal for generate-script / TTS downloads — always defined after construct. */
  private breakAbortSignal(): AbortSignal {
    if (!this.currentBreakAbortController) {
      this.currentBreakAbortController = new AbortController();
    }
    return this.currentBreakAbortController.signal;
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
    this.djMode = mode;
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
    if (input.mood) this.mood = input.mood;
    if (input.personality) this.personality = input.personality;
    if (input.knowledge) this.knowledge = input.knowledge;
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
   * Switch the live DJ persona mid-session. Updates `activePersonaId` /
   * voice context so the next generate-script call uses the new host.
   * Callers should follow with {@link flushPrefetch} so old-voice clips
   * cannot air.
   */
  setPersona(newPersonaId: string): void {
    const trimmed = newPersonaId.trim();
    if (!trimmed) return;

    const persona = getPersonaById(trimmed);
    this.activePersonaId = persona?.id ?? trimmed;
    this.lastPersonaId = this.activePersonaId;
    if (persona?.elevenLabsVoiceId) {
      this.lastVoiceId = persona.elevenLabsVoiceId;
    }

    console.log("[LinerLore TRACE] setPersona", {
      personaId: this.activePersonaId,
      voiceId: this.lastVoiceId,
    });
  }

  getActivePersonaId(): string | null {
    return this.activePersonaId;
  }

  /**
   * Resume the active Spotify / Apple Music transport and keep the silent
   * media-session anchor running for mobile background persistence.
   */
  async resume(): Promise<void> {
    this.startSilentAnchor();
    const ok = await this.resumeActivePlayer();
    this.setMediaSessionPlaybackState(ok ? "playing" : "paused");
  }

  /** Pause the active Spotify / Apple Music transport. */
  async pause(): Promise<void> {
    const result = await this.pauseActivePlayer();
    if (result === "NO_ACTIVE_DEVICE") {
      this.onNoActiveDevice?.({ success: false, reason: "NO_ACTIVE_DEVICE" });
    }
    this.setMediaSessionPlaybackState("paused");
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

  /**
   * Invalidate warmed generate-script / TTS clips (e.g. after a mid-session
   * persona change so the old voice cannot air).
   */
  flushPrefetch(): void {
    console.log("[LinerLore TRACE] flushPrefetch — clearing warmed DJ clips", {
      prefetchCount: this.djPrefetchByTrackId.size,
    });
    this.abortPrefetchRequests();
    this.clearDjPrefetch();
    if (this.status === "PREFETCHING" && !this.running) {
      this.setStatus("STANDBY");
    }
  }

  private breakThreshold(): number {
    return DJ_MODE_THRESHOLDS[this.djMode];
  }

  private setStatus(next: OrchestratorStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.onStatusChange?.(next);
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
    this.scriptContext = {
      // Live registerTrack history wins at fetch time; keep queue-sourced
      // fallback for prefetch windows before the first companion poll.
      recentHistory: normalizeTrackRefs(
        context.recentHistory,
        ACTUAL_PLAYBACK_HISTORY_LIMIT,
      ),
      upcomingQueue: normalizeTrackRefs(context.upcomingQueue, 2),
    };
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
    });

    // Never abort a mid-flight Duck–Talk–Swell from a stale id race.
    if (this.running) return;

    this.registeredTrackId = trackId;
    this.releaseBreakLocks();

    // Instance-owned cadence counter — survives React remounts / HMR.
    this.songsSinceLastBreak += 1;

    // Always record what Spotify/Apple actually played — even when the break
    // is skipped — so the next lore recap names the real prior songs.
    await this.recordActualPlayback(trackId);

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
    if (breakDue) {
      const live = await this.buildLiveTrackInput(trackId);
      if (live) {
        console.log(
          "[LinerLore TRACE Autopilot] No prefetch — running live DJ break for track:",
          trackId,
        );
        // Call the internal path directly — awaiting `runDjBreak` here would
        // deadlock on `registerTrackWork` (we're already inside it).
        await this.runDjBreakInternal(live);
      }
    }
  }

  private isDjBreakDue(): boolean {
    if (this.djMode === "no_dj" || this.djPacingFrequency <= 0) return false;
    return this.songsSinceLastBreak >= this.breakThreshold();
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

    const persona = getPersonaById(personaId);
    const voiceId = persona?.elevenLabsVoiceId || track.voiceId || this.lastVoiceId;
    if (!voiceId) return { ...track, personaId };

    return {
      ...track,
      personaId: persona?.id ?? personaId,
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
      const persona = getPersonaById(personaId);
      if (persona?.elevenLabsVoiceId) voiceId = persona.elevenLabsVoiceId;
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
    if (this.running) return;

    this.running = true;
    this.markBreakExecuted(trackId, warmed.key, warmed.track.trackId);

    try {
      try {
        getMasterAnalyser().unlock();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }

      if (this.status === "STANDBY") {
        this.setStatus("PREFETCHING");
      }

      const scriptPayload = await warmed.promise;
      if (this.breakAbortSignal().aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.setStatus("STANDBY");
        return;
      }
      if (!scriptPayload.audioUrl) {
        const error = new Error("prefetched generate-script response missing audioUrl");
        console.error("[LinerLore TRACE ERROR]", error);
        this.onError?.(error);
        this.setStatus("STANDBY");
        return;
      }

      // Script was already ingested when generate-script / prefetch resolved.
      await this.runDuckTalkSwell(scriptPayload);
    } catch (caught) {
      if (WebOrchestrator.isAbortError(caught) || this.breakAbortSignal().aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.setStatus("STANDBY");
        return;
      }
      const error =
        caught instanceof Error
          ? caught
          : new Error("Prefetched DJ break orchestration failed");
      console.error("[LinerLore TRACE ERROR]", caught);
      this.onError?.(error);
      await this.resetMusicVolume().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
      this.setStatus("STANDBY");
    } finally {
      this.running = false;
      this.disposeDjAudio();
      // Ensure this track's warmup cannot be replayed.
      this.djPrefetchByTrackId.delete(trackId);
      this.djPrefetchByTrackId.delete(warmed.key);
    }
  }

  /**
   * Abort an in-flight DJ clip and hard-reset music volume when ducked.
   */
  stopDjAudio(): void {
    this.releaseBreakLocks();
    // Do not clearDjPrefetch() here — autopilot may have already warmed the
    // next track's lore while this clip is aborted.
    if (this.musicDucked) {
      void this.resetMusicVolume();
    }
    if (this.status !== "STANDBY" && this.status !== "PREFETCHING") {
      this.setStatus("STANDBY");
    }
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
    });
    this.resetBreakAbortController("Station relaunch");
    this.abortPrefetchRequests();
    this.clearDjPrefetch();
    this.releaseBreakLocks();
    void this.resetMusicVolume().catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return false;
    });
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
   * Set the active transport volume on a normalized 0.0–1.0 scale.
   * Spotify → {@link setSpotifyVolume}. Apple Music → MusicKit player.volume.
   */
  async setVolume(
    vol: number,
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    const clamped = clampSpotifyVolumeNormalized(vol);

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
   * Smooth perceptual fade for Spotify or Apple Music ducking / swell.
   * Spotify keeps the dual-path SDK+REST ramp; Apple steps MusicKit volume.
   */
  private async rampMusicVolume(
    fromVolume: number,
    toVolume: number,
    durationMs: number,
    signal?: AbortSignal,
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    if (this.provider === "spotify") {
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

    console.log("[LinerLore TRACE] rampMusicVolume (apple_music)", {
      from,
      to,
      durationMs: safeDuration,
      steps,
      intervalMs,
      curve: "logarithmic",
    });

    for (let i = 1; i <= steps; i++) {
      if (signal?.aborted) {
        console.log("[LinerLore TRACE] rampMusicVolume aborted", { step: i });
        break;
      }

      const current = lerpSpotifyVolumeLog(from, to, i / steps);
      lastOk = await this.setVolume(current);
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
    return this.setVolume(to);
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
   * station launch / playTrack handoff can never play stale lore from a
   * previous session. Call synchronously before issuing Spotify play.
   */
  flushForStationLaunch(): void {
    console.log("[LinerLore TRACE] flushForStationLaunch — clearing prior session", {
      hadCurrentTrack: Boolean(this.currentTrack),
      prefetchCount: this.djPrefetchByTrackId.size,
      wasRunning: this.running,
    });
    // Kill in-flight generate-script / TTS before any new URI starts.
    this.resetBreakAbortController("Station relaunch");
    this.abortPrefetchRequests();
    this.abortVolumeRamp();
    this.clearDjPrefetch();
    this.running = false;
    this.currentTrack = null;
    this.activeTrack = null;
    this.lastBreakTrackId = null;
    this.executedBreakTrackIds.clear();
    this.registeredTrackId = null;
    this.songsSinceLastBreak = 0;
    this.scriptContext = {};
    this.actualPlaybackHistory = [];
    // Preserve the live host across station/URI flushes; re-resolve voice from
    // the roster so a mid-session persona pick is not wiped by playTrack.
    const preservedPersonaId = this.activePersonaId ?? this.lastPersonaId;
    this.lastVoiceId = null;
    this.lastPersonaId = null;
    this.lastMode = undefined;
    if (preservedPersonaId) {
      this.setPersona(preservedPersonaId);
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
    this.setStatus("STANDBY");
  }

  /**
   * Force the active Spotify device onto a concrete URI.
   * Call on Launch Radio and every queue advance so the remote stream
   * matches LinerLore's selected track.
   */
  async playSpotifyUri(trackUri: string): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    if (this.provider !== "spotify") {
      throw new Error("playSpotifyUri is only available for the Spotify provider");
    }
    // Flush stale audio / track ids before the new URI starts.
    // (Restores ducked volume to preBreakVolume when needed — never forces 1.0.)
    this.flushForStationLaunch();
    const token = await this.resolveSpotifyToken();
    const result = await playSpotify(token, { uris: [trackUri] });
    if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
    if (result === true) {
      this.startSilentAnchor();
      void this.syncMediaSession();
    }
    return result === true;
  }

  /**
   * Start Spotify playback on one or more track URIs (Connect / Web Playback).
   * Alias used by station-search handoff paths.
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

    // Abort stale DJ fetches + audio immediately, then full session flush.
    // (Restores ducked volume to preBreakVolume when needed — never forces 1.0.)
    this.resetBreakAbortController("Station relaunch");
    this.flushForStationLaunch();

    const token = await this.resolveSpotifyToken();
    const result = await playSpotify(token, { uris });
    if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
    if (result === true) {
      this.startSilentAnchor();
      void this.syncMediaSession();
    }
    return result === true;
  }

  /**
   * Station-launch entry: flush prior session state, then play the URI(s).
   * Same flush semantics as {@link playTrack}.
   */
  async launchStation(
    uri: string | string[],
  ): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    // playTrack aborts + flushes; explicit reset here so relaunch is
    // synchronous even if playTrack early-returns on empty URIs.
    this.resetBreakAbortController("Station relaunch");
    return this.playTrack(uri);
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

    // Cadence gate: skip warmup when the next advance will not voice a break.
    if (!this.willBreakOnNextTrack()) {
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
    const pending = this.fetchDjAudio(normalized, this.scriptContext, signal).catch(
      (err) => {
        this.djPrefetchByTrackId.delete(key);
        if (this.nextPrefetchKey === key) this.nextPrefetchKey = null;
        if (WebOrchestrator.isAbortError(err)) {
          console.log("[LinerLore] Aborted stale DJ break");
        } else {
          console.error("[LinerLore TRACE ERROR]", err);
        }
        throw err;
      },
    );
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
    this.resetBreakAbortController("Station relaunch");
    this.abortPrefetchRequests();
    this.releaseBreakLocks();
    this.clearDjPrefetch();
    this.currentTrack = null;
    this.activeTrack = null;
    this.lastBreakTrackId = null;
    this.executedBreakTrackIds.clear();
    this.registeredTrackId = null;
    this.songsSinceLastBreak = 0;
    this.scriptContext = {};
    this.actualPlaybackHistory = [];
    const preservedPersonaId = this.activePersonaId ?? this.lastPersonaId;
    this.lastVoiceId = null;
    this.lastPersonaId = null;
    this.lastMode = undefined;
    this.preBreakVolume = null;
    if (preservedPersonaId) {
      this.setPersona(preservedPersonaId);
    } else {
      this.activePersonaId = null;
    }
    this.clearScriptTranscripts();
    this.registerTrackWork = Promise.resolve();
    this.setStatus("STANDBY");
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
        this.executedBreakTrackIds.has(trackId))
    ) {
      console.log(
        "[LinerLore TRACE] Skipping DJ break — already executed for trackId",
        { trackId },
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

    this.running = true;
    if (trackId) {
      this.markBreakExecuted(trackId);
    }

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
      });

      if (this.status === "STANDBY") {
        this.setStatus("PREFETCHING");
      }

      // Use the stamped currentTrack so TTS never sees a stale id/title pair.
      const scriptPayload = await this.resolveDjAudio(
        this.currentTrack ?? normalized,
      );
      if (this.breakAbortSignal().aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.setStatus("STANDBY");
        return {
          ok: false,
          reason: "PLAYBACK_FAILED",
          error: new Error("Aborted stale DJ break"),
        };
      }
      if (!scriptPayload.audioUrl) {
        const error = new Error("generate-script response missing audioUrl");
        this.onError?.(error);
        this.setStatus("STANDBY");
        return { ok: false, reason: "SCRIPT_FAILED", error };
      }

      // Script was already ingested when generate-script / prefetch resolved.
      return await this.runDuckTalkSwell(scriptPayload);
    } catch (caught) {
      if (WebOrchestrator.isAbortError(caught) || this.breakAbortSignal().aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.setStatus("STANDBY");
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
      this.setStatus("STANDBY");
      return { ok: false, reason: "SCRIPT_FAILED", error };
    } finally {
      this.running = false;
      this.disposeDjAudio();
    }
  }

  /**
   * Universal Duck–Talk–Swell for Spotify and Apple Music.
   * Volume ramps route through {@link rampMusicVolume}.
   */
  private async runDuckTalkSwell(
    scriptPayload: DjBreakScriptResponse,
  ): Promise<RunDjBreakResult> {
    const audioUrl = scriptPayload.audioUrl;
    const rampSignal = this.beginVolumeRamp();

    // Capture the exact user volume before ducking — swell restores to this,
    // never hardcoded 1.0, so volume cannot creep above the listener's level.
    const preBreakVolume = await this.getCurrentVolume();
    this.preBreakVolume = preBreakVolume;
    console.log("[LinerLore TRACE] Captured preBreakVolume", {
      provider: this.provider,
      preBreakVolume,
      duckTarget: SPOTIFY_DUCK_RATIO,
    });

    // 1. Perceptual fade down preBreakVolume → 0.18 before DJ voice.
    this.setStatus("DUCKING");
    const ducked = await this.rampMusicVolume(
      preBreakVolume,
      SPOTIFY_DUCK_RATIO,
      SPOTIFY_DUCK_RAMP_MS,
      rampSignal,
    );
    if (ducked === "NO_ACTIVE_DEVICE") {
      const status: SpotifyNoActiveDevice = {
        success: false,
        reason: "NO_ACTIVE_DEVICE",
      };
      this.onNoActiveDevice?.(status);
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

    try {
      // 2. Fresh TTS Audio element per break — reusing a buffered element after
      // Track 1 can leave the browser player stuck and mute Tracks 2+.
      await this.playFreshDjClip(audioUrl);

      // 3. Perceptual fade up 0.18 → preBreakVolume ONLY after voice finishes.
      this.setStatus("RAMPING_UP");
      const swellSignal = this.beginVolumeRamp();
      const swelled = await this.rampMusicVolume(
        SPOTIFY_DUCK_RATIO,
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
      this.musicDucked = false;
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
   * Prefer a warmed autopilot prefetch for this trackId; otherwise fetch live.
   */
  private async resolveDjAudio(
    track: OrchestratorTrackInput,
  ): Promise<DjBreakScriptResponse> {
    const key = track.trackId.trim();
    const warmed = key ? await this.takePrefetchForTrack(key) : null;
    if (warmed) {
      console.log("[LinerLore TRACE] Using prefetched DJ break", {
        trackId: key,
        prefetchKey: warmed.key,
      });
      return warmed.promise;
    }
    return this.fetchDjAudio(
      track,
      this.scriptContext,
      this.breakAbortSignal(),
    );
  }

  private async fetchDjAudio(
    track: OrchestratorTrackInput,
    context: DjScriptContext = this.scriptContext,
    signal?: AbortSignal,
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

    // Always stamp the live persona so mid-session host switches hit TTS.
    const coherent = this.applyLivePersona(base);
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
      recentHistory: recentHistory.length,
      upcomingQueue: upcomingQueue.length,
      fromActualPlayback: this.actualPlaybackHistory.length > 0,
    });
    let response: Response;
    try {
      response = await fetch(this.scriptEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: coherent.trackId,
          voiceId: coherent.voiceId,
          personaId: coherent.personaId ?? this.activePersonaId,
          title: coherent.title,
          artist: coherent.artist,
          album: coherent.album,
          mode: coherent.mode,
          djMode: this.djMode,
          mood: this.mood,
          personality: this.personality,
          knowledge: this.knowledge,
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

    // Best-effort: download ElevenLabs / CDN audio under the abort signal so a
    // station relaunch cancels the body. Fall back to the direct URL when CORS
    // blocks fetch — HTMLAudioElement can still play cross-origin media.
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
        console.warn(
          "[LinerLore] DJ audio download failed; using direct URL",
          err,
        );
      }
    }

    const buffer: { byteLength?: number } | undefined = payload.audioUrl
      ? { byteLength: undefined }
      : undefined;
    console.log(
      "[LinerLore TRACE 4] DJ Voice buffer ready, byte length:",
      buffer?.byteLength,
    );
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
    const buffer = await audioResponse.arrayBuffer();
    if (signal.aborted) {
      throw new DOMException("Aborted stale DJ break", "AbortError");
    }
    const contentType =
      audioResponse.headers.get("content-type") || "audio/mpeg";
    return URL.createObjectURL(new Blob([buffer], { type: contentType }));
  }

  /** Immediate volume restore used on DJ load/play failure or abort. */
  private async resetMusicVolume(): Promise<boolean> {
    this.abortVolumeRamp();
    try {
      // Restore the captured pre-break level — never force 1.0 (volume creep).
      const restoreLevel = this.preBreakVolume ?? SPOTIFY_UNDUCKED_GAIN;
      const result = await this.setVolume(restoreLevel);
      if (result === true) {
        this.musicDucked = false;
        return true;
      }
      if (result === "NO_ACTIVE_DEVICE") {
        this.musicDucked = false;
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
   * Tear down the live TTS element so the next break always gets a fresh
   * `HTMLAudioElement` (browser buffer reuse after Track 1 can hard-lock).
   */
  private disposeDjAudio(): void {
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
   * Instantiate a brand-new Audio element for this break and wait until it
   * ends (or errors). Always disposed in `finally` / `releaseBreakLocks`.
   */
  private playFreshDjClip(audioUrl: string): Promise<void> {
    if (typeof Audio === "undefined") {
      return Promise.reject(new Error("HTML5 Audio is not available"));
    }

    if (this.breakAbortSignal().aborted) {
      console.log("[LinerLore] Aborted stale DJ break");
      return Promise.reject(
        new DOMException("Aborted stale DJ break", "AbortError"),
      );
    }

    this.disposeDjAudio();

    return new Promise<void>((resolve, reject) => {
      const audio = new Audio();
      audio.volume = DJ_VOICE_ELEMENT_VOLUME; // Explicit full gain for TTS over ducked music
      this.activeDjAudio = audio;
      this.setStatus("ON_AIR");
      this.onDjStart?.();

      const finish = () => {
        audio.onended = null;
        audio.oncanplay = null;
        audio.onerror = null;
        resolve();
      };

      audio.onended = () => {
        console.log("[LinerLore TRACE] DJ voice completed naturally.");
        finish();
      };
      audio.onerror = (err) => {
        console.error(
          "[LinerLore TRACE ERROR] DJ audio playback error:",
          err,
        );
        finish();
      };

      audio.src = audioUrl;
      // If relaunch aborts while buffering, drop the element without playing.
      if (this.breakAbortSignal().aborted) {
        console.log("[LinerLore] Aborted stale DJ break");
        this.disposeDjAudio();
        reject(new DOMException("Aborted stale DJ break", "AbortError"));
        return;
      }
      console.log("[LinerLore TRACE] DJ audio .play() starting (fresh element)", audioUrl);
      audio.play().catch((err) => {
        console.error("[LinerLore TRACE ERROR] DJ play() rejected:", err);
        finish();
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
    if (typeof Audio === "undefined") {
      return Promise.reject(new Error("HTML5 Audio is not available"));
    }

    // Always re-instantiate — never reuse a buffered Track-1 element.
    this.disposeDjAudio();

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      audio.volume = DJ_VOICE_ELEMENT_VOLUME; // Explicit full gain for TTS over ducked music
      this.activeDjAudio = audio;

      const cleanup = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };

      const onEnded = () => {
        cleanup();
        void Promise.resolve()
          .then(() => options?.onEnded?.())
          .then(() => resolve())
          .catch((error: unknown) => {
            console.error("[LinerLore TRACE ERROR]", error);
            reject(
              error instanceof Error
                ? error
                : new Error("Failed to restore music after DJ clip"),
            );
          });
      };

      const onError = () => {
        console.error(
          "[LinerLore TRACE ERROR]",
          new Error("DJ audio element failed to play"),
        );
        cleanup();
        reject(new Error("DJ audio element failed to play"));
      };

      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      this.setStatus("ON_AIR");
      this.onDjStart?.();

      console.log("[LinerLore TRACE] DJ audio .play() starting", audioUrl);
      // Do not restore Spotify volume here — `.play()` resolves when playback
      // *starts*. Swell/reset belongs only in `ended` (via onEnded) or this
      // catch (caller handles volume reset on rejection).
      void audio.play().catch((error: unknown) => {
        console.error("[LinerLore TRACE ERROR]", error);
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error("Browser blocked DJ audio playback"),
        );
      });
    });
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
        void this.resume();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        void this.pause();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        void this.skipTrack();
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
   * Create / play the invisible looping silent audio element so Android Chrome
   * treats the tab as active media when the listener leaves for Maps / lock.
   */
  private ensureSilentAnchor(): HTMLAudioElement | null {
    if (typeof document === "undefined") return null;
    if (this.silentAnchor) return this.silentAnchor;

    const audio = document.createElement("audio");
    audio.src = "/silent.mp3";
    audio.loop = true;
    audio.preload = "auto";
    audio.setAttribute("aria-hidden", "true");
    audio.setAttribute("playsinline", "true");
    audio.style.display = "none";
    document.body.appendChild(audio);
    this.silentAnchor = audio;
    return audio;
  }

  private startSilentAnchor(): void {
    const audio = this.ensureSilentAnchor();
    if (!audio) return;
    void audio.play().catch((err) => {
      console.warn("[LinerLore] Silent audio anchor play() blocked", err);
    });
  }

  private stopSilentAnchor(): void {
    const audio = this.silentAnchor;
    if (!audio) return;
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
    }
    this.silentAnchor = null;
  }
}

/** Convenience factory matching the class constructor. */
export function createWebOrchestrator(
  options: WebOrchestratorOptions,
): WebOrchestrator {
  return new WebOrchestrator(options);
}
