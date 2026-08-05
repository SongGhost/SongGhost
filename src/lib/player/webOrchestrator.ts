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

/** Companion DJ break cadence — every song vs traditional FM spacing. */
export type BreakFrequency = "every_track" | "spaced";

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

/** Default break cadence — traditional FM spacing (every 2–3 tracks). */
const DEFAULT_BREAK_FREQUENCY: BreakFrequency = "spaced";

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
  private readonly onError?: (error: Error) => void;

  private activeDjAudio: HTMLAudioElement | null = null;
  /** Break-in-progress lock — must clear on track end / new trackId. */
  private running = false;
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
  /** Tracks since the last voiced break — drives the live fallback safety net. */
  private tracksSinceLastBreak = 0;
  /** Station pacing frequency (legacy numeric window min gap). */
  private djPacingFrequency = DEFAULT_DJ_PACING_FREQUENCY;
  /**
   * Companion break cadence.
   * - `every_track`: speak at the start of every song
   * - `spaced` (default): every 2–3 tracks like traditional FM
   */
  private breakFrequency: BreakFrequency = DEFAULT_BREAK_FREQUENCY;
  /** For `spaced` mode — next voiced break after this many track advances (2 or 3). */
  private spacedTracksUntilBreak = 2;
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
    this.onError = options.onError;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get lastExecutedBreakTrackId(): string | null {
    return this.lastBreakTrackId;
  }

  /** Update companion pacing used by the registerTrack live-fallback safety net. */
  setDjPacingFrequency(pacing: number): void {
    if (typeof pacing === "number" && Number.isFinite(pacing) && pacing >= 0) {
      this.djPacingFrequency = Math.max(0, Math.floor(pacing));
    }
  }

  /**
   * Configure DJ break cadence.
   * - `every_track`: every song change immediately invokes a DJ break
   * - `spaced`: voiced break every 2–3 tracks (default)
   */
  setBreakFrequency(frequency: BreakFrequency): void {
    if (frequency === "every_track" || frequency === "spaced") {
      this.breakFrequency = frequency;
    }
  }

  getBreakFrequency(): BreakFrequency {
    return this.breakFrequency;
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
    if (this.breakFrequency === "every_track") return true;
    // music_only-style mute via pacing 0
    if (this.djPacingFrequency <= 0) return false;
    return this.tracksSinceLastBreak + 1 >= this.spacedTracksUntilBreak;
  }

  private rollSpacedGap(): void {
    // Traditional FM: voiced break every 2 or 3 tracks.
    this.spacedTracksUntilBreak = 2 + Math.floor(Math.random() * 2);
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

    const previousId = this.registeredTrackId;
    this.registeredTrackId = trackId;
    this.releaseBreakLocks();

    if (previousId) {
      this.tracksSinceLastBreak += 1;
    }

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
          { trackId, breakFrequency: this.breakFrequency },
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
    if (this.breakFrequency === "every_track") return true;
    // music_only-style mute: pacing 0 means never force a live fallback.
    if (this.djPacingFrequency <= 0) return false;
    return this.tracksSinceLastBreak >= this.spacedTracksUntilBreak;
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
    this.tracksSinceLastBreak = 0;
    if (this.breakFrequency === "spaced") {
      this.rollSpacedGap();
    }
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

      const scriptPayload = await warmed.promise;
      if (!scriptPayload.audioUrl) {
        const error = new Error("prefetched generate-script response missing audioUrl");
        console.error("[LinerLore TRACE ERROR]", error);
        this.onError?.(error);
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
    if (this.djPrefetchByTrackId.has(key)) return;

    // Spaced cadence: skip warmup when the next advance will not voice a break.
    if (!this.willBreakOnNextTrack()) {
      console.log("[LinerLore TRACE] Autopilot skip prefetch — break not due", {
        trackId: key,
        breakFrequency: this.breakFrequency,
        tracksSinceLastBreak: this.tracksSinceLastBreak,
        spacedTracksUntilBreak: this.spacedTracksUntilBreak,
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

    const pending = this.fetchDjAudio(track, this.scriptContext).catch((err) => {
      this.djPrefetchByTrackId.delete(key);
      if (this.nextPrefetchKey === key) this.nextPrefetchKey = null;
      console.error("[LinerLore TRACE ERROR]", err);
      throw err;
    });
    this.djPrefetchByTrackId.set(key, { track, promise: pending });
    this.nextPrefetchKey = key;

    try {
      await pending;
    } catch {
      // Prefetch is best-effort — live runDjBreak / registerTrack fallback will retry.
    }
  }

  /** Drop any warmed clips (station switch / teardown). */
  clearDjPrefetch(): void {
    this.djPrefetchByTrackId.clear();
    this.nextPrefetchKey = null;
  }

  /** Full teardown of break debounce state (station switch). */
  resetBreakSession(): void {
    this.releaseBreakLocks();
    this.lastBreakTrackId = null;
    this.executedBreakTrackIds.clear();
    this.registeredTrackId = null;
    this.tracksSinceLastBreak = 0;
    this.spacedTracksUntilBreak = 2;
    this.scriptContext = {};
    this.actualPlaybackHistory = [];
    this.lastVoiceId = null;
    this.lastPersonaId = null;
    this.lastMode = undefined;
    this.registerTrackWork = Promise.resolve();
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
  ): Promise<RunDjBreakResult> {
    const trackId = track.trackId.trim();
    this.rememberVoiceContext(track);

    // Strict track-ID debounce: one break per trackId per session (includes
    // aliases recorded when registerTrack consumed a prefetch).
    if (
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

      const scriptPayload = await this.resolveDjAudio(track);
      if (!scriptPayload.audioUrl) {
        const error = new Error("generate-script response missing audioUrl");
        this.onError?.(error);
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
      return { ok: false, reason: "NO_ACTIVE_DEVICE" };
    }
    if (ducked !== true) {
      const error = new Error("Failed to duck the active Spotify player");
      console.error("[LinerLore TRACE ERROR]", error);
      this.onError?.(error);
      return { ok: false, reason: "DUCK_FAILED", error };
    }
    this.spotifyDucked = true;

    try {
      // 2. Fresh TTS Audio element per break — reusing a buffered element after
      // Track 1 can leave the browser player stuck and mute Tracks 2+.
      await this.playFreshDjClip(audioUrl);

      // 3. Smooth fade up 0.65 → 1.0 ONLY after voice audio finishes.
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
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

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
    const paused = await this.pauseActivePlayer();
    if (!paused) {
      const error = new Error("Failed to pause the active music player");
      this.onError?.(error);
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
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    const resumed = await this.resumeActivePlayer();
    if (!resumed) {
      const error = new Error("Failed to resume the active music player");
      this.onError?.(error);
      return { ok: false, reason: "RESUME_FAILED", error };
    }

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
        recentHistory,
        upcomingQueue,
      }),
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
