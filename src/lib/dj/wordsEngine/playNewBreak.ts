/**
 * Play one New break in the pre-song gap.
 * Lore-type plans: earcon, short pause, one speech. Then the caller starts
 * the song at 100%. This does not duck and does not call playDjIntro.
 * Song 1 (session opener) is refused — that liner stays on the Classic path.
 */

import type { VoiceSpeaker } from "@/lib/audio/VoiceNode";
import { tryPlayPrerecordedFallback } from "@/lib/audio/prerecorded";
import {
  isLoreEarconSrc,
  playEarconFailClosed,
  resolveEarconSrc,
  waitCommentaryGap,
} from "@/lib/dj/earcon";
import { synthesizeNewBreak, type NewBreakClipRequest } from "./synthesize";

export type PlayNewBreakOptions = NewBreakClipRequest & {
  voiceNode: VoiceSpeaker;
  audioBlob?: Blob;
  script?: string;
  /** True when the spoken line uses at least one real fact from the pack. */
  includesRealFact?: boolean;
  onScript?: (script: string) => void;
  onBreakExit?: () => void;
  generation?: number;
  canPlay?: () => boolean;
};

export type PlayNewBreakResult = {
  played: boolean;
};

/**
 * The lore chime plays only when the line carries a real fact.
 * Names-only and identity-only lines do not. Weather, concert, and teaser
 * cues are unchanged.
 */
export function newBreakWantsEarcon(
  earconSrc: string | null,
  includesRealFact: boolean,
): boolean {
  if (!earconSrc) return false;
  if (isLoreEarconSrc(earconSrc)) return includesRealFact;
  return true;
}

function stillAirable(options: PlayNewBreakOptions): boolean {
  if (options.signal?.aborted) return false;
  if (options.canPlay && !options.canPlay()) return false;
  return true;
}

export async function playNewBreak(options: PlayNewBreakOptions): Promise<PlayNewBreakResult> {
  if (options.segmentPlan?.isSessionOpening === true) {
    return { played: false };
  }
  if (!stillAirable(options)) return { played: false };

  let blob = options.audioBlob;
  let script = options.script?.trim() ?? "";
  let includesRealFact = options.includesRealFact === true;
  if (!blob) {
    const clip = await synthesizeNewBreak(options);
    if (!clip) {
      const played = await tryPlayPrerecordedFallback({
        provider: options.provider,
        voiceSlot: options.voiceSlot,
        voiceNode: options.voiceNode,
        generation: options.generation,
        canPlay: options.canPlay,
        signal: options.signal,
        onScript: options.onScript,
      });
      return { played };
    }
    blob = clip.blob;
    script = clip.script;
    includesRealFact = clip.includesRealFact;
  }

  if (!stillAirable(options) || !blob) return { played: false };
  if (script) options.onScript?.(script);

  const plan = options.segmentPlan;
  if (plan) {
    const earcon = resolveEarconSrc(plan);
    if (newBreakWantsEarcon(earcon, includesRealFact)) {
      await playEarconFailClosed(earcon, { signal: options.signal });
      if (!stillAirable(options)) return { played: false };
      try {
        await waitCommentaryGap(undefined, options.signal);
      } catch {
        return { played: false };
      }
    }
  }

  if (!stillAirable(options)) return { played: false };

  await options.voiceNode.play({
    audioBlob: blob,
    signal: options.signal,
    generation: options.generation,
    canPlay: options.canPlay,
  });
  options.onBreakExit?.();
  return { played: true };
}
