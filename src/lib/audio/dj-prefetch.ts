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
 * At most one break is ever in flight: the engine looks exactly one track
 * ahead, so a second target means the first is stale.
 */

import type { SchedulerState } from "@/lib/dj/scheduler";
import type { DjSegmentPlan, DjTransitionType } from "@/types/dj";

/** How much of the outgoing track is reserved for warming the next break. */
export const LOOKAHEAD_SECONDS = 20;

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
}: {
  position: number;
  duration: number;
}): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (!Number.isFinite(position) || position < 0) return false;
  return duration - position <= LOOKAHEAD_SECONDS;
}

type PrefetchSlot = {
  trackKey: string;
  abort: AbortController;
  result: Promise<PreparedDjBreak | null>;
  /** Whether a clip is currently held warm in the voice node for this slot. */
  warmed: boolean;
};

export class DjPrefetchController {
  private slot: PrefetchSlot | null = null;

  private readonly preload?: (blob: Blob) => Promise<void>;
  private readonly discardPreload?: () => void;

  constructor(options: DjPrefetchOptions = {}) {
    this.preload = options.preload;
    this.discardPreload = options.discardPreload;
  }

  /** Track the lookahead is currently warming, if any. */
  get targetKey(): string | null {
    return this.slot?.trackKey ?? null;
  }

  /**
   * Begins warming the break for `trackKey`. Idempotent per key, so the
   * position clock can call this on every tick of the lookahead window without
   * stacking requests. A different key supersedes whatever was in flight.
   */
  start(trackKey: string, task: DjPrefetchTask): void {
    if (!trackKey) return;
    if (this.slot?.trackKey === trackKey) return;

    this.drop();

    const abort = new AbortController();
    const slot: PrefetchSlot = {
      trackKey,
      abort,
      result: Promise.resolve(null),
      warmed: false,
    };
    this.slot = slot;

    // Failures degrade to a live break rather than propagating: the transition
    // is still playable, it just pays the synthesis cost it would have anyway.
    slot.result = this.warm(slot, task).catch((error) => {
      if (!abort.signal.aborted) {
        console.warn("[DjPrefetch] Lookahead failed; break will be generated live:", error);
      }
      return null;
    });
  }

  /**
   * Claims the warmed break for `trackKey`, or null if nothing was warmed for
   * it. The claim is synchronous so the caller knows immediately whether to
   * plan live; the returned promise settles once synthesis finishes, which it
   * normally already has.
   */
  take(trackKey: string): Promise<PreparedDjBreak | null> | null {
    const slot = this.slot;
    if (!slot || slot.trackKey !== trackKey) return null;

    this.slot = null;
    return slot.result;
  }

  /**
   * Drops the warmed break unless it belongs to one of `keys`. Queue edits,
   * skips, and track advances all funnel through here: whatever is warm has to
   * still be either on air or up next, or it can never be played.
   */
  retain(keys: ReadonlyArray<string | undefined>): void {
    const slot = this.slot;
    if (!slot) return;
    if (keys.includes(slot.trackKey)) return;

    this.drop();
  }

  /** Abandons the lookahead entirely — station switch, new session, teardown. */
  clear(): void {
    this.drop();
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
    return prepared;
  }

  private drop(): void {
    const slot = this.slot;
    if (!slot) return;

    this.slot = null;
    slot.abort.abort();
    if (slot.warmed) this.discardPreload?.();
  }
}
