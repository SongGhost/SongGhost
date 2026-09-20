/**
 * Zero-latency DJ break pre-fetch engine.
 *
 * Pass 3: when a song starts (or the queue is known), warm the next
 * {@link TWO_AHEAD_DEPTH} transitions into {@link prefetchedBreaksMap}.
 * Keys are track id + settings fingerprint — a Host Studio voice/lore/persona/vibe
 * change is a miss. Local GPU runs **one** synth at a time (FIFO queue);
 * OpenAI may run up to two prefetch jobs in parallel and does not occupy the
 * local slot. Near-end {@link getPrefetchLeadSeconds} remains a late fallback.
 *
 * Transition policy (ducking vs pause) is resolved from `commentaryFormat` via
 * {@link resolveBreakTransitionPolicy} — standard short breaks duck over music;
 * extended formats pause (or hold a 5% ambient floor).
 */

import { resolveDirectStreamUrl } from "@/lib/audio/DirectStreamProvider";
import { DUCK_RATIO } from "@/lib/audio/mix-bus";
import { debugLog } from "@/lib/debug";
import {
  breakPackageCacheKey,
  buildBreakSettingsFingerprint,
  TWO_AHEAD_DEPTH,
  type TwoAheadTarget,
} from "@/lib/dj/breakPackageCache";
import { generateDjBreak, generatePavlovianDjBreak } from "@/lib/dj-intro";
import type { PersonaId } from "@/data/personas";
import {
  DEFAULT_COMMENTARY_FORMAT,
  isLoreSegmentKind,
  type CommentaryFormat,
  type DjSegmentPlan,
} from "@/types/dj";
import type {
  AlbumContext,
  ChatterPacing,
  EraLock,
  VoiceProfileOverride,
} from "@/types/station";
import type { LocalVoiceSlot, TtsProvider } from "@/types/voice";
import {
  isLocalTtsProvider,
  PREFETCH_LEAD_SECONDS_LOCAL_DEFAULT,
  PREFETCH_LEAD_SECONDS_LOCAL_DIRECTORS_CUT,
  PREFETCH_LEAD_SECONDS_LOCAL_TIME_CAPSULE,
} from "@/lib/dj/loreBudget";

/**
 * Default lookahead window for DJ warmup (standard / Roots & Branches).
 * Extended formats use a longer budget via {@link getPrefetchLeadSeconds}:
 * Time Capsule 45s, Director's Cut 60s. Local Chatterbox uses a longer
 * window (75s / 100s / 120s) so the GPU can finish before the cut.
 *
 * Guaranteed floor: 25–30s before track completion so `/api/generate-script` +
 * `/api/generate-voice` finish and the clip is buffered in browser memory prior
 * to the transition (30s satisfies the upper bound of the default window).
 */
export const PREFETCH_LOOKAHEAD_SECONDS = 30;

/** Director's Cut long-form TTS warmup — 60s before the cut (OpenAI). */
export const PREFETCH_LEAD_SECONDS_DIRECTORS_CUT = 60;

/** Sonic Time Capsule warmup — 45s before the cut (OpenAI). */
export const PREFETCH_LEAD_SECONDS_TIME_CAPSULE = 45;

/**
 * Format-aware prefetch lead time in seconds.
 * OpenAI: `directors_cut` → 60, `time_capsule` → 45, else 30.
 * Local: `directors_cut` → 120, `time_capsule` → 100, else 75.
 */
export function getPrefetchLeadSeconds(
  commentaryFormat?: string,
  provider?: string,
): number {
  if (isLocalTtsProvider(provider)) {
    if (commentaryFormat === "directors_cut") {
      return PREFETCH_LEAD_SECONDS_LOCAL_DIRECTORS_CUT;
    }
    if (commentaryFormat === "time_capsule") {
      return PREFETCH_LEAD_SECONDS_LOCAL_TIME_CAPSULE;
    }
    return PREFETCH_LEAD_SECONDS_LOCAL_DEFAULT;
  }
  if (commentaryFormat === "directors_cut") {
    return PREFETCH_LEAD_SECONDS_DIRECTORS_CUT;
  }
  if (commentaryFormat === "time_capsule") {
    return PREFETCH_LEAD_SECONDS_TIME_CAPSULE;
  }
  return PREFETCH_LOOKAHEAD_SECONDS;
}

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

/**
 * Shared identity for AudioPlayer lookahead and station-queue Engine A.
 * Matches the on-air transport: DirectStream `direct:{itunesId|url}`, else
 * YouTube video id, else companion Spotify URI. Must not stamp a `direct:`
 * key from a leftover preview URL while YouTube is actually on air.
 */
export function djPrefetchTrackKey(track: {
  spotifyId?: string;
  itunesTrackId?: number;
  streamUrl?: string;
  previewUrl?: string;
  youtubeId?: string;
  providerTrackId?: string;
  extras?: Record<string, string | number | boolean>;
  title?: string;
  artist?: string;
}): string {
  const streamUrl = resolveDirectStreamUrl(track);
  if (streamUrl) return `direct:${track.itunesTrackId ?? streamUrl}`;
  const youtubeId = track.youtubeId?.trim();
  if (youtubeId) return youtubeId;
  const spotifyId = track.spotifyId?.trim();
  if (spotifyId) {
    return spotifyId.startsWith("spotify:track:")
      ? spotifyId
      : `spotify:track:${spotifyId}`;
  }
  return `${track.artist ?? ""}:${track.title ?? ""}`;
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
  /** Pavlovian lore clip when the warmed break is two-phase. */
  loreBlob?: Blob;
  loreScript?: string;
  announcementBlob?: Blob;
  announcementScript?: string;
  commentaryFormat: CommentaryFormat;
  plan?: DjSegmentPlan | null;
  createdAt: number;
  /** Host stamped at warmup — required before playback against the live persona. */
  personaId?: string;
  /** Voice id stamped at warmup — required before playback against the live voice. */
  voiceId?: string;
  /** Settings fingerprint stamped at warmup — consume must match live knobs. */
  settingsFingerprint?: string;
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
  /** Sidecar slot 1–4 when `provider` is `"local"`. */
  voiceSlot?: LocalVoiceSlot;
  tier?: "free" | "pro";
  stationId?: string;
  stationName?: string;
  stationFrequency?: number;
  eraLock?: EraLock;
  vibePrompt?: string;
  albumContext?: AlbumContext | null;
  voiceProfile?: VoiceProfileOverride | null;
  commentaryFormat?: CommentaryFormat;
  chatterPacing?: ChatterPacing;
  allowExplicit?: boolean;
  alwaysAnnounceSongs?: boolean;
  /** Broadcast City preference for VPN-safe weather colour. */
  homeCity?: string;
  /** Blueprint seed genres when the station is not in the house catalog. */
  seedGenres?: string[];
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
 * Whether the outgoing track is inside the format-aware warmup window
 * ({@link getPrefetchLeadSeconds}). Sub-lead-time tracks qualify from the
 * first valid position report.
 */
export function shouldPrefetchUpcomingBreak(
  { positionSeconds, durationSeconds }: DjPrefetchProgress,
  commentaryFormat?: string,
  provider?: string,
): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return false;
  const leadSeconds = getPrefetchLeadSeconds(commentaryFormat, provider);
  return durationSeconds - positionSeconds <= leadSeconds;
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

type QueuedLocalJob = {
  upcoming: DjPrefetchTrack;
  previousTrack?: DjPrefetchPredecessor | null;
  resolve: (value: PrefetchedDjBreak | null) => void;
};

/** True only when the ArrayBuffer is fully written into the warmed map. */
function isReadyPrefetchedBreak(
  warmed: PrefetchedDjBreak | null | undefined,
): warmed is PrefetchedDjBreak {
  return Boolean(warmed && warmed.audioBuffer.byteLength > 0);
}

/**
 * Background warmup controller. Keeps up to {@link TWO_AHEAD_DEPTH} finished
 * packages. Local GPU: one synth at a time, remainder queued. OpenAI: up to
 * two jobs in parallel — they do not block or occupy the local slot.
 */
export class DjBreakPrefetchEngine {
  private inflight: InflightSlot | null = null;
  private openaiInflight = new Map<string, InflightSlot>();
  private localQueue: QueuedLocalJob[] = [];
  private context: DjPrefetchContext = {};
  private fingerprint = buildBreakSettingsFingerprint({});

  /** Latest persona / station knobs for generate-script + generate-voice. */
  setContext(context: DjPrefetchContext): void {
    const nextFingerprint = buildBreakSettingsFingerprint(context);
    const fingerprintChanged = nextFingerprint !== this.fingerprint;
    this.context = { ...context };
    this.fingerprint = nextFingerprint;
    if (!fingerprintChanged) return;
    console.info("[SongHost] Two-ahead invalidate", {
      reason: "settings_fingerprint",
    });
    this.dropAllInflight();
    this.rejectLocalQueue();
    prefetchedBreaksMap.clear();
  }

  getContext(): DjPrefetchContext {
    return this.context;
  }

  get targetKey(): string | null {
    return this.inflight?.trackKey
      ?? this.openaiInflight.keys().next().value
      ?? null;
  }

  get targetKeys(): string[] {
    const keys = new Set<string>();
    if (this.inflight) keys.add(this.inflight.trackKey);
    for (const key of this.openaiInflight.keys()) keys.add(key);
    return [...keys];
  }

  private cacheKey(trackKey: string): string {
    return breakPackageCacheKey(trackKey, this.fingerprint);
  }

  /**
   * Whether a completed warmed buffer is in the map. In-flight TTS is **not**
   * a hit — reporting it as ready would skip AudioPlayer synthesis and then
   * `take()` an empty slot, forcing a live fallback after music is already ducked.
   */
  has(trackKey: string): boolean {
    return isReadyPrefetchedBreak(prefetchedBreaksMap.get(this.cacheKey(trackKey)));
  }

  /**
   * Progress clock entry — starts warmup when remaining time drops inside the
   * format-aware lead window. Idempotent per `upcoming.trackKey`.
   * `previousTrack` is the live on-air Track N so N+1 recaps name N, not N-1.
   */
  observeProgress(
    progress: DjPrefetchProgress,
    upcoming: DjPrefetchTrack | null | undefined,
    previousTrack?: DjPrefetchPredecessor | null,
  ): void {
    const remaining = remainingPlaybackSeconds(progress);
    const commentaryFormat = this.context.commentaryFormat;
    const provider = this.context.provider;
    const shouldTrigger = shouldPrefetchUpcomingBreak(
      progress,
      commentaryFormat,
      provider,
    );
    debugLog("[TELEMETRY: DJ Prefetch Check]", {
      trackId: upcoming?.trackKey,
      position: progress.positionSeconds,
      duration: progress.durationSeconds,
      remaining,
      leadSeconds: getPrefetchLeadSeconds(commentaryFormat, provider),
      shouldTrigger,
    });
    if (!upcoming?.trackKey) return;
    if (!shouldPrefetchUpcomingBreak(progress, commentaryFormat, provider)) return;
    void this.ensurePrefetch(upcoming, previousTrack);
  }

  /**
   * Song-start path: enqueue the next two transitions now. Local jobs run one
   * at a time; finished packages stay in the map as the queue drains.
   */
  ensureTwoAhead(targets: readonly TwoAheadTarget[]): void {
    const next = targets.slice(0, TWO_AHEAD_DEPTH);
    console.info("[SongHost] Two-ahead arm", {
      keys: next.map((target) => target.trackKey),
      provider: this.context.provider ?? "openai",
      fingerprint: this.fingerprint,
    });
    for (const target of next) {
      void this.ensurePrefetch(
        {
          trackKey: target.trackKey,
          title: target.title,
          artist: target.artist,
        },
        target.previousTrack,
      );
    }
  }

  /**
   * Begin (or continue) warming the break for `upcoming`. Safe to call from a
   * format-aware near-end handler as well as song-start {@link ensureTwoAhead}.
   *
   * Local GPU: one job at a time — a second target is queued, not skipped and
   * not aborted onto a dead sidecar socket. OpenAI: a second target may run in
   * parallel and does not occupy the local slot.
   */
  ensurePrefetch(
    upcoming: DjPrefetchTrack,
    previousTrack?: DjPrefetchPredecessor | null,
  ): Promise<PrefetchedDjBreak | null> {
    const trackKey = upcoming.trackKey?.trim();
    if (!trackKey) return Promise.resolve(null);
    const cached = prefetchedBreaksMap.get(this.cacheKey(trackKey));
    if (isReadyPrefetchedBreak(cached)) {
      return Promise.resolve(cached);
    }
    if (this.inflight?.trackKey === trackKey) {
      return this.inflight.promise;
    }
    const openaiSlot = this.openaiInflight.get(trackKey);
    if (openaiSlot) return openaiSlot.promise;

    const local = isLocalTtsProvider(this.context.provider);
    if (local && this.inflight) {
      const queued = this.localQueue.find((job) => job.upcoming.trackKey === trackKey);
      if (queued) {
        return new Promise((resolve) => {
          const prior = queued.resolve;
          queued.resolve = (value) => {
            prior(value);
            resolve(value);
          };
        });
      }
      console.info("[SongHost] Two-ahead queue local", { trackKey });
      return new Promise((resolve) => {
        this.localQueue.push({ upcoming, previousTrack, resolve });
      });
    }

    const abort = new AbortController();
    const slot: InflightSlot = {
      trackKey,
      abort,
      promise: Promise.resolve(null),
    };
    if (local) {
      this.inflight = slot;
    } else {
      this.openaiInflight.set(trackKey, slot);
    }

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
        if (this.openaiInflight.get(trackKey) === slot) {
          this.openaiInflight.delete(trackKey);
        }
        this.pumpLocalQueue();
      });

    return slot.promise;
  }

  /** Claim a warmed break (removes it from the cache). In-flight slots return null. */
  take(trackKey: string): PrefetchedDjBreak | null {
    const key = trackKey?.trim();
    if (!key) return null;
    const cacheKey = this.cacheKey(key);
    const warmed = prefetchedBreaksMap.get(cacheKey) ?? null;
    if (!isReadyPrefetchedBreak(warmed)) return null;
    if (warmed.settingsFingerprint && warmed.settingsFingerprint !== this.fingerprint) {
      prefetchedBreaksMap.delete(cacheKey);
      return null;
    }
    prefetchedBreaksMap.delete(cacheKey);
    console.info("[SongHost] Two-ahead consume", { trackKey: key, hit: true });
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
        isReadyPrefetchedBreak(warmed)
        && warmed.title.trim().toLowerCase() === title
        && warmed.artist.trim().toLowerCase() === artist
        && (!warmed.settingsFingerprint || warmed.settingsFingerprint === this.fingerprint)
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
    const warmed = prefetchedBreaksMap.get(this.cacheKey(key)) ?? null;
    if (!isReadyPrefetchedBreak(warmed)) return null;
    if (warmed.settingsFingerprint && warmed.settingsFingerprint !== this.fingerprint) {
      return null;
    }
    return warmed;
  }

  /** Drop cached / in-flight breaks that are no longer on-air or two-ahead. */
  retain(keys: ReadonlyArray<string | undefined>): void {
    const keep = new Set(keys.map((k) => k?.trim()).filter(Boolean) as string[]);
    for (const [cacheKey, warmed] of prefetchedBreaksMap) {
      const trackKey = warmed.trackKey?.trim();
      if (
        !trackKey
        || !keep.has(trackKey)
        || (warmed.settingsFingerprint && warmed.settingsFingerprint !== this.fingerprint)
      ) {
        prefetchedBreaksMap.delete(cacheKey);
      }
    }
    this.localQueue = this.localQueue.filter((job) => {
      const keepJob = keep.has(job.upcoming.trackKey);
      if (!keepJob) job.resolve(null);
      return keepJob;
    });
    if (this.inflight && !keep.has(this.inflight.trackKey)) {
      this.dropInflight();
    }
    for (const [key, slot] of this.openaiInflight) {
      if (!keep.has(key)) {
        this.openaiInflight.delete(key);
        slot.abort.abort();
      }
    }
  }

  /** Station switch / teardown — abort in-flight work and empty the cache. */
  clear(): void {
    console.info("[SongHost] Two-ahead invalidate", { reason: "clear" });
    this.dropAllInflight();
    this.rejectLocalQueue();
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
    const request = {
      songTitle: upcoming.title,
      artistName: upcoming.artist,
      maxDurationInSeconds: ctx.segmentPlan?.maxDurationSeconds ?? ctx.maxDurationInSeconds ?? 5,
      personaId: ctx.personaId,
      provider: ctx.provider,
      voice: ctx.voice,
      voiceSlot: ctx.voiceSlot,
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
      seedGenres: ctx.seedGenres,
      segmentPlan: ctx.segmentPlan,
      previousTrack: predecessor,
      signal,
      onScript: (text: string) => {
        script = text;
      },
    };

    const pavlovianPlan = ctx.segmentPlan;
    const pavlovian = Boolean(
      pavlovianPlan && isLoreSegmentKind(pavlovianPlan.kind),
    );

    let audioBlob: Blob | null = null;
    let loreBlob: Blob | undefined;
    let loreScript: string | undefined;
    let announcementBlob: Blob | undefined;
    let announcementScript: string | undefined;

    if (pavlovian) {
      const pair = await generatePavlovianDjBreak(request);
      if (!pair?.loreBlob || signal.aborted) return null;
      loreBlob = pair.loreBlob;
      loreScript = pair.loreScript;
      announcementBlob = pair.announcementBlob ?? undefined;
      announcementScript = pair.announcementScript || undefined;
      audioBlob = pair.announcementBlob ?? pair.loreBlob;
      script = [pair.loreScript, pair.announcementScript].filter(Boolean).join(" ");
    } else {
      audioBlob = await generateDjBreak(request);
    }

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
      loreBlob,
      loreScript,
      announcementBlob,
      announcementScript,
      commentaryFormat,
      plan: ctx.segmentPlan ?? null,
      createdAt: Date.now(),
      personaId: ctx.personaId,
      voiceId: ctx.voice,
      settingsFingerprint: this.fingerprint,
    };

    if (signal.aborted || prepared.settingsFingerprint !== this.fingerprint) {
      return null;
    }

    prefetchedBreaksMap.set(this.cacheKey(trackKey), prepared);
    console.info("[SongHost] Two-ahead ready", {
      trackKey,
      provider: ctx.provider ?? "openai",
    });
    return prepared;
  }

  private pumpLocalQueue(): void {
    if (this.inflight || !isLocalTtsProvider(this.context.provider)) return;
    const next = this.localQueue.shift();
    if (!next) return;
    void this.ensurePrefetch(next.upcoming, next.previousTrack).then(next.resolve);
  }

  private rejectLocalQueue(): void {
    const queued = this.localQueue;
    this.localQueue = [];
    for (const job of queued) job.resolve(null);
  }

  private dropInflight(): void {
    const slot = this.inflight;
    if (!slot) return;
    this.inflight = null;
    slot.abort.abort();
  }

  private dropAllInflight(): void {
    this.dropInflight();
    for (const slot of this.openaiInflight.values()) {
      slot.abort.abort();
    }
    this.openaiInflight.clear();
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
