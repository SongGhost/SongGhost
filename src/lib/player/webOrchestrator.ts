/**
 * Pause–Talk–Play web orchestrator.
 *
 * Coordinates DJ breaks over third-party streams (Spotify / Apple Music):
 * fetch cached or freshly rendered lore audio → pause the active player →
 * play the DJ clip in an HTML5 Audio element → resume music on `ended`.
 */

import {
  getCurrentlyPlayingAppleMusic,
  pauseAppleMusic,
  resumeAppleMusic,
  type AppleTrack,
} from "@/lib/player/appleMusicRemote";
import {
  getCurrentlyPlaying,
  isNoActiveDeviceResult,
  pauseSpotifyPlayback,
  resumeSpotifyPlayback,
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
  mode?: string;
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
  /** Fired when Spotify has no active device to pause/resume. */
  onNoActiveDevice?: (status: SpotifyNoActiveDevice) => void;
  /** Fired with the DJ script text when the generate-script response includes it. */
  onScript?: (script: string) => void;
  /** Fired when the DJ clip begins playing. */
  onDjStart?: () => void;
  /** Fired when the DJ clip finishes and music has been asked to resume. */
  onDjEnd?: () => void;
  /** Fired on unrecoverable orchestration errors. */
  onError?: (error: Error) => void;
};

export type RunDjBreakResult =
  | { ok: true; audioUrl: string; script?: string; cached?: boolean }
  | { ok: false; reason: "NO_ACTIVE_DEVICE" }
  | { ok: false; reason: "SCRIPT_FAILED" | "PAUSE_FAILED" | "PLAYBACK_FAILED" | "RESUME_FAILED"; error: Error };

/**
 * Coordinates a single Pause–Talk–Play cycle against Spotify or Apple Music.
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
  private running = false;

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

  /** Abort an in-flight DJ clip without resuming music. */
  stopDjAudio(): void {
    if (this.activeDjAudio) {
      this.activeDjAudio.pause();
      this.activeDjAudio.src = "";
      this.activeDjAudio = null;
    }
    this.running = false;
  }

  async getCurrentlyPlayingTrack(): Promise<SpotifyTrack | AppleTrack | null> {
    if (this.provider === "spotify") {
      const token = this.requireSpotifyToken();
      return getCurrentlyPlaying(token);
    }
    return getCurrentlyPlayingAppleMusic();
  }

  /**
   * Full Pause–Talk–Play cycle for the given track + voice.
   */
  async runDjBreak(track: OrchestratorTrackInput): Promise<RunDjBreakResult> {
    if (this.running) {
      const error = new Error("A DJ break is already in progress");
      this.onError?.(error);
      return { ok: false, reason: "PLAYBACK_FAILED", error };
    }

    this.running = true;

    try {
      const scriptPayload = await this.fetchDjAudio(track);
      if (!scriptPayload.audioUrl) {
        const error = new Error("generate-script response missing audioUrl");
        this.onError?.(error);
        return { ok: false, reason: "SCRIPT_FAILED", error };
      }

      if (scriptPayload.script) {
        this.onScript?.(scriptPayload.script);
      }

      const paused = await this.pauseActivePlayer();
      if (paused === "NO_ACTIVE_DEVICE") {
        const status: SpotifyNoActiveDevice = {
          success: false,
          reason: "NO_ACTIVE_DEVICE",
        };
        this.onNoActiveDevice?.(status);
        return { ok: false, reason: "NO_ACTIVE_DEVICE" };
      }
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
        this.onError?.(error);
        // Best-effort resume so the listener is not left paused.
        await this.resumeActivePlayer().catch(() => false);
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
    } catch (caught) {
      const error =
        caught instanceof Error ? caught : new Error("DJ break orchestration failed");
      this.onError?.(error);
      return { ok: false, reason: "SCRIPT_FAILED", error };
    } finally {
      this.running = false;
      this.activeDjAudio = null;
    }
  }

  private async fetchDjAudio(
    track: OrchestratorTrackInput,
  ): Promise<DjBreakScriptResponse> {
    const response = await fetch(this.scriptEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackId: track.trackId,
        voiceId: track.voiceId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        mode: track.mode,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `generate-script failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    return (await response.json()) as DjBreakScriptResponse;
  }

  private async pauseActivePlayer(): Promise<true | false | "NO_ACTIVE_DEVICE"> {
    if (this.provider === "spotify") {
      const result = await pauseSpotifyPlayback(this.requireSpotifyToken());
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
      const result = await resumeSpotifyPlayback(this.requireSpotifyToken());
      if (isNoActiveDeviceResult(result)) {
        this.onNoActiveDevice?.(result);
        return false;
      }
      return result === true;
    }

    await resumeAppleMusic();
    return true;
  }

  private playDjClip(audioUrl: string): Promise<void> {
    if (typeof Audio === "undefined") {
      return Promise.reject(new Error("HTML5 Audio is not available"));
    }

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      this.activeDjAudio = audio;

      const cleanup = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };

      const onEnded = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error("DJ audio element failed to play"));
      };

      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      this.onDjStart?.();

      void audio.play().catch((error: unknown) => {
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error("Browser blocked DJ audio playback"),
        );
      });
    });
  }

  private requireSpotifyToken(): string {
    if (!this.spotifyAccessToken) {
      throw new Error("spotifyAccessToken is required for the Spotify provider");
    }
    return this.spotifyAccessToken;
  }
}

/** Convenience factory matching the class constructor. */
export function createWebOrchestrator(
  options: WebOrchestratorOptions,
): WebOrchestrator {
  return new WebOrchestrator(options);
}
