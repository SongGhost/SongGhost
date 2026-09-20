/**
 * Lookahead warming for the DJ voice channel.
 *
 * A break is decided and synthesized while the outgoing track still has audio
 * left to play, so the clip is written, spoken, and decoded before the
 * transition it belongs to arrives.
 *
 * The scheduler decision travels with the clip rather than being re-taken at
 * the transition. `planDjSegment` both advances scheduler state and rolls
 * randomness, so asking it twice for one transition would pick a different
 * break than the one that was synthesized and would count the transition
 * twice against the pacing budget. The warmed slot therefore carries the
 * `nextState` it produced, and the consumer commits that state at the moment
 * it takes the break.
 *
 * Pass 3 keeps two upcoming slots. A second target is the N+2 package, not a
 * stale replacement. Skip / station / settings drop via {@link retain} /
 * {@link clear} (Pass 1 abort). Local GPU: `skipIfBusy` queues the second job
 * instead of aborting the first. OpenAI may run both in parallel.
 */

import { debugLog } from "@/lib/debug";
import { TWO_AHEAD_DEPTH } from "@/lib/dj/breakPackageCache";
import { PREFETCH_LOOKAHEAD_SECONDS } from "@/lib/dj/prefetchEngine";
import type { SchedulerState } from "@/lib/dj/scheduler";
import type { DjSegmentPlan, DjTransitionType } from "@/types/dj";

/**
 * How much of the outgoing track is reserved for warming the next break.
 * Mirrors {@link PREFETCH_LOOKAHEAD_SECONDS} so YouTube + companion share one window.
 */
export const LOOKAHEAD_SECONDS = PREFETCH_LOOKAHEAD_SECONDS;

/**
 * A scheduler decision for an upcoming transition, plus the clip that voices
 * it. `audioBlob` is absent for a silent slot, which reserves the decision
 * alone so the pacing count still advances exactly once.
 */
export type PreparedDjBreak = {
  transition: DjTransitionType;
  plan: DjSegmentPlan | null;
  nextState: SchedulerState;
  audioBlob?: Blob;
  loreBlob?: Blob;
  loreScript?: string;
  announcementBlob?: Blob;
  announcementScript?: string;
  /**
   * Script the clip was synthesized from. Travels with the break because it is
   * written a full track before it airs, and the teleprompter needs it at the
   * transition rather than at the moment it was written.
   */
  script?: string;
};

/**
 * Plans and synthesizes the upcoming break. Returning null abandons the
 * lookahead, leaving the transition to be planned live.
 */
export type DjPrefetchTask = (signal: AbortSignal) => Promise<PreparedDjBreak | null>;

export type DjPrefetchOptions = {
  /** Decodes the clip so the break opens without a buffering gap. */
  preload?: (blob: Blob) => Promise<void>;
  /** Releases a warmed clip that will never be played. */
  discardPreload?: () => void;
};

/**
 * Whether there is little enough of the current track left to start warming
 * the next break.
 *
 * A track shorter than the lookahead window satisfies this from its first
 * position report, which is what makes a sub-20s track warm immediately on
 * reaching `PLAYING` rather than never warming at all.
 */
export function shouldStartLookahead({
  position,
  duration,
  trackId,
  leadSeconds = LOOKAHEAD_SECONDS,
}: {
  position: number;
  duration: number;
  /** Active playback id (YouTube video id or `spotify:track:…`). */
  trackId?: string;
  /** Override the default 30s window (local Director's Cut uses 120s). */
  leadSeconds?: number;
}): boolean {
  if (!Number.isFinite(duration) || duration <= 0) {
    debugLog("[TELEMETRY: DJ Timing Check]", {
      trackId,
      position,
      duration,
      remaining: Number.NaN,
      shouldTrigger: false,
    });
    return false;
  }
  if (!Number.isFinite(position) || position < 0) {
    debugLog("[TELEMETRY: DJ Timing Check]", {
      trackId,
      position,
      duration,
      remaining: Number.NaN,
      shouldTrigger: false,
    });
    return false;
  }
  const remaining = duration - position;
  const window = Number.isFinite(leadSeconds) && leadSeconds > 0
    ? leadSeconds
    : LOOKAHEAD_SECONDS;
  const shouldTrigger = remaining <= window;
  debugLog("[TELEMETRY: DJ Timing Check]", {
    trackId,
    position,
    duration,
    remaining,
    leadSeconds: window,
    shouldTrigger,
  });
  return shouldTrigger;
}

type PrefetchSlot = {
  trackKey: string;
  abort: AbortController;
  result: Promise<PreparedDjBreak | null>;
  /** Whether a clip is currently held warm in the voice node for this slot. */
  warmed: boolean;
};

type QueuedPrefetch = {
  trackKey: string;
  task: DjPrefetchTask;
};

export class DjPrefetchController {
  private slots = new Map<string, PrefetchSlot>();
  private localQueue: QueuedPrefetch[] = [];
  private localInflightKey: string | null = null;
  /**
   * Abort handle for a break that `take()` claimed but the player is still
   * awaiting. Without this, skip/timeout cannot cancel the orphaned fetch.
   */
  private claimedAbort: AbortController | null = null;

  private readonly preload?: (blob: Blob) => Promise<void>;
  private readonly discardPreload?: () => void;

  constructor(options: DjPrefetchOptions = {}) {
    this.preload = options.preload;
    this.discardPreload = options.discardPreload;
  }

  /** First in-flight / ready lookahead key (one-ahead compat). */
  get targetKey(): string | null {
    return this.slots.keys().next().value ?? this.localQueue[0]?.trackKey ?? null;
  }

  /** All warmed or in-flight upcoming keys (up to two-ahead). */
  get targetKeys(): string[] {
    return [...this.slots.keys()];
  }

  hasSlot(trackKey: string): boolean {
    return Boolean(trackKey) && this.slots.has(trackKey);
  }

  /**
   * Peek the prepared break without claiming it. Used so N+2 can plan from
   * N+1's `nextState` without consuming the N+1 package.
   */
  peek(trackKey: string): Promise<PreparedDjBreak | null> | null {
    const slot = this.slots.get(trackKey);
    return slot ? slot.result : null;
  }

  /**
   * Begins warming the break for `trackKey`. Idempotent per key.
   * A second key is the N+2 package — it does not abort N+1.
   * `skipIfBusy` (local GPU): queue the second job; do not abort the first.
   */
  start(
    trackKey: string,
    task: DjPrefetchTask,
    options?: { skipIfBusy?: boolean },
  ): void {
    if (!trackKey) return;
    if (this.slots.has(trackKey)) return;
    if (this.localQueue.some((job) => job.trackKey === trackKey)) return;

    if (options?.skipIfBusy && this.localInflightKey) {
      if (this.localQueue.length >= TWO_AHEAD_DEPTH) return;
      console.info("[SongHost] Two-ahead queue local", { trackKey });
      this.localQueue.push({ trackKey, task });
      return;
    }

    this.launch(trackKey, task, Boolean(options?.skipIfBusy));
  }

  /**
   * Claims the warmed break for `trackKey`, or null if nothing was warmed for
   * it. The claim is synchronous so the caller knows immediately whether to
   * plan live; the returned promise settles once synthesis finishes, which it
   * normally already has.
   */
  take(trackKey: string): Promise<PreparedDjBreak | null> | null {
    const slot = this.slots.get(trackKey);
    if (!slot) return null;

    this.slots.delete(trackKey);
    this.claimedAbort = slot.abort;
    console.info("[SongHost] Two-ahead consume", { trackKey, hit: true });
    return slot.result;
  }

  /**
   * Abort a `take()` that is still awaiting synthesis. Skip, timeout, and
   * station change must not let that job finish into a late play.
   */
  abortClaimed(): void {
    const abort = this.claimedAbort;
    if (!abort) return;
    this.claimedAbort = null;
    if (!abort.signal.aborted) abort.abort();
  }

  /**
   * Drops the warmed break unless it belongs to one of `keys`. Queue edits,
   * skips, and track advances all funnel through here: whatever is warm has to
   * still be either on air or up next, or it can never be played.
   */
  retain(keys: ReadonlyArray<string | undefined>): void {
    const keep = new Set(keys.filter((key): key is string => Boolean(key)));
    this.localQueue = this.localQueue.filter((job) => keep.has(job.trackKey));
    for (const key of [...this.slots.keys()]) {
      if (!keep.has(key)) this.dropSlot(key);
    }
    if (!this.localInflightKey) this.dequeueLocal();
  }

  /** Abandons the lookahead entirely — station switch, new session, teardown. */
  clear(): void {
    console.info("[SongHost] Two-ahead invalidate", { reason: "clear" });
    this.localQueue = [];
    for (const key of [...this.slots.keys()]) this.dropSlot(key);
    this.abortClaimed();
  }

  private launch(
    trackKey: string,
    task: DjPrefetchTask,
    local: boolean,
  ): void {
    const abort = new AbortController();
    const slot: PrefetchSlot = {
      trackKey,
      abort,
      result: Promise.resolve(null),
      warmed: false,
    };
    this.slots.set(trackKey, slot);
    if (local) this.localInflightKey = trackKey;

    // Failures degrade to a live break rather than propagating: the transition
    // is still playable, it just pays the synthesis cost it would have anyway.
    slot.result = this.warm(slot, task)
      .catch((error) => {
        if (!abort.signal.aborted) {
          console.warn("[DjPrefetch] Lookahead failed; break will be generated live:", error);
        }
        return null;
      })
      .finally(() => {
        if (this.localInflightKey === trackKey) {
          this.localInflightKey = null;
          this.dequeueLocal();
        }
      });
  }

  private dequeueLocal(): void {
    const next = this.localQueue.shift();
    if (!next || this.slots.has(next.trackKey)) return;
    this.launch(next.trackKey, next.task, true);
  }

  private async warm(slot: PrefetchSlot, task: DjPrefetchTask): Promise<PreparedDjBreak | null> {
    const { signal } = slot.abort;

    const prepared = await task(signal);
    if (!prepared || signal.aborted) return null;
    if (!prepared.audioBlob || !this.preload) return prepared;

    try {
      await this.preload(prepared.audioBlob);
    } catch {
      // Decoding early is an optimization; the blob still plays without it.
      return signal.aborted ? null : prepared;
    }

    // Dropped while the clip was decoding: the node is holding a break for a
    // transition that will never come.
    if (signal.aborted) {
      this.discardPreload?.();
      return null;
    }

    slot.warmed = true;
    console.info("[SongHost] Two-ahead ready", { trackKey: slot.trackKey });
    return prepared;
  }

  private dropSlot(trackKey: string): void {
    const slot = this.slots.get(trackKey);
    if (!slot) return;

    this.slots.delete(trackKey);
    slot.abort.abort();
    if (slot.warmed) this.discardPreload?.();
    if (this.localInflightKey === trackKey) {
      this.localInflightKey = null;
    }
  }
}
