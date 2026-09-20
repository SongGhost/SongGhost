/**
 * Prerecorded Custom-host welcome + fallback banks (Pass 2).
 *
 * Clips are rendered once by the local GPU sidecar and served as static WAVs.
 * OpenAI-selected voices skip this bank (live TTS opener stays).
 *
 * Layout (generated, not committed):
 *   public/audio/prerecorded/slot-{1-4}/welcome-01.wav
 *   public/audio/prerecorded/slot-{1-4}/fallback-01.wav
 * Scripts (checked in): src/lib/audio/prerecorded/scripts.json
 */

import type { VoiceSpeaker } from "@/lib/audio/VoiceNode";
import type { LocalVoiceSlot, TtsProvider } from "@/types/voice";
import {
  FALLBACK_SCRIPTS,
  LOCAL_PRERECORDED_SLOT_LABELS,
  LOCAL_PRERECORDED_SLOTS,
  WELCOME_SCRIPTS,
  type PrerecordedKind,
  type PrerecordedScript,
  prerecordedPublicUrl,
  scriptById,
  scriptsForKind,
} from "./prerecorded/scripts";

export {
  FALLBACK_SCRIPTS,
  LOCAL_PRERECORDED_SLOT_LABELS,
  LOCAL_PRERECORDED_SLOTS,
  WELCOME_SCRIPTS,
  prerecordedPublicUrl,
  scriptById,
  scriptsForKind,
  type PrerecordedKind,
  type PrerecordedScript,
};

/** Avoid repeating the same line for this many picks per slot+kind. */
export const PRERECORDED_RECENT_WINDOW = 6;

const recentByBank = new Map<string, string[]>();

function bankKey(slot: LocalVoiceSlot, kind: PrerecordedKind): string {
  return `${slot}:${kind}`;
}

export function resetPrerecordedRecent(): void {
  recentByBank.clear();
}

export function recentPrerecordedIds(
  slot: LocalVoiceSlot,
  kind: PrerecordedKind,
): readonly string[] {
  return recentByBank.get(bankKey(slot, kind)) ?? [];
}

/**
 * Random pick that prefers ids not in the recent window.
 * If every id was used recently, the window resets and any id may fire.
 */
export function pickUnusedRecent(
  ids: readonly string[],
  recent: readonly string[],
  random: () => number = Math.random,
): string | null {
  if (ids.length === 0) return null;
  const unused = ids.filter((id) => !recent.includes(id));
  const pool = unused.length > 0 ? unused : [...ids];
  const index = Math.floor(random() * pool.length);
  return pool[index] ?? pool[0] ?? null;
}

export function rememberPrerecordedPick(
  slot: LocalVoiceSlot,
  kind: PrerecordedKind,
  id: string,
): void {
  const key = bankKey(slot, kind);
  const prev = recentByBank.get(key) ?? [];
  const next = [...prev.filter((row) => row !== id), id].slice(
    -PRERECORDED_RECENT_WINDOW,
  );
  recentByBank.set(key, next);
}

export function pickPrerecordedScript(
  kind: PrerecordedKind,
  slot: LocalVoiceSlot,
  random?: () => number,
): PrerecordedScript | null {
  const scripts = scriptsForKind(kind);
  const id = pickUnusedRecent(
    scripts.map((row) => row.id),
    recentPrerecordedIds(slot, kind),
    random,
  );
  if (!id) return null;
  return scriptById(kind, id) ?? null;
}

export function isLocalPrerecordedHost(
  provider: TtsProvider | string | undefined,
  voiceSlot: LocalVoiceSlot | undefined,
): voiceSlot is LocalVoiceSlot {
  return provider === "local" && voiceSlot != null;
}

export type PrerecordedClip = {
  id: string;
  kind: PrerecordedKind;
  slot: LocalVoiceSlot;
  script: string;
  audioBlob: Blob;
};

async function fetchClipBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return null;
    return new Blob([buffer], {
      type: response.headers.get("content-type") || "audio/wav",
    });
  } catch {
    return null;
  }
}

/**
 * Pick a recent-unused line and load its WAV. Missing files (bank not
 * generated yet) return null so the caller can use live TTS or skip.
 */
export async function fetchPrerecordedClip(
  kind: PrerecordedKind,
  slot: LocalVoiceSlot,
  signal?: AbortSignal,
): Promise<PrerecordedClip | null> {
  const missing = new Set<string>();
  const all = scriptsForKind(kind);
  while (missing.size < all.length) {
    if (signal?.aborted) return null;
    const remaining = all.filter((row) => !missing.has(row.id));
    const recent = recentPrerecordedIds(slot, kind).filter((id) => !missing.has(id));
    const id = pickUnusedRecent(remaining.map((row) => row.id), recent);
    if (!id) return null;
    const row = scriptById(kind, id);
    if (!row) {
      missing.add(id);
      continue;
    }
    const blob = await fetchClipBlob(prerecordedPublicUrl(slot, kind, id), signal);
    if (!blob) {
      missing.add(id);
      continue;
    }
    rememberPrerecordedPick(slot, kind, id);
    return { id, kind, slot, script: row.text, audioBlob: blob };
  }
  return null;
}

export type PlayPrerecordedInGapOptions = {
  kind: PrerecordedKind;
  slot: LocalVoiceSlot;
  voiceNode: VoiceSpeaker;
  generation?: number;
  canPlay?: () => boolean;
  signal?: AbortSignal;
  onScript?: (script: string) => void;
};

/**
 * Play a prerecorded clip only while the song is still held in the gap.
 * Pass 1 refuse-late-play wins: if `canPlay` is false, this is a no-op.
 */
export async function playPrerecordedInGap(
  options: PlayPrerecordedInGapOptions,
): Promise<boolean> {
  if (options.signal?.aborted) return false;
  if (options.canPlay && !options.canPlay()) return false;

  const clip = await fetchPrerecordedClip(options.kind, options.slot, options.signal);
  if (!clip) return false;
  if (options.signal?.aborted) return false;
  if (options.canPlay && !options.canPlay()) return false;

  options.onScript?.(clip.script);
  await options.voiceNode.play({
    audioBlob: clip.audioBlob,
    generation: options.generation,
    canPlay: options.canPlay,
    signal: options.signal,
  });
  return true;
}

/** Recovery line when a live break is not ready — Custom voices only. */
export async function tryPlayPrerecordedFallback(options: {
  provider?: TtsProvider | string;
  voiceSlot?: LocalVoiceSlot;
  voiceNode: VoiceSpeaker;
  generation?: number;
  canPlay?: () => boolean;
  signal?: AbortSignal;
  onScript?: (script: string) => void;
}): Promise<boolean> {
  if (!isLocalPrerecordedHost(options.provider, options.voiceSlot)) return false;
  return playPrerecordedInGap({
    kind: "fallback",
    slot: options.voiceSlot,
    voiceNode: options.voiceNode,
    generation: options.generation,
    canPlay: options.canPlay,
    signal: options.signal,
    onScript: options.onScript,
  });
}
