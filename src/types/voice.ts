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

export type TtsProvider = "openai" | "elevenlabs";

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
