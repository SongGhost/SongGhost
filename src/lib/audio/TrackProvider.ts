/**
 * Music playback adapters.
 *
 * Every provider owns the music channel end to end: the master fader, the
 * sidechain duck gain, the loaded track, and the position clock. Levels are
 * provider state rather than per-track state, which is what stops a track load
 * from resetting a duck that is still on air — embeds reset themselves to full
 * volume when a new module goes live, so the provider re-asserts the computed
 * level on every ready / load / playing transition instead of trusting it.
 *
 * The engine talks to this surface only, so YouTube and HTML5 (and later
 * Spotify) stay interchangeable behind `TrackProvider`.
 */

import type {
  AudioTrack,
  PlaybackState,
  TrackProvider,
  TrackProviderCapability,
  TrackProviderEventHandlers,
  TrackProviderId,
  VolumeController,
} from "@/types/audio";
import {
  clearAudioUnlockRequest,
  isAudioUnlockPending,
  markAudioUnlockRequested,
} from "../audio-unlock";
import {
  clampGain,
  getMasterAnalyser,
  musicGain,
  musicVolumePercent,
  UNDUCKED_GAIN,
  type MediaAnalyserTap,
} from "./mix-bus";
import { createVolumeController } from "./volume-controller";

const POSITION_POLL_MS = 500;

function unlockNeeded(): boolean {
  return isAudioUnlockPending();
}

/** Minimal `AudioTrack` for a provider that only needs the native id. */
export function trackFromProviderId(
  provider: TrackProviderId,
  providerTrackId: string,
  metadata: Partial<Omit<AudioTrack, "provider" | "providerTrackId">> = {},
): AudioTrack {
  return {
    id: metadata.id ?? providerTrackId,
    title: metadata.title ?? "",
    artist: metadata.artist ?? "",
    provider,
    providerTrackId,
    ...metadata,
  };
}

export abstract class BaseTrackProvider implements TrackProvider {
  abstract readonly id: TrackProviderId;
  abstract readonly capabilities: readonly TrackProviderCapability[];

  protected handlers: TrackProviderEventHandlers = {};
  protected currentTrack: AudioTrack | null = null;
  /** Whether the engine wants audio running, independent of the player's state. */
  protected intendedPlaying = false;

  private masterVolume = 1;
  private duckGain = UNDUCKED_GAIN;
  private playbackState: PlaybackState = "idle";
  private position = 0;
  private trackDuration = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private volumeController: VolumeController | null = null;

  abstract load(track: AudioTrack): Promise<void>;
  abstract play(): void;
  abstract pause(): void;
  abstract seekTo(seconds: number): void;
  /** Drops the loaded track without tearing down the player itself. */
  abstract unload(): void;

  setEventHandlers(handlers: TrackProviderEventHandlers): void {
    this.handlers = handlers;
  }

  getTrack(): AudioTrack | null {
    return this.currentTrack;
  }

  // ---- Levels -------------------------------------------------------------

  getVolume(): number {
    return this.masterVolume;
  }

  setVolume(normalized: number): void {
    this.masterVolume = clampGain(normalized);
    this.applyVolume();
  }

  getDuckGain(): number {
    return this.duckGain;
  }

  /**
   * Sidechain gain for the music channel, relative to master. Voice nodes ramp
   * this while a break is on air; it never reaches the speech channel.
   */
  setDuckGain(gain: number): void {
    this.duckGain = clampGain(gain);
    this.applyVolume();
  }

  /** Music level as 0–1, for element-based players. */
  protected get musicLevel(): number {
    return musicGain(this.masterVolume, this.duckGain);
  }

  /** Music level as 0–100, the scale the YouTube IFrame API expects. */
  protected get musicLevelPercent(): number {
    return musicVolumePercent(this.masterVolume, this.duckGain);
  }

  /** Pushes the current music level onto the underlying player. */
  protected abstract applyVolume(): void;

  getVolumeController(): VolumeController {
    if (!this.volumeController) {
      this.volumeController = createVolumeController({
        getVolume: () => this.getVolume(),
        setVolume: (normalized) => this.setVolume(normalized),
      });
    }
    return this.volumeController;
  }

  // ---- Transport state ----------------------------------------------------

  getPlaybackState(): PlaybackState {
    return this.playbackState;
  }

  protected setPlaybackState(next: PlaybackState): void {
    if (this.playbackState === next) return;
    this.playbackState = next;
    this.handlers.onStateChange?.(next);
  }

  // ---- Position clock -----------------------------------------------------

  getPosition(): number {
    return this.position;
  }

  getCurrentTime(): number {
    return this.getPosition();
  }

  getDuration(): number {
    return this.trackDuration;
  }

  /**
   * Duration is sticky: providers report it as 0 while a stream is still
   * settling, and letting that overwrite a known duration makes the progress
   * bar collapse mid-track.
   */
  protected publishPosition(position: number, duration?: number): void {
    this.position = Number.isFinite(position) && position > 0 ? position : 0;
    if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
      this.trackDuration = duration;
    }
    this.handlers.onTimeUpdate?.(this.position, this.trackDuration);
  }

  /** A new track inherits neither position nor duration. */
  protected resetPosition(): void {
    this.position = 0;
    this.trackDuration = 0;
    this.handlers.onTimeUpdate?.(0, 0);
  }

  /** Current position straight from the player, or `null` if it can't answer. */
  protected abstract readPosition(): { position: number; duration: number } | null;

  protected startPositionPolling(): void {
    if (this.pollTimer) return;

    const tick = () => {
      const reading = this.readPosition();
      if (!reading) return;
      this.publishPosition(reading.position, reading.duration);
    };

    tick();
    this.pollTimer = setInterval(tick, POSITION_POLL_MS);
  }

  protected stopPositionPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * Tears down the player. Event handlers survive so the provider can be
   * mounted again — React remounts the host element without re-subscribing.
   */
  destroy(): void {
    this.stopPositionPolling();
  }
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
  isMuted: () => boolean;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  destroy: () => void;
};

/**
 * YT IFrame API stubs can exist before methods are bound (and go stale on
 * route unmount). Never call a method unless it is actually a function.
 */
function callYouTubePlayer<K extends keyof YouTubePlayer>(
  player: YouTubePlayer | null | undefined,
  method: K,
  ...args: Parameters<YouTubePlayer[K]>
): ReturnType<YouTubePlayer[K]> | undefined {
  if (!player) return undefined;
  const fn = player[method];
  if (typeof fn !== "function") return undefined;
  try {
    return (fn as (...fnArgs: Parameters<YouTubePlayer[K]>) => ReturnType<YouTubePlayer[K]>).apply(
      player,
      args,
    );
  } catch {
    // Embed torn down or not ready
    return undefined;
  }
}

type YouTubePlayerConstructor = new (
  element: HTMLElement | string,
  config: {
    videoId?: string;
    width?: string | number;
    height?: string | number;
    playerVars?: Record<string, number | string>;
    events?: {
      onReady?: () => void;
      onStateChange?: (event: { data: number }) => void;
      onError?: (event: { data: number }) => void;
    };
  },
) => YouTubePlayer;

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
        UNSTARTED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading = false;
let apiReady = false;
const readyCallbacks: Array<() => void> = [];

const ERROR_COOLDOWN_MS = 2000;
const UNLOCK_RETRY_MS = 400;
const YT_UNLOCK_RETRY_MAX = 30;
const LOAD_SETTLE_MS = 600;
/** Code 2 during the first moments of a load is the embed still warming up. */
const EMBED_WARMUP_MS = 2500;
/** `setVolume(0)` fights the unMute path on some embeds, so never floor to zero. */
const MIN_PLAYER_PERCENT = 1;

function loadYouTubeAPI() {
  if (typeof window === "undefined") return;
  if (window.YT?.Player) {
    apiReady = true;
    return;
  }
  if (apiLoading) return;

  apiLoading = true;
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.body.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    apiReady = true;
    readyCallbacks.splice(0).forEach((cb) => cb());
  };
}

function onAPIReady(callback: () => void) {
  if (apiReady && window.YT?.Player) {
    callback();
    return;
  }
  readyCallbacks.push(callback);
}

export class YouTubeTrackProvider extends BaseTrackProvider {
  readonly id = "youtube" as const;
  readonly capabilities = ["playback"] as const;

  private player: YouTubePlayer | null = null;
  private mountEl: HTMLElement | null = null;
  private ready = false;
  private disposed = false;

  /** What the engine asked for; survives teardown so a remount can restore it. */
  private desiredVideoId: string | null = null;
  private loadedVideoId: string | null = null;

  private loadingVideo = false;
  private loadStartedAt = 0;
  private loadToken = 0;
  private lastErrorAt = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingUnlock = unlockNeeded();
  private unlockRetryTimer: ReturnType<typeof setInterval> | null = null;

  /** A freshly loaded video must be seeked to 0 before it is allowed to play. */
  private awaitingCleanStart = false;
  private playingEmitted = false;

  mount(container: HTMLElement): void {
    if (this.mountEl) return;

    this.disposed = false;
    loadYouTubeAPI();

    const mount = document.createElement("div");
    mount.className = "yt-player-mount";
    container.appendChild(mount);
    this.mountEl = mount;

    onAPIReady(() => {
      if (this.disposed || this.player || this.mountEl !== mount) return;
      if (unlockNeeded()) this.pendingUnlock = true;

      this.player = new window.YT!.Player(mount, {
        width: "320",
        height: "180",
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          disablekb: 1,
          enablejsapi: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => this.handlePlayerReady(),
          onStateChange: (event) => this.handleStateChange(event.data),
          onError: (event) => this.handlePlayerError(event.data),
        },
      });
    });
  }

  private handlePlayerReady(): void {
    if (this.disposed) return;

    this.ready = true;
    this.handlers.onReady?.();

    if (this.desiredVideoId) {
      this.loadVideo(this.desiredVideoId, this.intendedPlaying);
    } else {
      this.applyVolume();
    }

    if (this.pendingUnlock || unlockNeeded()) {
      this.pendingUnlock = true;
      if (!this.applyUnlock()) this.startUnlockRetry();
    }
  }

  private handleStateChange(data: number): void {
    const states = window.YT?.PlayerState;
    if (!states) return;

    if (data === states.PLAYING) {
      this.setPlaybackState("playing");
      this.applyVolume();

      const player = this.player;
      if (callYouTubePlayer(player, "isMuted")) {
        callYouTubePlayer(player, "unMute");
        this.applyVolume();
      }

      if (this.pendingUnlock || unlockNeeded()) {
        this.applyUnlock();
        return;
      }

      if (!this.loadingVideo) this.tryEmitOnPlaying();
      return;
    }

    if (data === states.BUFFERING) {
      this.setPlaybackState("buffering");
      return;
    }

    if (data === states.PAUSED) {
      this.setPlaybackState("paused");
      // A pause the engine did not ask for: during a load or a pending clean
      // start it is our own sequencing, not the listener hitting stop.
      if (!this.loadingVideo && !this.awaitingCleanStart) this.handlers.onPaused?.();
      return;
    }

    if (data === states.ENDED) {
      this.setPlaybackState("ended");
      this.handlers.onEnded?.();
    }
  }

  private handlePlayerError(code: number): void {
    const elapsed = Date.now() - this.loadStartedAt;

    if (this.loadingVideo) return;
    if (code === 2 && elapsed < EMBED_WARMUP_MS) return;

    const now = Date.now();
    if (now - this.lastErrorAt < ERROR_COOLDOWN_MS) return;
    this.lastErrorAt = now;

    this.setPlaybackState("error");
    console.warn("[YouTubeTrackProvider] Skipping unplayable video:", code);
    this.handlers.onError?.(code);
  }

  // ---- Levels -------------------------------------------------------------

  protected applyVolume(): void {
    const player = this.player;
    if (!player || !this.ready) return;
    callYouTubePlayer(player, "unMute");
    callYouTubePlayer(
      player,
      "setVolume",
      Math.max(MIN_PLAYER_PERCENT, this.musicLevelPercent),
    );
  }

  protected readPosition(): { position: number; duration: number } | null {
    const player = this.player;
    if (!player || !this.ready) return null;
    const position = callYouTubePlayer(player, "getCurrentTime");
    const duration = callYouTubePlayer(player, "getDuration");
    if (typeof position !== "number" && typeof duration !== "number") return null;
    return {
      position: position ?? 0,
      duration: duration ?? 0,
    };
  }

  // ---- Loading ------------------------------------------------------------

  async load(track: AudioTrack): Promise<void> {
    const videoId = track.providerTrackId.trim();
    if (!videoId) {
      this.unload();
      return;
    }

    this.currentTrack = track;
    this.desiredVideoId = videoId;
    // A load before the embed is ready is not a failure: `onReady` replays it.
    this.loadVideo(videoId, this.intendedPlaying);
  }

  unload(): void {
    this.currentTrack = null;
    this.desiredVideoId = null;
    this.loadedVideoId = null;
    this.loadingVideo = false;
    this.awaitingCleanStart = false;
    this.playingEmitted = false;
    this.clearSettleTimer();
    this.stopPositionPolling();
    this.resetPosition();
    callYouTubePlayer(this.player, "pauseVideo");
    this.setPlaybackState("idle");
  }

  private loadVideo(videoId: string, autoplay: boolean): boolean {
    const player = this.player;
    if (!player || !this.ready) return false;

    if (this.loadedVideoId === videoId && !this.awaitingCleanStart) {
      if (autoplay) this.ensurePlayback();
      return true;
    }

    const token = ++this.loadToken;
    this.loadingVideo = true;
    this.loadStartedAt = Date.now();
    this.playingEmitted = false;
    this.awaitingCleanStart = true;
    this.lastErrorAt = 0;
    this.loadedVideoId = videoId;

    this.setPlaybackState("loading");
    callYouTubePlayer(player, "loadVideoById", videoId, 0);
    this.applyVolume();
    this.resetPosition();

    const needsUnlock = this.pendingUnlock || unlockNeeded();

    if (autoplay && !needsUnlock) {
      callYouTubePlayer(player, "playVideo");
    } else {
      callYouTubePlayer(player, "pauseVideo");
    }

    this.clearSettleTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.loadToken !== token) return;
      this.loadingVideo = false;
      // The embed applies its own 100% default once the new module goes live,
      // which lands after the synchronous sync above.
      this.applyVolume();
      if (autoplay) this.ensurePlayback();
    }, LOAD_SETTLE_MS);

    return true;
  }

  private clearSettleTimer(): void {
    if (!this.settleTimer) return;
    clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  // ---- Transport ----------------------------------------------------------

  play(): void {
    this.intendedPlaying = true;
    this.startPositionPolling();
    this.ensurePlayback();

    if (this.ready && (this.pendingUnlock || unlockNeeded())) {
      if (!this.applyUnlock()) this.startUnlockRetry();
    }
  }

  pause(): void {
    this.intendedPlaying = false;
    this.stopPositionPolling();
    callYouTubePlayer(this.player, "pauseVideo");
  }

  seekTo(seconds: number): void {
    const player = this.player;
    if (!player || !this.ready) return;
    callYouTubePlayer(player, "seekTo", seconds, true);
    this.publishPosition(seconds);
  }

  /** Single seek to 0 then play — the first-song start sequence. */
  playFromStart(): void {
    this.beginPlaybackFromStart();
  }

  private beginPlaybackFromStart(): void {
    const player = this.player;
    if (!player || !this.ready) return;

    this.awaitingCleanStart = false;

    callYouTubePlayer(player, "seekTo", 0, true);
    this.publishPosition(0);

    this.applyVolume();

    if (this.intendedPlaying) callYouTubePlayer(player, "playVideo");

    this.tryEmitOnPlaying();
  }

  private ensurePlayback(): void {
    const player = this.player;
    if (!player || !this.ready || !this.desiredVideoId) return;

    this.applyVolume();

    if (!this.intendedPlaying) return;

    if (this.pendingUnlock || unlockNeeded()) {
      if (this.awaitingCleanStart) {
        callYouTubePlayer(player, "pauseVideo");
      }
      this.applyUnlock();
      return;
    }

    if (this.awaitingCleanStart) {
      this.beginPlaybackFromStart();
      return;
    }

    const state = callYouTubePlayer(player, "getPlayerState");
    const states = window.YT?.PlayerState;
    const needsPlay =
      state === states?.PAUSED ||
      state === states?.CUED ||
      state === states?.UNSTARTED ||
      state === undefined;

    if (needsPlay) callYouTubePlayer(player, "playVideo");

    this.tryEmitOnPlaying();
  }

  /**
   * Fires `onPlaying` once per loaded track, and only once audio can actually
   * be heard. The DJ scheduler hangs off this, so emitting it while the embed
   * is still muted would burn a break into silence.
   */
  private tryEmitOnPlaying(): void {
    if (this.playingEmitted) return;
    if (this.loadingVideo) return;
    if (this.pendingUnlock || unlockNeeded()) return;

    this.playingEmitted = true;
    this.handlers.onPlaying?.();
  }

  // ---- Autoplay unlock ----------------------------------------------------

  unlockAudio(): void {
    markAudioUnlockRequested();
    this.pendingUnlock = true;
    if (!this.applyUnlock()) this.startUnlockRetry();
  }

  private applyUnlock(): boolean {
    const player = this.player;
    if (!player || !this.ready) return false;

    this.applyVolume();
    callYouTubePlayer(player, "unMute");
    this.applyVolume();

    const stillMuted = callYouTubePlayer(player, "isMuted") ?? false;
    const state = callYouTubePlayer(player, "getPlayerState");
    const states = window.YT?.PlayerState;
    const isPlayingState = state === states?.PLAYING || state === states?.BUFFERING;

    if (!stillMuted && (isPlayingState || state === states?.CUED || state === states?.PAUSED)) {
      this.pendingUnlock = false;
      clearAudioUnlockRequest();
      this.stopUnlockRetry();
    }

    if (this.intendedPlaying) {
      if (this.awaitingCleanStart) {
        this.beginPlaybackFromStart();
      } else if (
        state === states?.PAUSED ||
        state === states?.CUED ||
        state === states?.UNSTARTED ||
        state === undefined
      ) {
        callYouTubePlayer(player, "playVideo");
        this.tryEmitOnPlaying();
      } else {
        this.tryEmitOnPlaying();
      }
    }

    return !stillMuted;
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

      // Give up rather than gate playback forever: a listener who never
      // produces a usable gesture still gets audio, muted or not.
      if (attempts >= YT_UNLOCK_RETRY_MAX) {
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

  destroy(): void {
    this.disposed = true;
    this.stopUnlockRetry();
    this.clearSettleTimer();
    super.destroy();

    callYouTubePlayer(this.player, "destroy");

    this.player = null;
    this.ready = false;
    this.loadedVideoId = null;
    this.awaitingCleanStart = false;
    this.playingEmitted = false;
    this.mountEl?.remove();
    this.mountEl = null;
  }
}

// ---------------------------------------------------------------------------
// HTML5
// ---------------------------------------------------------------------------

const HTML5_UNLOCK_RETRY_MAX = 60;

export type Html5TrackProviderOptions = {
  /** Metering tap for direct/native audio sources. Defaults to the session analyser. */
  analyser?: MediaAnalyserTap;
};

/**
 * `HTMLAudioElement` fallback, used for iTunes preview clips when a track has
 * no playable YouTube embed. Position comes from element events rather than a
 * poll, so it reports finer-grained progress than the YouTube adapter.
 *
 * Unlike the YouTube adapter, this element is same-origin and native, so its
 * PCM output is exactly what Web Audio can observe. Every element is offered
 * to the master analyser for the life of its clip, mirroring the DJ voice
 * channel's own tap — a refusal (suspended context, no Web Audio at all)
 * simply leaves the clip on native playback, costing a visualization and
 * nothing else.
 */
export class Html5TrackProvider extends BaseTrackProvider {
  readonly id: TrackProviderId;
  readonly capabilities = ["playback"] as const;

  private audio: HTMLAudioElement | null = null;
  private sourceUrl: string | null = null;
  private detachListeners: (() => void) | null = null;

  private pendingUnlock = false;
  private unlockRetryTimer: ReturnType<typeof setInterval> | null = null;

  private readonly analyser: MediaAnalyserTap;

  constructor(providerId: TrackProviderId = "itunes", options: Html5TrackProviderOptions = {}) {
    super();
    this.id = providerId;
    this.analyser = options.analyser ?? getMasterAnalyser();
  }

  protected applyVolume(): void {
    if (this.audio) this.audio.volume = this.musicLevel;
  }

  protected readPosition(): { position: number; duration: number } | null {
    const audio = this.audio;
    if (!audio) return null;
    return { position: audio.currentTime, duration: audio.duration };
  }

  async load(track: AudioTrack): Promise<void> {
    const url = track.providerTrackId.trim();
    if (!url) {
      this.unload();
      return;
    }
    if (this.sourceUrl === url && this.audio) return;

    this.unload();

    this.currentTrack = track;
    this.sourceUrl = url;
    this.setPlaybackState("loading");

    const audio = new Audio(url);
    audio.preload = "auto";
    this.audio = audio;
    this.applyVolume();
    this.attachListeners(audio);

    // Offers the clip to the master analyser so the visualizer reads a true
    // spectrum from direct audio instead of falling back to the synthetic
    // drive. Element volume is applied ahead of the tap, so a decline leaves
    // the clip on native playback at the same level.
    this.analyser.captureMediaElement(audio);

    if (this.intendedPlaying || this.pendingUnlock) {
      void audio.play().catch(() => this.handlers.onError?.());
    }
  }

  private attachListeners(audio: HTMLAudioElement): void {
    const onTimeUpdate = () => this.publishPosition(audio.currentTime, audio.duration);
    const onLoadedMetadata = () => this.publishPosition(audio.currentTime, audio.duration);

    const onEnded = () => {
      this.setPlaybackState("ended");
      this.handlers.onEnded?.();
    };

    const onError = () => {
      this.setPlaybackState("error");
      console.error("[Html5TrackProvider] Preview playback error");
      this.handlers.onError?.();
    };

    const onPlay = () => {
      this.setPlaybackState("playing");
      this.applyVolume();
      this.handlers.onPlaying?.();
    };

    const onPause = () => {
      if (audio.ended) return;
      this.setPlaybackState("paused");
      this.handlers.onPaused?.();
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    this.detachListeners = () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }

  unload(): void {
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
    this.resetPosition();
    this.setPlaybackState("idle");
  }

  play(): void {
    this.intendedPlaying = true;
    const audio = this.audio;
    if (!audio) return;
    void audio.play().catch(() => this.handlers.onError?.());
  }

  pause(): void {
    this.intendedPlaying = false;
    this.audio?.pause();
  }

  seekTo(seconds: number): void {
    const audio = this.audio;
    if (!audio) return;
    audio.currentTime = seconds;
    this.publishPosition(seconds);
  }

  playFromStart(): void {
    const audio = this.audio;
    if (!audio) return;
    audio.currentTime = 0;
    this.publishPosition(0);
    this.applyVolume();
    if (this.intendedPlaying) {
      void audio.play().catch(() => this.handlers.onError?.());
    }
  }

  unlockAudio(): void {
    markAudioUnlockRequested();
    this.pendingUnlock = true;
    if (!this.applyUnlock()) this.startUnlockRetry();
  }

  private applyUnlock(): boolean {
    const audio = this.audio;
    if (!audio) return false;

    // The capture at `load` may have found the analyser's context still
    // suspended; a gesture reaching here is the retry window where it has
    // since resumed. `captureMediaElement` is idempotent, so this costs
    // nothing once the element is already routed through.
    this.analyser.captureMediaElement(audio);

    this.applyVolume();
    if (this.intendedPlaying) {
      void audio.play().catch(() => this.handlers.onError?.());
    }

    const playing = !audio.paused && !audio.ended;
    if (playing) {
      this.pendingUnlock = false;
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
        return;
      }

      this.pendingUnlock = true;
      const unlocked = this.applyUnlock();
      if (unlocked || (attempts >= HTML5_UNLOCK_RETRY_MAX && !unlockNeeded())) {
        this.stopUnlockRetry();
      }
    }, UNLOCK_RETRY_MS);
  }

  private stopUnlockRetry(): void {
    if (!this.unlockRetryTimer) return;
    clearInterval(this.unlockRetryTimer);
    this.unlockRetryTimer = null;
  }

  destroy(): void {
    this.stopUnlockRetry();
    super.destroy();
    this.unload();
  }
}
