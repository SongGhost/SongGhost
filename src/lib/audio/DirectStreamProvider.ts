/**
 * Statutory live music bus.
 *
 * A single long-lived `HTMLAudioElement` (CORS anonymous, set before any
 * `.src`) plays licensed HTTP streams. PCM is offered to the session analyser
 * via `getMasterAnalyser().captureMediaElement` — never a second
 * `MediaElementAudioSourceNode`. First-song rules match the YouTube adapter:
 * pause until gesture unlock, one `seekTo(0)` per load, `onPlaying` once.
 */

import type { AudioTrack } from "@/types/audio";
import {
  itunesArtistsMatch,
  itunesTitlesMatch,
} from "../itunes";
import {
  clearAudioUnlockRequest,
  isAudioUnlockPending,
  markAudioUnlockRequested,
} from "../audio-unlock";
import { BaseTrackProvider } from "./TrackProvider";
import {
  clampGain,
  getMasterAnalyser,
  logVolumeChange,
  musicGain,
  type MediaAnalyserTap,
} from "./mix-bus";

/** How Track 1 is held until the opening DJ break is on air. */
export type LaunchHoldMode = "hard_pause" | "intro_ramp";

const UNLOCK_RETRY_MS = 400;
const UNLOCK_RETRY_MAX = 60;
const LOAD_SETTLE_MS = 600;
const ERROR_COOLDOWN_MS = 2000;
const STALL_TIMEOUT_MS = 12_000;
const MAX_STREAM_RETRIES = 3;
/** If the playhead is past this while the element is playing, the opener hold was missed. */
const LAUNCH_HOLD_POSITION_SAFETY_SEC = 3;
/** Instant element stamps (`durationMs: 0`) skip when already at target. */
const INSTANT_VOLUME_MS = 0;
const GAIN_EQUALITY_EPS = 0.001;

function unlockNeeded(): boolean {
  return isAudioUnlockPending();
}

export function isHttpStreamUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

function extraString(
  extras: Record<string, string | number | boolean> | undefined,
  key: string,
): string | undefined {
  const value = extras?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Queue-row title/artist must match catalog stamps on the same `AudioTrack`.
 * A resolved HTTP URL with contradictory metadata is never assigned to `.src`.
 */
export function streamMatchesQueueMetadata(
  track:
    | {
        title?: string;
        artist?: string;
        extras?: Record<string, string | number | boolean>;
      }
    | null
    | undefined,
): boolean {
  if (!track) return false;

  const title = track.title?.trim() ?? "";
  const artist = track.artist?.trim() ?? "";
  const resolvedTitle = extraString(track.extras, "resolvedTitle");
  const resolvedArtist = extraString(track.extras, "resolvedArtist");

  if (resolvedTitle) {
    if (!title || !itunesTitlesMatch(title, resolvedTitle)) return false;
  }
  if (resolvedArtist) {
    if (!artist || !itunesArtistsMatch(artist, resolvedArtist)) return false;
  }

  return true;
}

/**
 * Resolves the HTTP URL `DirectStreamProvider` should load.
 *
 * Precedence: explicit `streamUrl` / `extras.streamUrl`, then an http(s)
 * `providerTrackId`. iTunes/Spotify `previewUrl` clips are never on-air.
 */
export function resolveDirectStreamUrl(
  track:
    | {
        streamUrl?: string;
        previewUrl?: string;
        youtubeId?: string;
        providerTrackId?: string;
        extras?: Record<string, string | number | boolean>;
      }
    | null
    | undefined,
): string | undefined {
  if (!track) return undefined;

  const extras = track.extras?.streamUrl;
  const extrasUrl = typeof extras === "string" ? extras.trim() : "";
  const explicit = track.streamUrl?.trim() || extrasUrl;
  if (isHttpStreamUrl(explicit)) return explicit;

  const providerId = track.providerTrackId?.trim();
  if (isHttpStreamUrl(providerId)) return providerId;

  return undefined;
}

export type DirectStreamProviderOptions = {
  analyser?: MediaAnalyserTap;
};

function createCorsAudioElement(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const audio = new Audio();
  // CORS must be armed before the first `.src` assignment or the mix-bus tap
  // is tainted for the life of the element.
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  return audio;
}

export class DirectStreamProvider extends BaseTrackProvider {
  readonly id = "direct_stream" as const;
  readonly capabilities = ["playback"] as const;

  private audio: HTMLAudioElement | null = null;
  private sourceUrl: string | null = null;
  private detachListeners: (() => void) | null = null;

  private pendingUnlock = unlockNeeded();
  private unlockRetryTimer: ReturnType<typeof setInterval> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  private awaitingCleanStart = false;
  private playingEmitted = false;
  private loadingTrack = false;
  private loadToken = 0;
  private lastErrorAt = 0;
  private retryCount = 0;

  /**
   * Station-launch transport lock. While set, `play()` / unlock / clean-start
   * must not leak unducked PCM: `hard_pause` stays at 0:00, `intro_ramp`
   * may play only after AudioPlayer `duckBus` is already at `DUCK_RATIO`.
   * This provider does not pin duck gain.
   */
  private launchHoldActive = false;
  private launchHoldMode: LaunchHoldMode = "hard_pause";

  private readonly analyser: MediaAnalyserTap;

  constructor(options: DirectStreamProviderOptions = {}) {
    super();
    this.analyser = options.analyser ?? getMasterAnalyser();
    this.audio = createCorsAudioElement();
    if (this.audio) this.attachListeners(this.audio);
  }

  // ---- Launch hold --------------------------------------------------------

  /** True while the opening break owns the licensed element. */
  get holdForOpeningBreak(): boolean {
    return this.launchHoldActive;
  }

  isLaunchHoldActive(): boolean {
    return this.launchHoldActive;
  }

  getLaunchHoldActive(): boolean {
    return this.launchHoldActive;
  }

  getLaunchHoldMode(): LaunchHoldMode {
    return this.launchHoldMode;
  }

  /**
   * Arm or release the Track-1 hold. Does not flip `intendedPlaying`, so the
   * React `isPlaying` effect cannot bounce the element out of a hard pause.
   *
   * Does **not** modify duck gain. `AudioPlayer` `duckBus` is the sole
   * authority for sidechain level; this method only manages transport
   * (`pause` / `playElement`). Position ticks, `playing`, `ensurePlayback`,
   * and `applyUnlock` MUST NOT invoke `setDuckGain(DUCK_RATIO)` either —
   * that fights VoiceNode's restore ramp and strands the bed at 18%.
   */
  setLaunchHold(active: boolean, mode: LaunchHoldMode = "hard_pause"): void {
    this.launchHoldActive = active;
    this.launchHoldMode = mode;
    if (!active) return;
    this.applyLaunchHold();
  }

  override setDuckGain(gain: number): void {
    if (clampGain(gain) === this.getDuckGain()) return;
    logVolumeChange("DirectStreamProvider.setDuckGain", gain, INSTANT_VOLUME_MS);
    super.setDuckGain(gain);
  }

  /** Diagnostic: live `HTMLAudioElement.volume`, or `null` when no element. */
  getMediaVolume(): number | null {
    return this.audio?.volume ?? null;
  }

  /**
   * Drops the transport lock. Does not play, seek, or restore gain — AudioPlayer
   * `releaseOpenerHold` / speech-end handlers own the 1500 ms swell when the
   * duck bus is still at `DUCK_RATIO`.
   */
  releaseLaunchHold(): void {
    this.launchHoldActive = false;
  }

  /**
   * Missed-release backstop. Once the licensed element is actually playing past
   * 3 s, the opener hold cannot still be valid — `hard_pause` never advances the
   * playhead, and an `intro_ramp` bed that deep is past the launch liner.
   * Clears the flag only; does not re-pin or restore duck gain.
   */
  private enforceLaunchHoldPositionSafety(position: number): void {
    if (!this.launchHoldActive) return;
    const audio = this.audio;
    if (!audio || !this.sourceUrl) return;
    const playing = this.intendedPlaying && !audio.paused && !audio.ended;
    if (playing && position > LAUNCH_HOLD_POSITION_SAFETY_SEC) {
      this.releaseLaunchHold();
    }
  }

  protected publishPosition(position: number, duration?: number): void {
    super.publishPosition(position, duration);
    this.enforceLaunchHoldPositionSafety(position);
  }

  private applyLaunchHold(): void {
    const audio = this.audio;
    if (!this.launchHoldActive || !audio || !this.sourceUrl) return;

    if (this.launchHoldMode === "hard_pause") {
      audio.pause();
      audio.currentTime = 0;
      this.publishPosition(0);
      this.applyVolume();
      return;
    }

    // Duck is owned by AudioPlayer duckBus. Re-apply the current gain only —
    // never `setDuckGain(DUCK_RATIO)`.
    this.applyVolume();
    if (this.awaitingCleanStart) {
      this.beginPlaybackFromStart();
      return;
    }
    if (this.intendedPlaying && audio.paused && !audio.ended) {
      audio.currentTime = 0;
      this.publishPosition(0);
      this.playElement(audio);
    }
  }

  protected applyVolume(): void {
    const audio = this.audio;
    if (!audio) return;
    const target = musicGain(this.getVolume(), this.getDuckGain());
    const durationMs = INSTANT_VOLUME_MS;
    if (durationMs === 0 && Math.abs(audio.volume - target) < GAIN_EQUALITY_EPS) {
      return;
    }
    logVolumeChange("DirectStreamProvider.applyVolume", target, durationMs);
    audio.volume = target;
  }

  protected readPosition(): { position: number; duration: number } | null {
    const audio = this.audio;
    if (!audio || !this.sourceUrl) return null;
    return { position: audio.currentTime, duration: audio.duration };
  }

  // ---- Mix-bus tap --------------------------------------------------------

  private tryCapture(): boolean {
    const audio = this.audio;
    if (!audio) return false;
    return this.analyser.captureMediaElement(audio);
  }

  // ---- Loading ------------------------------------------------------------

  async load(track: AudioTrack): Promise<void> {
    const url = resolveDirectStreamUrl(track);
    const title = track.title.trim();
    const artist = track.artist.trim();
    const metadataOk = streamMatchesQueueMetadata(track);
    const previewNeedsIdentity = /mzstatic\.com|itunes\.apple\.com/i.test(url ?? "");
    if (!url || !metadataOk || (previewNeedsIdentity && (!title || !artist))) {
      if (url && (!metadataOk || (previewNeedsIdentity && (!title || !artist)))) {
        console.warn("[DirectStreamProvider] Rejecting src — metadata mismatch", {
          title,
          artist,
          url,
        });
        this.handlers.onError?.("metadata_mismatch");
      }
      this.unload();
      return;
    }

    const audio = this.ensureAudio();
    if (!audio) return;

    if (
      this.sourceUrl === url &&
      !this.awaitingCleanStart &&
      this.currentTrack?.id === track.id &&
      this.currentTrack?.title === title &&
      this.currentTrack?.artist === artist
    ) {
      this.currentTrack = track;
      this.applyVolume();
      if (this.intendedPlaying) this.ensurePlayback();
      return;
    }

    this.currentTrack = track;

    const token = ++this.loadToken;
    this.sourceUrl = url;
    this.loadingTrack = true;
    this.playingEmitted = false;
    this.awaitingCleanStart = true;
    this.retryCount = 0;
    this.lastErrorAt = 0;
    this.clearStallTimer();
    this.resetPosition();
    this.setPlaybackState("loading");

    audio.pause();
    // `crossOrigin` was set in construction — never assign `.src` first.
    audio.src = url;
    audio.load();
    this.applyVolume();
    this.tryCapture();

    const needsUnlock = this.pendingUnlock || unlockNeeded();
    if (!this.intendedPlaying || needsUnlock) {
      audio.pause();
    }

    this.clearSettleTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.loadToken !== token) return;
      this.loadingTrack = false;
      this.applyVolume();
      if (this.intendedPlaying) this.ensurePlayback();
    }, LOAD_SETTLE_MS);
  }

  unload(): void {
    this.stopPositionPolling();
    this.clearSettleTimer();
    this.clearStallTimer();
    this.stopUnlockRetry();

    const audio = this.audio;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    this.sourceUrl = null;
    this.currentTrack = null;
    this.loadingTrack = false;
    this.awaitingCleanStart = false;
    this.playingEmitted = false;
    this.retryCount = 0;
    this.resetPosition();
    this.setPlaybackState("idle");
  }

  private ensureAudio(): HTMLAudioElement | null {
    if (this.audio) return this.audio;
    this.audio = createCorsAudioElement();
    if (this.audio) this.attachListeners(this.audio);
    return this.audio;
  }

  private attachListeners(audio: HTMLAudioElement): void {
    this.detachListeners?.();

    const onTimeUpdate = () => {
      this.publishPosition(audio.currentTime, audio.duration);
    };
    const onLoadedMetadata = () => {
      this.publishPosition(audio.currentTime, audio.duration);
      this.applyVolume();
      this.handlers.onReady?.();
    };
    const onCanPlay = () => {
      this.applyVolume();
      this.clearStallTimer();
    };
    const onEnded = () => {
      this.clearStallTimer();
      this.setPlaybackState("ended");
      this.handlers.onEnded?.();
    };
    const onError = () => this.handleStreamError(audio.error?.code ?? "cors");
    const onStalled = () => this.armStallWatch();
    const onWaiting = () => this.armStallWatch();
    const onPlaying = () => {
      this.clearStallTimer();
      this.setPlaybackState("playing");
      // Re-apply the *current* duck gain onto the element (embeds reset to 1.0).
      // Do not re-pin to DUCK_RATIO — that is an explicit state change only.
      this.applyVolume();
      this.enforceLaunchHoldPositionSafety(audio.currentTime);
      if (this.launchHoldActive && this.launchHoldMode === "hard_pause") {
        audio.pause();
        audio.currentTime = 0;
        this.publishPosition(0);
        return;
      }
      if (this.pendingUnlock || unlockNeeded()) {
        this.applyUnlock();
        return;
      }
      this.loadingTrack = false;
      if (!this.loadingTrack) this.tryEmitOnPlaying();
    };
    const onPause = () => {
      if (audio.ended) return;
      this.setPlaybackState("paused");
      if (this.loadingTrack || this.awaitingCleanStart) return;
      // Hold-induced pause must not flip React `isPlaying` — the session is
      // still on air, waiting for the opener. A user pause sets
      // `intendedPlaying` false first and is allowed through.
      if (
        this.launchHoldActive
        && this.launchHoldMode === "hard_pause"
        && this.intendedPlaying
      ) {
        return;
      }
      this.handlers.onPaused?.();
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);

    this.detachListeners = () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
    };
  }

  // ---- Transport ----------------------------------------------------------

  play(): void {
    this.intendedPlaying = true;
    this.startPositionPolling();
    this.ensurePlayback();

    if (this.pendingUnlock || unlockNeeded()) {
      if (!this.applyUnlock()) this.startUnlockRetry();
    }
  }

  /**
   * Allows a hard-pause resume to re-fire `onPlaying` so the UI leaves paused.
   */
  resetPlayingEmitted(): void {
    this.playingEmitted = false;
  }

  pause(): void {
    this.intendedPlaying = false;
    this.stopPositionPolling();
    this.audio?.pause();
  }

  seekTo(seconds: number): void {
    const audio = this.audio;
    if (!audio || !this.sourceUrl) return;
    audio.currentTime = seconds;
    this.publishPosition(seconds);
  }

  playFromStart(): void {
    this.beginPlaybackFromStart();
  }

  private beginPlaybackFromStart(): void {
    const audio = this.audio;
    if (!audio || !this.sourceUrl) return;

    this.awaitingCleanStart = false;
    audio.currentTime = 0;
    this.publishPosition(0);

    if (this.launchHoldActive && this.launchHoldMode === "hard_pause") {
      audio.pause();
      this.applyVolume();
      this.tryEmitOnPlaying();
      return;
    }

    // intro_ramp: duck was pinned when the hold was armed. Do not re-pin here.
    this.applyVolume();

    if (this.intendedPlaying) {
      this.playElement(audio);
    }

    this.tryEmitOnPlaying();
  }

  private ensurePlayback(): void {
    const audio = this.audio;
    if (!audio || !this.sourceUrl) return;

    this.applyVolume();
    this.enforceLaunchHoldPositionSafety(audio.currentTime);
    if (!this.awaitingCleanStart && !audio.paused && !audio.ended) {
      this.loadingTrack = false;
    }

    if (!this.intendedPlaying) return;

    if (this.launchHoldActive && this.launchHoldMode === "hard_pause") {
      if (this.awaitingCleanStart) {
        this.beginPlaybackFromStart();
        return;
      }
      audio.pause();
      audio.currentTime = 0;
      this.publishPosition(0);
      this.tryEmitOnPlaying();
      return;
    }

    if (this.pendingUnlock || unlockNeeded()) {
      if (this.awaitingCleanStart) audio.pause();
      this.applyUnlock();
      return;
    }

    if (this.awaitingCleanStart) {
      this.beginPlaybackFromStart();
      return;
    }

    if (audio.paused && !audio.ended) {
      this.playElement(audio);
    }

    this.tryEmitOnPlaying();
  }

  private playElement(audio: HTMLAudioElement): void {
    void audio.play().catch(() => this.recoverPlayRejection());
  }

  /**
   * Autoplay / microtask rejection must not treat the stream as dead or seek
   * back to 0:00. Unlock and re-anchor the live playhead instead.
   */
  private recoverPlayRejection(): void {
    if (!this.intendedPlaying) return;
    console.warn("[DirectStreamProvider] play() rejected; retrying unlock");
    this.pendingUnlock = true;
    markAudioUnlockRequested();
    getMasterAnalyser().unlock();
    const audio = this.audio;
    if (audio && Number.isFinite(audio.currentTime)) {
      this.publishPosition(audio.currentTime, audio.duration);
    }
    this.startUnlockRetry();
  }

  /**
   * Fires `onPlaying` once per loaded track, and only once audio can actually
   * be heard. The DJ scheduler hangs off this.
   */
  private tryEmitOnPlaying(): void {
    if (this.playingEmitted) return;
    if (this.loadingTrack) return;
    if (this.pendingUnlock || unlockNeeded()) return;

    this.playingEmitted = true;
    this.handlers.onPlaying?.();
  }

  // ---- Autoplay unlock ----------------------------------------------------

  unlockAudio(): void {
    markAudioUnlockRequested();
    this.pendingUnlock = true;
    getMasterAnalyser().unlock();
    if (!this.applyUnlock()) this.startUnlockRetry();
  }

  private applyUnlock(): boolean {
    const audio = this.audio;
    // Capture may have been declined while the context was suspended.
    // `captureMediaElement` is idempotent once the element is already routed.
    this.tryCapture();

    const alreadyPlaying = Boolean(audio && !audio.paused && !audio.ended);
    // A live element does not need another instant fader stamp — retries that
    // re-enter here were the 2–5 Hz `applyVolume(0.5, durationMs: 0)` loop.
    if (!alreadyPlaying) {
      this.applyVolume();
    } else {
      this.pendingUnlock = false;
      clearAudioUnlockRequest();
      this.stopUnlockRetry();
    }

    if (!audio || !this.sourceUrl) return alreadyPlaying;

    if (this.launchHoldActive && this.launchHoldMode === "hard_pause") {
      audio.pause();
      audio.currentTime = 0;
      this.publishPosition(0);
      this.pendingUnlock = false;
      clearAudioUnlockRequest();
      this.stopUnlockRetry();
      if (!this.loadingTrack) this.tryEmitOnPlaying();
      return true;
    }

    // intro_ramp: duck was pinned when the hold was armed. Re-apply the current
    // gain so a gesture unlock cannot leak a full-level *element* frame, but
    // do not re-pin duck to DUCK_RATIO (that would undo a VoiceNode restore).
    if (this.launchHoldActive && this.launchHoldMode === "intro_ramp" && !alreadyPlaying) {
      this.applyVolume();
    }

    if (this.intendedPlaying) {
      if (this.awaitingCleanStart) {
        this.beginPlaybackFromStart();
      } else if (audio.paused && !audio.ended) {
        this.playElement(audio);
        this.tryEmitOnPlaying();
      } else {
        this.tryEmitOnPlaying();
      }
    }

    const playing = !audio.paused && !audio.ended;
    if (playing) {
      this.pendingUnlock = false;
      clearAudioUnlockRequest();
      this.stopUnlockRetry();
    }
    return playing;
  }

  private startUnlockRetry(): void {
    if (this.unlockRetryTimer) return;
    let attempts = 0;

    this.unlockRetryTimer = setInterval(() => {
      attempts += 1;

      if (!this.pendingUnlock && !unlockNeeded()) {
        this.stopUnlockRetry();
        this.tryEmitOnPlaying();
        return;
      }

      this.pendingUnlock = true;
      this.applyUnlock();

      if (attempts >= UNLOCK_RETRY_MAX) {
        this.pendingUnlock = false;
        clearAudioUnlockRequest();
        this.stopUnlockRetry();
        if (this.awaitingCleanStart) this.beginPlaybackFromStart();
        else this.tryEmitOnPlaying();
      }
    }, UNLOCK_RETRY_MS);
  }

  private stopUnlockRetry(): void {
    if (!this.unlockRetryTimer) return;
    clearInterval(this.unlockRetryTimer);
    this.unlockRetryTimer = null;
  }

  // ---- Errors / stalls ----------------------------------------------------

  private handleStreamError(code: number | string): void {
    if (!this.sourceUrl) return;

    const now = Date.now();
    if (now - this.lastErrorAt < ERROR_COOLDOWN_MS) return;
    this.lastErrorAt = now;

    if (this.retryCount < MAX_STREAM_RETRIES) {
      this.retryCount += 1;
      this.retryCurrentStream();
      return;
    }

    this.setPlaybackState("error");
    console.warn("[DirectStreamProvider] Stream failed after retries:", code);
    this.handlers.onError?.(code);
  }

  private retryCurrentStream(): void {
    const audio = this.audio;
    const url = this.sourceUrl;
    if (!audio || !url) return;

    this.loadingTrack = true;
    this.awaitingCleanStart = true;
    this.playingEmitted = false;
    this.setPlaybackState("loading");
    audio.pause();
    audio.crossOrigin = "anonymous";
    audio.src = url;
    audio.load();
    this.applyVolume();
    this.tryCapture();

    const token = ++this.loadToken;
    this.clearSettleTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.loadToken !== token) return;
      this.loadingTrack = false;
      this.applyVolume();
      if (this.intendedPlaying) this.ensurePlayback();
    }, LOAD_SETTLE_MS);
  }

  private armStallWatch(): void {
    if (this.stallTimer || !this.intendedPlaying || !this.sourceUrl) return;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      this.handleStreamError("stall");
    }, STALL_TIMEOUT_MS);
  }

  private clearStallTimer(): void {
    if (!this.stallTimer) return;
    clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private clearSettleTimer(): void {
    if (!this.settleTimer) return;
    clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  destroy(): void {
    this.stopUnlockRetry();
    this.clearSettleTimer();
    this.clearStallTimer();
    this.detachListeners?.();
    this.detachListeners = null;

    const audio = this.audio;
    if (audio) {
      this.analyser.releaseMediaElement(audio);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    this.audio = null;
    this.sourceUrl = null;
    this.currentTrack = null;
    this.awaitingCleanStart = false;
    this.playingEmitted = false;
    this.launchHoldActive = false;
    super.destroy();
  }
}
