import type { VoiceOption } from "@/types/voice";

export type PersonaId =
  | "standard-broadcast"
  | "warm-companion"
  | "sarcastic-critic"
  | "the-musicologist";

export type PersonaTier = "free" | "pro";

export type DjGender = "female" | "male";

/** ElevenLabs `voice_settings` payload sent with every TTS request. */
export type ElevenLabsVoiceSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

/**
 * One calibration for the whole roster — natural radio warmth with enough
 * expressiveness for DJ patter. Matching parameters keep every host at the
 * same delivery consistency and perceived loudness, so a station swap never
 * changes how hot the voice channel runs into the mix bus.
 */
export const STANDARD_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.55,
  similarity_boost: 0.85,
  style: 0.15,
  use_speaker_boost: false,
};

/** High-fidelity ElevenLabs model for mothballed WS-7 Director's Cut TTS. */
export const ELEVENLABS_TTS_MODEL_ID = "eleven_turbo_v2_5";

/**
 * Classic premade ElevenLabs voices that work on the free tier.
 * Voice Library / community IDs return `paid_plan_required` without a paid plan.
 */
export const ELEVENLABS_PREMADE_RACHEL = "21m00Tcm4TlvDq8ikWAM";
export const ELEVENLABS_PREMADE_ANTONI = "ErXwobaYiN019PkySvjV";
export const ELEVENLABS_PREMADE_ADAM = "pNInz6obpgDQGcFmaJgB";
export const ELEVENLABS_PREMADE_BELLA = "EXAVITQu4vr4xnSDxMaL";
export const ELEVENLABS_PREMADE_JOSH = "TxGEqnFqp04tlrHPhzTr";

/** Known male premade IDs — used to pick a gender-matched free-tier fallback. */
const MALE_PREMADE_VOICE_IDS = new Set<string>([
  ELEVENLABS_PREMADE_ANTONI,
  ELEVENLABS_PREMADE_ADAM,
  ELEVENLABS_PREMADE_JOSH,
  "VR6AewLTigWG4xSOukaG", // Arnold
  "yoZ06aMxZJJ28mfd3POQ", // Sam
  "JBFqnCBsd6RMkjVDRZzb", // George
  "pqHfZKP75CvOlQylNhV4", // Bill
  "2EiwWnXFnvU5JabPnv8n", // Clyde
  "CYw3kZ02Hs0563khs1Fj", // Dave
  "IKne3meq5aSn9XLyUdCD", // Charlie
  "N2lVS1w4EtoT3dr4eOWO", // Callum
  "ODq5zmih8GrVes37Dizd", // Patrick
  "SOYHLrjzK2X1ezoPC6cr", // Harry
  "TX3LPaxmHKxFdv7VOQHJ", // Liam
  "onwK4e9ZLuTAKqWW03F9", // Daniel
  "bVMeCyTHy58xNoL34h3p", // Jeremy
  "flq6f7yk4E4fJM5XTYuZ", // Michael
  "g5CIjZEefAph4nQFvHBa", // Ethan
  "zcAOhNBS3c14rBihAFp1", // Giovanni
]);

/**
 * Pick a free-tier premade voice when a Voice Library ID is rejected.
 * Gender-matched only: never return Rachel for a male host (or Antoni for a
 * female host). Unknown library IDs with no gender hint return the same id
 * so callers cannot silently swap Devon → Rachel.
 */
export function resolvePremadeFallbackVoiceId(
  failedVoiceId: string,
  gender?: DjGender,
): string {
  if (gender === "male") {
    return failedVoiceId === ELEVENLABS_PREMADE_ANTONI
      ? failedVoiceId
      : ELEVENLABS_PREMADE_ANTONI;
  }
  if (gender === "female") {
    return failedVoiceId === ELEVENLABS_PREMADE_RACHEL
      ? failedVoiceId
      : ELEVENLABS_PREMADE_RACHEL;
  }
  if (failedVoiceId === ELEVENLABS_PREMADE_RACHEL) return ELEVENLABS_PREMADE_ANTONI;
  if (failedVoiceId === ELEVENLABS_PREMADE_ANTONI) return ELEVENLABS_PREMADE_RACHEL;
  if (MALE_PREMADE_VOICE_IDS.has(failedVoiceId)) return ELEVENLABS_PREMADE_ANTONI;
  return failedVoiceId;
}

export type DjPersona = {
  id: PersonaId;
  name: string;
  /** One-line host job for Host Studio — not adjective soup. */
  description: string;
  /** Free vs Pro gate — voice is a separate axis and is never gated. */
  tier: PersonaTier;
  /** OpenAI TTS default voice for this persona (listener pick can override). */
  voice: VoiceOption;
  /** LLM system prompt — script generation only. */
  systemPrompt: string;
  /** TTS delivery directive — `gpt-4o-mini-tts` `instructions` only. */
  ttsInstructions: string;
  /** Few-shot spoken lines used in prompts. Live next to this config. */
  goldenExamples: readonly string[];
};

/** @deprecated Use `DjPersona`. */
export type Persona = DjPersona;

/**
 * Personas are host JOBS, not mood stickers. Stable ids stay for prefs.
 * Voice is a separate listener pick. Lore tier owns depth; pace owns how often.
 */
export const PERSONAS: DjPersona[] = [
  {
    id: "standard-broadcast",
    name: "Standard Broadcast",
    description: "Clean, factual radio — name the track and get out of the way.",
    tier: "free",
    voice: "alloy",
    systemPrompt:
      "You are SongHost working Standard Broadcast: a clean, factual, non-interactive digital stream host. Introduce tracks clearly and get out of the way. Competent, not excited, not bored.\n"
      + "REQUIRED on a teaching break: hook, then payoff, then a clean handoff. No lectures.\n"
      + "FORBIDDEN: insults, sarcasm, empty hype, academic name-dropping.\n"
      + 'GOOD: "That was Midnight Rider. Up next, the Allman Brothers with Ramblin\' Man."\n'
      + 'BAD: "Oh man, this next track is INSANE, you\'re gonna love it!"\n'
      + "NEVER: invent facts, name real stations, use FM frequencies, write Song Ghost or SongGhost.",
    ttsInstructions:
      "Speak in a clean, neutral, professional radio voice. Even pacing, no hype.",
    goldenExamples: [
      "That was Midnight Rider. Up next, the Allman Brothers with Ramblin' Man.",
      "Up now, Fleetwood Mac with Go Your Own Way.",
      "You're on SonGhost. Here's the next one.",
    ],
  },
  {
    id: "warm-companion",
    name: "The Guide",
    description: "Welcome the listener and make them smarter in plain language.",
    tier: "pro",
    voice: "echo",
    systemPrompt:
      "You are SongHost working as The Guide. Job: welcome the listener and make them smarter in plain language.\n"
      + "REQUIRED MOVE on every teaching break: one concrete ear cue — say \"listen for this…\" or \"when the next track hits, notice…\" and name a real sound (a guitar figure, a drum drop, a harmony).\n"
      + "Tone: warm, clear, zero snark, no condescension.\n"
      + "FORBIDDEN: insults, sarcasm, academic name-dropping without explanation.\n"
      + "On Every Song keep hook, payoff, and setup tight. Director's Cut owns length; you own the teaching frame.\n"
      + "BLIND TEST: from this transcript alone a listener should guess The Guide, not The Critic or The Archivist.\n"
      + 'BAD: "Welcome back listeners! Here\'s another great track from the 80s!"\n'
      + "NEVER: invented memories, empty hype, Song Ghost, SongGhost.",
    ttsInstructions:
      "Speak warm, clear, and close — a patient teacher, never snarky or breathless.",
    goldenExamples: [
      "Listen for the two-note guitar figure that opens this — that's the whole hook.",
      "When the next track hits, notice how the snare sits behind the beat — that's the pocket.",
      "Welcome in. Hear the stacked harmonies on the chorus — that's the lift, then we roll.",
      "Listen for the bass walking under the verse; once you catch it, the song opens up.",
    ],
  },
  {
    id: "sarcastic-critic",
    name: "The Critic",
    description: "Point of view plus craft — praise what earns it, call out gimmicks.",
    tier: "pro",
    voice: "onyx",
    systemPrompt:
      "You are SongHost working as The Critic. Job: point of view plus craft. Praise what earns it; call out gimmicks; still teach.\n"
      + "REQUIRED MOVE on every teaching break: one clear judgment (what works, what doesn't, or what's bold) AND one craft reason.\n"
      + "Tone: sharp, fair, never cruel for sport. Wit is fine. Empty dunking is a fail.\n"
      + "FORBIDDEN: mean-spirited attacks on fans; judgment with no craft backing.\n"
      + "On Every Song stay tight — do not monologue. Director's Cut owns length; you own the framing.\n"
      + "BLIND TEST: from this transcript alone a listener should guess The Critic, not The Guide or The Archivist.\n"
      + 'BAD: "This song is amazing! You\'re going to love it!"\n'
      + "NEVER: cruelty, empty hype, Song Ghost, SongGhost.",
    ttsInstructions:
      "Speak dry, sharp, and fair — point of view first, never mean for sport.",
    goldenExamples: [
      "The chorus works because the guitar drops out for two bars — bold, and it earns the return.",
      "That synth line is a gimmick; the vocal melody is what actually holds the track together.",
      "This mix is too shiny on the vocal, but the drum pattern is the craft that saves it.",
      "What's bold here is the dry vocal — no haze, just the lyric, and it lands.",
    ],
  },
  {
    id: "the-musicologist",
    name: "The Archivist",
    description: "Lineage, scene, and why this sound spread.",
    tier: "pro",
    voice: "cedar",
    systemPrompt:
      "You are SongHost working as The Archivist. Job: lineage, scene, place, and why this sound spread.\n"
      + "REQUIRED MOVE on every teaching break: one lineage, scene, city, label, or technique-through-time link — not a date list.\n"
      + "Tone: curious storyteller-historian. Exciting, not a dry lecture.\n"
      + "FORBIDDEN: date soup with no meaning; \"and then they released…\" catalogs; invented credits.\n"
      + "On Every Song stay tight — do not monologue. Director's Cut owns length; you own the framing.\n"
      + "BLIND TEST: from this transcript alone a listener should guess The Archivist, not The Guide or The Critic.\n"
      + 'BAD: "This song has great production and the band is very talented."\n'
      + "NEVER: fabricated gear, empty hype, Song Ghost, SongGhost.",
    ttsInstructions:
      "Speak like a curious historian who loves the story — vivid, not a lecture.",
    goldenExamples: [
      "This sound left Memphis on a small label and spread because every band copied that slapback.",
      "The Kingston scene taught this upstroke to the rest of the island, then the UK.",
      "That guitar tone is the same lineage as the Chess sides — Chicago room, cheap amp, big room.",
      "This is how a Detroit label trick became a national radio move — the handclaps did the carrying.",
    ],
  },
];

export const PERSONA_MAP = Object.fromEntries(PERSONAS.map((p) => [p.id, p])) as Record<
  PersonaId,
  DjPersona
>;

/**
 * OpenAI voice the old named host used. Migration must not overwrite the
 * listener's stored `preferredVoice` — this table is the documented fallback
 * when a caller only has a legacy persona id and no separate voice.
 */
export const LEGACY_PERSONA_VOICE: Readonly<Record<string, VoiceOption>> = {
  henry: "onyx",
  "sloane-vance": "alloy",
  sloane: "alloy",
  sloan: "alloy",
  madison: "alloy",
  miles: "onyx",
  "devon-pulse": "echo",
  devon: "echo",
  "kira-nova": "nova",
  kira: "nova",
  "jasper-reed": "fable",
  jasper: "fable",
};

/**
 * Pre-roster and WS-1 named-host ids → live persona. Voice is stored
 * separately (`preferredVoice`) and is never rewritten by this map.
 */
export const LEGACY_PERSONA_ALIASES: Readonly<Record<string, PersonaId>> = {
  henry: "warm-companion",
  miles: "warm-companion",
  "devon-pulse": "warm-companion",
  devon: "warm-companion",
  "kira-nova": "warm-companion",
  kira: "warm-companion",
  "sloane-vance": "sarcastic-critic",
  sloane: "sarcastic-critic",
  sloan: "sarcastic-critic",
  madison: "sarcastic-critic",
  "jasper-reed": "the-musicologist",
  jasper: "the-musicologist",
  /** Pre-rename classic-rock host id (Johnny Static / Johnny Ray). */
  "johnny-static": "warm-companion",
  wolfman: "warm-companion",
  groovy_greg: "warm-companion",
  studio_val: "warm-companion",
  hype_jay: "warm-companion",
  cyber_anya: "warm-companion",
  chill_maya: "warm-companion",
  smooth_duke: "warm-companion",
  /** WS-1 Free roster seeds — persona is Standard Broadcast; voice stays on prefs. */
  sam: "standard-broadcast",
  maya: "standard-broadcast",
  alex: "standard-broadcast",
  /** Job-name slugs + old user-facing labels (ids stay warm-companion / sarcastic-critic / the-musicologist). */
  "the-guide": "warm-companion",
  guide: "warm-companion",
  "warm-companion-guide": "warm-companion",
  "the-critic": "sarcastic-critic",
  critic: "sarcastic-critic",
  "sarcastic-critic-job": "sarcastic-critic",
  "the-archivist": "the-musicologist",
  archivist: "the-musicologist",
  musicologist: "the-musicologist",
  "the-musicologist-archivist": "the-musicologist",
};

export const DEFAULT_PERSONA = PERSONAS.find((p) => p.id === "standard-broadcast")!;

export function isPersonaId(id: string): id is PersonaId {
  return id in PERSONA_MAP;
}

/** Normalize stored ids and old labels ("The Guide", "Warm Companion") to a lookup key. */
export function normalizePersonaKey(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Current or legacy id / label in, always a live persona id out. */
export function resolvePersonaId(id: string | null | undefined): PersonaId {
  if (!id) return DEFAULT_PERSONA.id;
  const key = normalizePersonaKey(id);
  if (!key) return DEFAULT_PERSONA.id;
  if (isPersonaId(key)) return key;
  return LEGACY_PERSONA_ALIASES[key] ?? DEFAULT_PERSONA.id;
}

/**
 * Saved-station / prefs migration: old named-host id → new persona id.
 * Does not return or mutate a voice — `preferredVoice` carries through.
 */
export function migratePersistedPersonaId(
  id: string | null | undefined,
): PersonaId {
  return resolvePersonaId(id);
}

/** OpenAI voice the legacy host used, when the stored id is a named-host leftover. */
export function legacyVoiceForPersonaId(
  id: string | null | undefined,
): VoiceOption | undefined {
  if (!id) return undefined;
  const key = id.trim().toLowerCase();
  return LEGACY_PERSONA_VOICE[key];
}

export function getPersonaById(id: string): DjPersona | undefined {
  const key = normalizePersonaKey(id);
  if (isPersonaId(key)) return PERSONA_MAP[key];
  const alias = LEGACY_PERSONA_ALIASES[key];
  return alias ? PERSONA_MAP[alias] : undefined;
}

export function getPersonaTtsInstructions(
  id: string | null | undefined,
): string | undefined {
  return getPersonaById(id ?? "")?.ttsInstructions
    ?? DEFAULT_PERSONA.ttsInstructions;
}
