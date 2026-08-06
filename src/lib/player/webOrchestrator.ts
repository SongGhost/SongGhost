/**
 * Companion-stream DJ break orchestrator.
 *
 * Spotify uses radio-style Duck–Talk–Swell (music keeps playing under a ducked
 * volume while the DJ clip talks over it). Apple Music still uses
 * Pause–Talk–Play until a volume API is wired for MusicKit.
 */

import {
  getCurrentlyPlayingAppleMusic,
  pauseAppleMusic,
  resumeAppleMusic,
  type AppleTrack,
} from "@/lib/player/appleMusicRemote";
import { getMasterAnalyser } from "@/lib/audio/mix-bus";
import {
  clampSpotifyVolumeNormalized,
  getCurrentlyPlaying,
  getValidSpotifyAccessToken,
  isNoActiveDeviceResult,
  pauseSpotifyPlayback,
  play as playSpotify,
  rampSpotifyVolume,
  resumeSpotifyPlayback,
  searchSpotifyTrackUri,
  setSpotifyVolume,
  SPOTIFY_VOLUME_RAMP_MS,
  toSpotifyRestVolumePercent,
  type SpotifyNoActiveDevice,
  type SpotifyTrack,
} from "@/lib/player/spotifyRemote";
import type { DjMode } from "@/types/dj";

export type { DjMode };

export type OrchestratorProvider = "spotify" | "apple_music";

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
 * Spotify companion duck target — normalized 0.65 (= 65% REST / SDK 0.65).
 * Never pass this raw to `volume_percent`; {@link setSpotifyVolume} scales it
 * and applies SDK + REST together.
 */
export const SPOTIFY_DUCK_RATIO = 0.65;
/** Fade-down window before DJ voice (smooth ramp, not a hard jump). */
export const SPOTIFY_DUCK_RAMP_MS = SPOTIFY_VOLUME_RAMP_MS;
/** Fade-up window after DJ voice finishes. */
export const SPOTIFY_RESTORE_RAMP_MS = SPOTIFY_VOLUME_RAMP_MS;
/** Full-level Spotify volume after a swell or error reset. */
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

/** DJ HTML5 Audio element gain — midpoint between 0.50 and 0.75. */
const DJ_VOICE_ELEMENT_VOLUME = 0.75;

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
 * Apply a Spotify volume target immediately via dual-path
 * {@link setSpotifyVolume} (SDK `setVolume` + REST `volume_percent`).
 * Reserved for hard resets on abort/error — live Duck–Talk–Swell uses ramps.
 */
async function applySpotifyVolumeNow(
  accessToken: string,
  level: number,
): Promise<true | false | "NO_ACTIVE_DEVICE"> {
  const result = await setSpotifyVolume(
    accessToken,
    clampSpotifyVolumeNormalized(level),
  );
  if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
  return result === true;
}

/**
 * Smooth fade via {@link rampSpotifyVolume}. Returns the same ternary as
 * {@link applySpotifyVolumeNow} so callers can share NO_ACTIVE_DEVICE handling.
 */
async function rampSpotifyVolumeLevel(
  accessToken: string,
  fromVolume: number,
  toVolume: number,
  durationMs: number,
  signal?: AbortSignal,
): Promise<true | false | "NO_ACTIVE_DEVICE"> {
  const result = await rampSpotifyVolume(
    accessToken,
    fromVolume,
    toVolume,
    durationMs,
    signal ? { signal } : undefined,
  );
  if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
  return result === true;
}

/**
 * Coordinates a single DJ break cycle against Spotify (duck) or Apple Music (pause).
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
  /** Break-in-progress lock — must clear on track end / new trackId. */
  private running = false;
  /** Duck–Talk–Swell state machine — instance-owned so React remounts cannot reset it. */
  private status: OrchestratorStatus = "STANDBY";
  /** True after a Spotify duck has been applied and not yet restored. */
  private spotifyDucked = false;
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

  private breakThreshold(): number {
    return DJ_MODE_THRESHOLDS[this.djMode];
  }

  private setStatus(next: OrchestratorStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.onStatusChange?.(next);
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
    const id = trackId.trim();
    if (!id) return;

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
      if ("artists" in live) {
        title = live.name?.trim() ?? "";
        artist = live.artists.join(", ").trim();
      } else {
        title = live.name?.trim() ?? "";
        artist = live.artistName?.trim() ?? "";
      }
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
  }

  private rememberVoiceContext(track: OrchestratorTrackInput): void {
    if (track.voiceId) this.lastVoiceId = track.voiceId;
    if (track.personaId) this.lastPersonaId = track.personaId;
    if (track.mode !== undefined) this.lastMode = track.mode;
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
    if (!this.lastVoiceId) return null;

    const live = await this.getCurrentlyPlayingTrack().catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return null;
    });

    if (live) {
      if ("artists" in live) {
        return {
          trackId: live.id || trackId,
          title: live.name,
          artist: live.artists.join(", "),
          album: live.album,
          voiceId: this.lastVoiceId,
          personaId: this.lastPersonaId ?? undefined,
          mode: this.lastMode,
        };
      }
      return {
        trackId: live.id || trackId,
        title: live.name,
        artist: live.artistName,
        album: live.albumName,
        voiceId: this.lastVoiceId,
        personaId: this.lastPersonaId ?? undefined,
        mode: this.lastMode,
      };
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
    live: SpotifyTrack | AppleTrack,
  ): boolean {
    const liveTitle = live.name.trim().toLowerCase();
    const liveArtist =
      "artists" in live
        ? live.artists.join(", ").trim().toLowerCase()
        : live.artistName.trim().toLowerCase();
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
      if (!scriptPayload.audioUrl) {
        const error = new Error("prefetched generate-script response missing audioUrl");
        console.error("[LinerLore TRACE ERROR]", error);
        this.onError?.(error);
        this.setStatus("STANDBY");
        return;
      }

      if (scriptPayload.script) {
        this.onScript?.(scriptPayload.script);
      }

      if (this.provider === "spotify") {
        await this.runSpotifyDuckTalkSwell(scriptPayload);
      } else {
        await this.runApplePauseTalkPlay(scriptPayload);
      }
    } catch (caught) {
      const error =
        caught instanceof Error
          ? caught
          : new Error("Prefetched DJ break orchestration failed");
      console.error("[LinerLore TRACE ERROR]", caught);
      this.onError?.(error);
      await this.resetSpotifyVolume().catch((err) => {
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
   * Abort an in-flight DJ clip and hard-reset Spotify volume when ducked.
   * Apple Music is left paused — callers that need resume use runDjBreak's
   * own cleanup paths.
   */
  stopDjAudio(): void {
    this.releaseBreakLocks();
    // Do not clearDjPrefetch() here — autopilot may have already warmed the
    // next track's lore while this clip is aborted.
    if (this.spotifyDucked) {
      void this.resetSpotifyVolume();
    }
    if (this.status !== "STANDBY" && this.status !== "PREFETCHING") {
      this.setStatus("STANDBY");
    }
  }

  /**
   * Manual override: immediately bypass `songsSinceLastBreak`, duck Spotify to
   * 0.65, and play/fetch a live DJ break for the current track.
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
      songsSinceLastBreak: this.songsSinceLastBreak,
      djMode: this.djMode,
    });

    return this.runDjBreakInternal(live, { force: true });
  }

  /**
   * Manual override: stop active DJ audio, cancel prefetch requests, and
   * restore Spotify volume to 1.0 immediately.
   */
  skipActiveBreak(): void {
    console.log("[LinerLore TRACE] skipActiveBreak — aborting DJ break", {
      status: this.status,
      wasRunning: this.running,
    });
    this.abortPrefetchRequests();
    this.clearDjPrefetch();
    this.releaseBreakLocks();
    void this.resetSpotifyVolume().catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return false;
    });
    this.setStatus("STANDBY");
  }

  async getCurrentlyPlayingTrack(): Promise<SpotifyTrack | AppleTrack | null> {
    if (this.provider === "spotify") {
      const token = await this.resolveSpotifyToken();
      return getCurrentlyPlaying(token);
    }
    return getCurrentlyPlayingAppleMusic();
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
    const token = await this.resolveSpotifyToken();
    // Ensure music starts at full level before a later duck/swell cycle.
    await setSpotifyVolume(token, SPOTIFY_UNDUCKED_GAIN).catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return false;
    });
    const result = await playSpotify(token, { uris: [trackUri] });
    if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
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

    const token = await this.resolveSpotifyToken();
    await setSpotifyVolume(token, SPOTIFY_UNDUCKED_GAIN).catch((err) => {
      console.error("[LinerLore TRACE ERROR]", err);
      return false;
    });
    const result = await playSpotify(token, { uris });
    if (isNoActiveDeviceResult(result)) return "NO_ACTIVE_DEVICE";
    return result === true;
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
    const key = track.trackId.trim();
    if (!key) return;
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

    this.rememberVoiceContext(track);
    if (context) this.setScriptContext(context);

    console.log("[LinerLore TRACE] Autopilot prefetch DJ break", {
      trackId: key,
      title: track.title,
      artist: track.artist,
      recentHistory:
        this.actualPlaybackHistory.length
        || (this.scriptContext.recentHistory?.length ?? 0),
      upcomingQueue: this.scriptContext.upcomingQueue?.length ?? 0,
    });

    if (this.status === "STANDBY") {
      this.setStatus("PREFETCHING");
    }

    const signal = this.beginPrefetchAbort();
    const pending = this.fetchDjAudio(track, this.scriptContext, signal).catch(
      (err) => {
        this.djPrefetchByTrackId.delete(key);
        if (this.nextPrefetchKey === key) this.nextPrefetchKey = null;
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("[LinerLore TRACE ERROR]", err);
        }
        throw err;
      },
    );
    this.djPrefetchByTrackId.set(key, { track, promise: pending });
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
    this.abortPrefetchRequests();
    this.releaseBreakLocks();
    this.lastBreakTrackId = null;
    this.executedBreakTrackIds.clear();
    this.registeredTrackId = null;
    this.songsSinceLastBreak = 0;
    this.scriptContext = {};
    this.actualPlaybackHistory = [];
    this.lastVoiceId = null;
    this.lastPersonaId = null;
    this.lastMode = undefined;
    this.registerTrackWork = Promise.resolve();
    this.setStatus("STANDBY");
  }

  /**
   * Full DJ break cycle for the given track + voice.
   * Spotify: duck → talk → swell. Apple Music: pause → talk → play.
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
    const trackId = track.trackId.trim();
    const force = options?.force === true;
    this.rememberVoiceContext(track);

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

      const scriptPayload = await this.resolveDjAudio(track);
      if (!scriptPayload.audioUrl) {
        const error = new Error("generate-script response missing audioUrl");
        this.onError?.(error);
        this.setStatus("STANDBY");
        return { ok: false, reason: "SCRIPT_FAILED", error };
      }

      if (scriptPayload.script) {
        this.onScript?.(scriptPayload.script);
      }

      if (this.provider === "spotify") {
        return await this.runSpotifyDuckTalkSwell(scriptPayload);
      }

      return await this.runApplePauseTalkPlay(scriptPayload);
    } catch (caught) {
      const error =
        caught instanceof Error ? caught : new Error("DJ break orchestration failed");
      console.error("[LinerLore TRACE ERROR]", caught);
      this.onError?.(error);
      // If we ducked before the failure escaped, never leave Spotify quiet.
      await this.resetSpotifyVolume().catch((err) => {
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

  private async runSpotifyDuckTalkSwell(
    scriptPayload: DjBreakScriptResponse,
  ): Promise<RunDjBreakResult> {
    const token = await this.resolveSpotifyToken();
    const audioUrl = scriptPayload.audioUrl;
    const rampSignal = this.beginVolumeRamp();

    // 1. Smooth fade down 1.0 → 0.65 before DJ voice (never a hard jump).
    this.setStatus("DUCKING");
    const ducked = await rampSpotifyVolumeLevel(
      token,
      SPOTIFY_UNDUCKED_GAIN,
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
      const error = new Error("Failed to duck the active Spotify player");
      console.error("[LinerLore TRACE ERROR]", error);
      this.onError?.(error);
      this.setStatus("STANDBY");
      return { ok: false, reason: "DUCK_FAILED", error };
    }
    this.spotifyDucked = true;

    try {
      // 2. Fresh TTS Audio element per break — reusing a buffered element after
      // Track 1 can leave the browser player stuck and mute Tracks 2+.
      await this.playFreshDjClip(audioUrl);

      // 3. Smooth fade up 0.65 → 1.0 ONLY after voice audio finishes.
      this.setStatus("RAMPING_UP");
      const swellSignal = this.beginVolumeRamp();
      const swelled = await rampSpotifyVolumeLevel(
        token,
        SPOTIFY_DUCK_RATIO,
        SPOTIFY_UNDUCKED_GAIN,
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
          "Failed to restore Spotify volume after DJ break",
        );
        console.error("[LinerLore TRACE ERROR]", error);
        this.onError?.(error);
        await this.resetSpotifyVolume().catch((err) => {
          console.error("[LinerLore TRACE ERROR]", err);
          return false;
        });
        this.setStatus("STANDBY");
        return { ok: false, reason: "SWELL_FAILED", error };
      }
      this.spotifyDucked = false;
    } catch (playError) {
      const error =
        playError instanceof Error
          ? playError
          : new Error("Failed to play DJ audio clip");
      console.error("[LinerLore TRACE ERROR]", playError);
      this.onError?.(error);
      // Hard reset — do not leave the listener at the ducked level.
      await this.resetSpotifyVolume().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
      this.setStatus("STANDBY");
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    this.markBreakCompletedSuccessfully();
    this.setStatus("STANDBY");
    this.onDjEnd?.();

    return {
      ok: true,
      audioUrl: scriptPayload.audioUrl,
      script: scriptPayload.script,
      cached: scriptPayload.cached,
    };
  }

  private async runApplePauseTalkPlay(
    scriptPayload: DjBreakScriptResponse,
  ): Promise<RunDjBreakResult> {
    this.setStatus("DUCKING");
    const paused = await this.pauseActivePlayer();
    if (!paused) {
      const error = new Error("Failed to pause the active music player");
      this.onError?.(error);
      this.setStatus("STANDBY");
      return { ok: false, reason: "PAUSE_FAILED", error };
    }

    try {
      await this.playDjClip(scriptPayload.audioUrl);
    } catch (playError) {
      const error =
        playError instanceof Error
          ? playError
          : new Error("Failed to play DJ audio clip");
      console.error("[LinerLore TRACE ERROR]", playError);
      this.onError?.(error);
      await this.resumeActivePlayer().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return false;
      });
      this.setStatus("STANDBY");
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    this.setStatus("RAMPING_UP");
    const resumed = await this.resumeActivePlayer();
    if (!resumed) {
      const error = new Error("Failed to resume the active music player");
      this.onError?.(error);
      this.setStatus("STANDBY");
      return { ok: false, reason: "RESUME_FAILED", error };
    }

    this.markBreakCompletedSuccessfully();
    this.setStatus("STANDBY");
    this.onDjEnd?.();

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
    return this.fetchDjAudio(track);
  }

  private async fetchDjAudio(
    track: OrchestratorTrackInput,
    context: DjScriptContext = this.scriptContext,
    signal?: AbortSignal,
  ): Promise<DjBreakScriptResponse> {
    // Prefer exact Spotify/Apple playback history so recaps name songs that
    // actually aired — fall back to queue-sourced context only when empty.
    // Filter out current track ID so recentHistory only contains truly past tracks.
    const currentTrackId = track.trackId.trim();
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
      title: track.title,
      artist: track.artist,
      trackId: track.trackId,
      recentHistory: recentHistory.length,
      upcomingQueue: upcomingQueue.length,
      fromActualPlayback: this.actualPlaybackHistory.length > 0,
    });
    const response = await fetch(this.scriptEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId: track.trackId,
        voiceId: track.voiceId,
        personaId: track.personaId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        mode: track.mode,
        djMode: this.djMode,
        recentHistory,
        upcomingQueue,
      }),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `generate-script failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    const payload = (await response.json()) as DjBreakScriptResponse;
    // Companion path returns a CDN URL — no local ArrayBuffer client-side.
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

    return payload;
  }

  /** Immediate volume restore used on DJ load/play failure or abort. */
  private async resetSpotifyVolume(): Promise<boolean> {
    if (this.provider !== "spotify") return true;
    this.abortVolumeRamp();
    try {
      const token = await this.resolveSpotifyToken();
      const result = await applySpotifyVolumeNow(token, SPOTIFY_UNDUCKED_GAIN);
      if (result === true) {
        this.spotifyDucked = false;
        return true;
      }
      if (result === "NO_ACTIVE_DEVICE") {
        this.spotifyDucked = false;
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
      audio.onerror = null;
      audio.onpause = null;
      audio.onplay = null;
      audio.pause();
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

    this.disposeDjAudio();

    return new Promise<void>((resolve) => {
      const audio = new Audio();
      audio.volume = DJ_VOICE_ELEMENT_VOLUME; // Balanced gain for TTS speech over music
      this.activeDjAudio = audio;
      this.setStatus("ON_AIR");
      this.onDjStart?.();

      const finish = () => {
        audio.onended = null;
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
      audio.volume = DJ_VOICE_ELEMENT_VOLUME; // Balanced gain for TTS speech over music
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
}

/** Convenience factory matching the class constructor. */
export function createWebOrchestrator(
  options: WebOrchestratorOptions,
): WebOrchestrator {
  return new WebOrchestrator(options);
}
