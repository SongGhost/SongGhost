export type VoiceOption =
  | "onyx"
  | "fable"
  | "nova"
  | "alloy"
  | "echo"
  | "shimmer"
  | "ash"
  | "coral"
  | "sage"
  | "ballad"
  | "verse"
  | "marin"
  | "cedar";

export type TtsProvider = "openai" | "elevenlabs" | "local";

/**
 * Laptop custom-host slots (Chatterbox-Turbo sidecar).
 * Stored on `UserPreferences.preferredVoice` as a namespaced id so Phase D
 * can read `provider: "local"` + slot without colliding with OpenAI ids.
 */
export type LocalVoiceSlot = 1 | 2 | 3 | 4;

export type LocalCustomVoiceId = `local:${LocalVoiceSlot}`;

/** Host Studio voice pick: an OpenAI id, or `local:1` … `local:4`. */
export type PreferredVoice = VoiceOption | LocalCustomVoiceId;

export type LocalCustomHostClipStatus = "sample" | "empty";

export type LocalCustomHostOption = {
  id: LocalCustomVoiceId;
  slot: LocalVoiceSlot;
  label: string;
  description: string;
  clipStatus: LocalCustomHostClipStatus;
};

export const LOCAL_CUSTOM_HOST_OPTIONS: readonly LocalCustomHostOption[] = [
  {
    id: "local:1",
    slot: 1,
    label: "Custom 1",
    description: "Laptop host A. Needs the local voice helper.",
    clipStatus: "sample",
  },
  {
    id: "local:2",
    slot: 2,
    label: "Custom 2",
    description: "Laptop host B. Needs the local voice helper.",
    clipStatus: "sample",
  },
  {
    id: "local:3",
    slot: 3,
    label: "Custom 3",
    description: "Laptop host C. Drop a WAV in slot-3 to enable.",
    clipStatus: "empty",
  },
  {
    id: "local:4",
    slot: 4,
    label: "Custom 4",
    description: "Laptop host D. Drop a WAV in slot-4 to enable.",
    clipStatus: "empty",
  },
];

const LOCAL_CUSTOM_VOICE_RE = /^local:([1-4])$/;

export function isLocalCustomVoiceId(value: string): value is LocalCustomVoiceId {
  return LOCAL_CUSTOM_VOICE_RE.test(value.trim().toLowerCase());
}

export function parseLocalVoiceSlot(value: string): LocalVoiceSlot | undefined {
  const match = LOCAL_CUSTOM_VOICE_RE.exec(value.trim().toLowerCase());
  if (!match) return undefined;
  return Number(match[1]) as LocalVoiceSlot;
}

export function getLocalCustomHostOption(
  value: string,
): LocalCustomHostOption | undefined {
  const slot = parseLocalVoiceSlot(value);
  if (!slot) return undefined;
  return LOCAL_CUSTOM_HOST_OPTIONS[slot - 1];
}

export function isPreferredVoice(value: string): value is PreferredVoice {
  const key = value.trim().toLowerCase();
  return isVoiceOption(key) || isLocalCustomVoiceId(key);
}

/** Host Studio pick → OpenAI voice or local sidecar slot. Live dial reads this. */
export function resolvePreferredVoiceTarget(value: string): {
  provider: TtsProvider;
  voiceId?: VoiceOption;
  voiceSlot?: LocalVoiceSlot;
} | null {
  const key = value.trim().toLowerCase();
  if (isVoiceOption(key)) {
    return { provider: "openai", voiceId: key };
  }
  const slot = parseLocalVoiceSlot(key);
  if (slot) {
    return { provider: "local", voiceSlot: slot };
  }
  return null;
}

/** Original 6 OpenAI voices that have ElevenLabs premade mappings. */
export type LegacyOpenAiVoice = Extract<
  VoiceOption,
  "onyx" | "fable" | "nova" | "alloy" | "echo" | "shimmer"
>;

export const VOICE_OPTIONS: {
  id: VoiceOption;
  label: string;
  description: string;
}[] = [
  { id: "onyx", label: "Onyx", description: "Deep, authoritative, bold" },
  { id: "echo", label: "Echo", description: "Warm, smooth, conversational" },
  { id: "ash", label: "Ash", description: "Approachable, warm, friendly" },
  { id: "ballad", label: "Ballad", description: "Expressive, storytelling narrator" },
  { id: "cedar", label: "Cedar", description: "Rich, steady narration" },
  { id: "nova", label: "Nova", description: "Upbeat, bright, lively" },
  { id: "coral", label: "Coral", description: "Clean, polished, highly articulate" },
  { id: "shimmer", label: "Shimmer", description: "Soft, gentle, intimate" },
  { id: "sage", label: "Sage", description: "Calm, steady, instructional" },
  { id: "marin", label: "Marin", description: "Warm, conversational narrator" },
  { id: "fable", label: "Fable", description: "Animated British accent" },
  { id: "alloy", label: "Alloy", description: "Balanced, neutral default" },
  { id: "verse", label: "Verse", description: "Dynamic, engaging tone" },
];

export function isVoiceOption(value: string): value is VoiceOption {
  return VOICE_OPTIONS.some((option) => option.id === value);
}

export const ELEVENLABS_VOICE_MAP: Record<LegacyOpenAiVoice, string> = {
  onyx: "pNInz6obpgDQGcFmaJgB",
  fable: "EXAVITQu4vr4xnSDxMaL",
  nova: "piTKgcLEGmPE4e6mEKli",
  alloy: "VR6AewLTigWG4xSOukaG",
  echo: "pqHfZKP75CvOlQylNhV4",
  shimmer: "jsCqWAovK2LkecY7zXl4",
};

// ash, ballad, cedar, coral, marin, sage, and verse are OpenAI-only —
// they have no ElevenLabs premade mapping. Do not invent IDs for them.
// The original 6 mappings above stay for the mothballed ElevenLabs path (WS-7).
