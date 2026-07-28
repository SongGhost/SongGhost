/**
 * Provider-agnostic audio pipeline contracts.
 * Adapters (YouTube, Spotify, iTunes, Apple Music) and voice nodes (OpenAI,
 * ElevenLabs, Cartesia) implement these interfaces so the broadcast engine
 * can mix music + DJ voice with sidechain ducking without coupling to a vendor.
 */

/** Playback source for music tracks */
export type TrackProviderId = "youtube" | "spotify" | "itunes" | "apple_music";

/** What a track provider can do beyond raw playback */
export type TrackProviderCapability = "playback" | "search" | "metadata";

export type PlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "error";

/**
 * Canonical track shape for queues, history, and cross-provider adapters.
 * `providerTrackId` holds the native id (YouTube video id, Spotify URI, etc.).
 */
export type AudioTrack = {
  /** Stable SongGhost id for queue slots, history, and deduplication */
  id: string;
  title: string;
  artist: string;
  provider: TrackProviderId;
  providerTrackId: string;
  album?: string;
  durationSeconds?: number;
  artworkUrl?: string;
  /** Provider-specific fields (preview URL, playlist id, embed flags, etc.) */
  extras?: Record<string, string | number | boolean>;
};

/** Normalized volume bus shared by music and voice layers for ducking ramps */
export type VolumeController = {
  /** Current level, 0–1 */
  getVolume: () => number;
  /** Set level immediately, 0–1 */
  setVolume: (normalized: number) => void;
  /**
   * Smooth transition for sidechain ducking. Returns a cancel function.
   * Phase 2 engine uses this instead of ad-hoc setVolume calls.
   */
  rampVolume: (from: number, to: number, durationMs: number) => () => void;
};

/** Sidechain ducking parameters for dual-track broadcast (Phase 2) */
export type DuckingConfig = {
  /** Target music level while voice is active (e.g. 0.25 = 25% of master) */
  duckRatio: number;
  rampInMs: number;
  rampOutMs: number;
};

export type TrackProviderEventHandlers = {
  onReady?: () => void;
  onStateChange?: (state: PlaybackState) => void;
  onPlaying?: () => void;
  onPaused?: () => void;
  onEnded?: () => void;
  /** Embed/SDK failure — engine applies throttled retry, not infinite skip */
  onError?: (code?: number | string) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
};

/**
 * Interchangeable music playback adapter.
 * YouTube iframe, Spotify Web Playback SDK, and future Apple Music Kit
 * implementations expose the same surface to the queue and mix engine.
 */
export interface TrackProvider {
  readonly id: TrackProviderId;
  readonly capabilities: readonly TrackProviderCapability[];

  setEventHandlers(handlers: TrackProviderEventHandlers): void;

  /** Optional DOM mount for embed/SDK players */
  mount?(container: HTMLElement): void;

  load(track: AudioTrack): Promise<void>;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setVolume(normalized: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;

  /** Music bus that VoiceNode ducks during DJ overlays */
  getVolumeController(): VolumeController;
}

/** TTS / voice synthesis backends */
export type VoiceProviderId = "openai" | "elevenlabs" | "cartesia";

/**
 * How audio reaches the browser.
 * - buffered: full clip (current REST/blob flow)
 * - stream: WebSocket chunk delivery (Cartesia / ElevenLabs streaming, Phase 3)
 */
export type VoiceDeliveryMode = "buffered" | "stream";

export type VoicePlaybackOptions = {
  /** Generated DJ script when synthesis is deferred to the node */
  script?: string;
  /** Pre-synthesized clip when script was generated upstream */
  audioUrl?: string;
  signal?: AbortSignal;
  /** Music bus to duck while this voice plays (dual-track pipeline) */
  duckingTarget?: VolumeController;
  ducking?: Partial<DuckingConfig>;
};

/**
 * DJ voice layer in the dual-track pipeline.
 * Decoupled from TrackProvider so intros, stingers, and call-in replies
 * can stream or buffer independently of the music source.
 */
export interface VoiceNode {
  readonly providerId: VoiceProviderId;
  readonly deliveryMode: VoiceDeliveryMode;

  /** Warm the next intro before the current track ends (Phase 2 prefetch) */
  prefetch?(options: { script: string; signal?: AbortSignal }): Promise<void>;

  play(options: VoicePlaybackOptions): Promise<void>;
  stop(): void;
  setVolume(normalized: number): void;
  getVolumeController(): VolumeController;
  destroy(): void;
}

/** Wire music + voice buses for the zero-gap broadcast engine (Phase 2+) */
export type DualTrackMix = {
  music: VolumeController;
  voice: VolumeController;
  ducking: DuckingConfig;
};
