export type VoiceOption = "onyx" | "fable" | "nova" | "alloy" | "echo" | "shimmer";

export type TtsProvider = "openai" | "elevenlabs";

export const VOICE_OPTIONS: {
  id: VoiceOption;
  label: string;
  description: string;
}[] = [
  { id: "onyx", label: "Onyx", description: "Deep, authoritative male" },
  { id: "fable", label: "Fable", description: "Warm, expressive British" },
  { id: "nova", label: "Nova", description: "Bright, energetic female" },
  { id: "alloy", label: "Alloy", description: "Neutral, versatile" },
  { id: "echo", label: "Echo", description: "Smooth, mellow male" },
  { id: "shimmer", label: "Shimmer", description: "Soft, airy female" },
];

export const ELEVENLABS_VOICE_MAP: Record<VoiceOption, string> = {
  onyx: "pNInz6obpgDQGcFmaJgB",
  fable: "EXAVITQu4vr4xnSDxMaL",
  nova: "piTKgcLEGmPE4e6mEKli",
  alloy: "VR6AewLTigWG4xSOukaG",
  echo: "pqHfZKP75CvOlQylNhV4",
  shimmer: "jsCqWAovK2LkecY7zXl4",
};
