/**
 * Zero-latency DJ break pre-fetch engine.
 *
 * Watches outgoing-track progress and, once fewer than
 * {@link PREFETCH_LOOKAHEAD_SECONDS} remain, warms `/api/generate-script` +
 * `/api/generate-voice` for the upcoming break. Finished clips land in
 * {@link prefetchedBreaksMap} so the transition can play without waiting on TTS.
 *
 * Transition policy (ducking vs pause) is resolved from `commentaryFormat` via
 * {@link resolveBreakTransitionPolicy} — standard short breaks duck over music;
 * extended formats pause (or hold a 5% ambient floor).
 */

import { DUCK_RATIO } from "@/lib/audio/mix-bus";
import { debugLog } from "@/lib/debug";
import { generateDjBreak } from "@/lib/dj-intro";
import type { PersonaId } from "@/data/personas";
import {
  DEFAULT_COMMENTARY_FORMAT,
  type CommentaryFormat,
  type DjSegmentPlan,
} from "@/types/dj";
import type { AlbumContext, EraLock, VoiceProfileOverride } from "@/types/station";
import type { TtsProvider } from "@/types/voice";

/**
 * Single shared lookahead window for DJ warmup (YouTube controller, companion
 * near-end, and the station-queue prefetch engine). Keep all consumers on this
 * constant so TTS has a consistent budget before the cut.
 *
 * Guaranteed floor: 25–30s before track completion so `/api/generate-script` +
 * `/api/generate-voice` finish and the clip is buffered in browser memory prior
 * to the transition (30s satisfies the upper bound of that window).
 */
export const PREFETCH_LOOKAHEAD_SECONDS = 30;

/**
 * Standard / short-break duck ratio while the host speaks over music.
 * Matches {@link DUCK_RATIO} (18% of pre-break volume) — companion ramps to
 * `preBreakVolume * STANDARD_BREAK_DUCK_RATIO`, never an absolute floor.
 */
export const STANDARD_BREAK_DUCK_RATIO = DUCK_RATIO;

/**
 * Extended-format ambient floor when pause is unavailable — music yields to
 * ~5% so long lore stays intelligible without a hard mute.
 */
export const EXTENDED_BREAK_AMBIENT_FLOOR = 0.05;

/** How music behaves while a DJ clip is on air. */
export type BreakTransitionMode = "duck_over_music" | "pause_or_ambient";

export type BreakTransitionPolicy = {
  mode: BreakTransitionMode;
  /** Fraction of pre-break volume while ducked (0.18 standard, 0.05 extended ambient). */
  duckRatio: number;
  /** Prefer pausing the transport for extended lore formats. */
  pauseMusic: boolean;
  commentaryFormat: CommentaryFormat;
};

/**
 * Standard short breaks duck; Roots & Branches / Time Capsule / Director's Cut
 * pause the bed (or hold the ambient floor).
 */
export function resolveBreakTransitionPolicy(
  format: CommentaryFormat | null | undefined,
): BreakTransitionPolicy {
  const commentaryFormat = format ?? DEFAULT_COMMENTARY_FORMAT;
  if (commentaryFormat === "standard") {
    return {
      mode: "duck_over_music",
      duckRatio: STANDARD_BREAK_DUCK_RATIO,
      pauseMusic: false,
      commentaryFormat,
    };
  }
  return {
    mode: "pause_or_ambient",
    duckRatio: EXTENDED_BREAK_AMBIENT_FLOOR,
    pauseMusic: true,
    commentaryFormat,
  };
}

/** Cached, pre-rendered break ready for zero-latency playback. */
export type PrefetchedDjBreak = {
  trackKey: string;
  title: string;
  artist: string;
  /** Raw TTS bytes held in memory until the break airs or is discarded. */
  audioBuffer: ArrayBuffer;
  audioBlob: Blob;
  script: string;
  commentaryFormat: CommentaryFormat;
  plan?: DjSegmentPlan | null;
  createdAt: number;
  /** Host stamped at warmup — required before playback against the live persona. */
  personaId?: string;
  /** Voice id stamped at warmup — required before playback against the live voice. */
  voiceId?: string;
};

/**
 * In-memory cache of warmed DJ breaks, keyed by upcoming-track identity.
 * Shared module map so queue + companion consumers see the same slot.
 */
export const prefetchedBreaksMap = new Map<string, PrefetchedDjBreak>();

/** Context stamped into generate-script / generate-voice during warmup. */
export type DjPrefetchContext = {
  personaId?: PersonaId;
  provider?: TtsProvider;
  voice?: string;
  tier?: "free" | "pro";
  stationId?: string;
  stationName?: string;
  stationFrequency?: number;
  eraLock?: EraLock;
  vibePrompt?: string;
  albumContext?: AlbumContext | null;
  voiceProfile?: VoiceProfileOverride | null;
  commentaryFormat?: CommentaryFormat;
  /** Broadcast City preference for VPN-safe weather colour. */
  homeCity?: string;
  maxDurationInSeconds?: number;
  segmentPlan?: DjSegmentPlan;
};

export type DjPrefetchPredecessor = {
  title: string;
  artist: string;
};

export type DjPrefetchTrack = {
  trackKey: string;
  title: string;
  artist: string;
};

export type DjPrefetchProgress = {
  positionSeconds: number;
  durationSeconds: number;
};

/**
 * Whether the outgoing track is inside the 30s warmup window.
 * Sub-30s tracks qualify from the first valid position report.
 */
export function shouldPrefetchUpcomingBreak({
  positionSeconds,
  durationSeconds,
}: DjPrefetchProgress): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return false;
  return durationSeconds - positionSeconds <= PREFETCH_LOOKAHEAD_SECONDS;
}

export function remainingPlaybackSeconds({
  positionSeconds,
  durationSeconds,
}: DjPrefetchProgress): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, durationSeconds - positionSeconds);
}

type InflightSlot = {
  trackKey: string;
  abort: AbortController;
  promise: Promise<PrefetchedDjBreak | null>;
};

/**
 * Background warmup controller. At most one break is in flight; retargeting
 * aborts the previous request. Completed clips live in {@link prefetchedBreaksMap}.
 */
export class DjBreakPrefetchEngine {
  private inflight: InflightSlot | null = null;
  private context: DjPrefetchContext = {};

  /** Latest persona / station knobs for generate-script + generate-voice. */
  setContext(context: DjPrefetchContext): void {
    this.context = { ...context };
  }

  getContext(): DjPrefetchContext {
    return this.context;
  }

  get targetKey(): string | null {
    return this.inflight?.trackKey ?? null;
  }

  has(trackKey: string): boolean {
    return prefetchedBreaksMap.has(trackKey) || this.inflight?.trackKey === trackKey;
  }

  /**
   * Progress clock entry — starts warmup when remaining time drops below 30s.
   * Idempotent per `upcoming.trackKey`.
   * `previousTrack` is the live on-air Track N so N+1 recaps name N, not N-1.
   */
  observeProgress(
    progress: DjPrefetchProgress,
    upcoming: DjPrefetchTrack | null | undefined,
    previousTrack?: DjPrefetchPredecessor | null,
  ): void {
    const remaining = remainingPlaybackSeconds(progress);
    const shouldTrigger = shouldPrefetchUpcomingBreak(progress);
    debugLog("[TELEMETRY: DJ Prefetch Check]", {
      trackId: upcoming?.trackKey,
      position: progress.positionSeconds,
      duration: progress.durationSeconds,
      remaining,
      shouldTrigger,
    });
    if (!upcoming?.trackKey) return;
    if (!shouldPrefetchUpcomingBreak(progress)) return;
    void this.ensurePrefetch(upcoming, previousTrack);
  }

  /**
   * Begin (or continue) warming the break for `upcoming`. Safe to call from a
   * 30s near-end handler as well as the progress clock.
   */
  ensurePrefetch(
    upcoming: DjPrefetchTrack,
    previousTrack?: DjPrefetchPredecessor | null,
  ): Promise<PrefetchedDjBreak | null> {
    const trackKey = upcoming.trackKey?.trim();
    if (!trackKey) return Promise.resolve(null);
    if (prefetchedBreaksMap.has(trackKey)) {
      return Promise.resolve(prefetchedBreaksMap.get(trackKey) ?? null);
    }
    if (this.inflight?.trackKey === trackKey) {
      return this.inflight.promise;
    }

    this.dropInflight();

    const abort = new AbortController();
    const slot: InflightSlot = {
      trackKey,
      abort,
      promise: Promise.resolve(null),
    };
    this.inflight = slot;

    slot.promise = this.warm(upcoming, abort.signal, previousTrack)
      .catch((error) => {
        if (!abort.signal.aborted) {
          console.warn(
            "[DjPrefetchEngine] Lookahead failed; break will be generated live:",
            error,
          );
        }
        return null;
      })
      .finally(() => {
        if (this.inflight === slot) this.inflight = null;
      });

    return slot.promise;
  }

  /** Claim a warmed break (removes it from the cache). */
  take(trackKey: string): PrefetchedDjBreak | null {
    const key = trackKey?.trim();
    if (!key) return null;
    const warmed = prefetchedBreaksMap.get(key) ?? null;
    if (warmed) prefetchedBreaksMap.delete(key);
    return warmed;
  }

  /**
   * Claim by exact key, then by title/artist so Spotify-id breaks can still
   * consume youtube-keyed warmups from the station queue.
   */
  takeForTrack(track: {
    trackKey?: string;
    title: string;
    artist: string;
  }): PrefetchedDjBreak | null {
    const byKey = track.trackKey ? this.take(track.trackKey) : null;
    if (byKey) return byKey;

    const title = track.title.trim().toLowerCase();
    const artist = track.artist.trim().toLowerCase();
    if (!title || !artist) return null;

    for (const [key, warmed] of prefetchedBreaksMap) {
      if (
        warmed.title.trim().toLowerCase() === title
        && warmed.artist.trim().toLowerCase() === artist
      ) {
        prefetchedBreaksMap.delete(key);
        return warmed;
      }
    }
    return null;
  }

  peek(trackKey: string): PrefetchedDjBreak | null {
    const key = trackKey?.trim();
    if (!key) return null;
    return prefetchedBreaksMap.get(key) ?? null;
  }

  /** Drop cached / in-flight breaks that are no longer on-air or up next. */
  retain(keys: ReadonlyArray<string | undefined>): void {
    const keep = new Set(keys.map((k) => k?.trim()).filter(Boolean) as string[]);
    for (const key of prefetchedBreaksMap.keys()) {
      if (!keep.has(key)) prefetchedBreaksMap.delete(key);
    }
    if (this.inflight && !keep.has(this.inflight.trackKey)) {
      this.dropInflight();
    }
  }

  /** Station switch / teardown — abort in-flight work and empty the cache. */
  clear(): void {
    this.dropInflight();
    prefetchedBreaksMap.clear();
  }

  private async warm(
    upcoming: DjPrefetchTrack,
    signal: AbortSignal,
    previousTrack?: DjPrefetchPredecessor | null,
  ): Promise<PrefetchedDjBreak | null> {
    const trackKey = upcoming.trackKey.trim();
    const ctx = this.context;
    const commentaryFormat = ctx.commentaryFormat ?? DEFAULT_COMMENTARY_FORMAT;

    const predecessor =
      previousTrack?.title?.trim() && previousTrack?.artist?.trim()
        ? {
            title: previousTrack.title.trim(),
            artist: previousTrack.artist.trim(),
          }
        : undefined;

    let script = "";
    const audioBlob = await generateDjBreak({
      songTitle: upcoming.title,
      artistName: upcoming.artist,
      maxDurationInSeconds: ctx.segmentPlan?.maxDurationSeconds ?? ctx.maxDurationInSeconds ?? 5,
      personaId: ctx.personaId,
      provider: ctx.provider,
      voice: ctx.voice,
      tier: ctx.tier,
      stationId: ctx.stationId,
      stationName: ctx.stationName,
      stationFrequency: ctx.stationFrequency,
      eraLock: ctx.eraLock,
      vibePrompt: ctx.vibePrompt,
      albumContext: ctx.albumContext,
      voiceProfile: ctx.voiceProfile,
      commentaryFormat,
      homeCity: ctx.homeCity,
      segmentPlan: ctx.segmentPlan,
      previousTrack: predecessor,
      signal,
      onScript: (text) => {
        script = text;
      },
    });

    if (!audioBlob || signal.aborted) return null;

    const audioBuffer = await audioBlob.arrayBuffer();
    if (signal.aborted) return null;

    const prepared: PrefetchedDjBreak = {
      trackKey,
      title: upcoming.title,
      artist: upcoming.artist,
      audioBuffer,
      audioBlob: new Blob([audioBuffer], { type: audioBlob.type || "audio/mpeg" }),
      script,
      commentaryFormat,
      plan: ctx.segmentPlan ?? null,
      createdAt: Date.now(),
      personaId: ctx.personaId,
      voiceId: ctx.voice,
    };

    prefetchedBreaksMap.set(trackKey, prepared);
    return prepared;
  }

  private dropInflight(): void {
    const slot = this.inflight;
    if (!slot) return;
    this.inflight = null;
    slot.abort.abort();
  }
}

/** Process-wide engine used by the station queue progress clock. */
let sharedPrefetchEngine: DjBreakPrefetchEngine | null = null;

export function getSharedDjBreakPrefetchEngine(): DjBreakPrefetchEngine {
  if (!sharedPrefetchEngine) {
    sharedPrefetchEngine = new DjBreakPrefetchEngine();
  }
  return sharedPrefetchEngine;
}
