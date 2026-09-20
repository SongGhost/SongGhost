import type { LocalVoiceSlot } from "@/types/voice";
import raw from "./scripts.json";

export type PrerecordedKind = "welcome" | "fallback";

export type PrerecordedScript = {
  id: string;
  text: string;
};

type ScriptFile = {
  welcomes: PrerecordedScript[];
  fallbacks: PrerecordedScript[];
};

const scripts = raw as ScriptFile;

export const LOCAL_PRERECORDED_SLOTS: readonly LocalVoiceSlot[] = [1, 2, 3, 4];

/** Harris / Piper / Quinn / Bea — same Custom cards as Host Studio. */
export const LOCAL_PRERECORDED_SLOT_LABELS: Record<LocalVoiceSlot, string> = {
  1: "Harris",
  2: "Piper",
  3: "Quinn",
  4: "Bea",
};

export const WELCOME_SCRIPTS: readonly PrerecordedScript[] = scripts.welcomes;
export const FALLBACK_SCRIPTS: readonly PrerecordedScript[] = scripts.fallbacks;

export function scriptsForKind(kind: PrerecordedKind): readonly PrerecordedScript[] {
  return kind === "welcome" ? WELCOME_SCRIPTS : FALLBACK_SCRIPTS;
}

export function scriptById(
  kind: PrerecordedKind,
  id: string,
): PrerecordedScript | undefined {
  return scriptsForKind(kind).find((row) => row.id === id);
}

/** Public URL for a generated clip. Files live under `public/audio/prerecorded/`. */
export function prerecordedPublicUrl(
  slot: LocalVoiceSlot,
  kind: PrerecordedKind,
  id: string,
): string {
  return `/audio/prerecorded/slot-${slot}/${id}.wav`;
}
