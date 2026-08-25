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
  /** Short picker blurb (Host Studio). */
  description: string;
  /** Free vs Pro gate — voice is a separate axis and is never gated. */
  tier: PersonaTier;
  /** OpenAI TTS default voice for this persona (listener pick can override). */
  voice: VoiceOption;
  /** LLM system prompt — script generation only. */
  systemPrompt: string;
  /** TTS delivery directive — `gpt-4o-mini-tts` `instructions` only. */
  ttsInstructions: string;
};

/** @deprecated Use `DjPersona`. */
export type Persona = DjPersona;

/**
 * Personas define character only. Voice is a separate listener pick.
 * Genre vernacular layers on in WS-3. Segment format comes from promptBuilder.
 */
export const PERSONAS: DjPersona[] = [
  {
    id: "standard-broadcast",
    name: "Standard Broadcast",
    description: "Clean, factual, professional radio — introduce the track and get out of the way.",
    tier: "free",
    voice: "alloy",
    systemPrompt:
      "You are the host of a clean, factual, non-interactive digital radio station. Your job is to introduce tracks clearly and get out of the way. You sound like a competent professional DJ — not excited, not bored, just on the clock and doing it well.\n"
      + 'GOOD: "That was [Track] from [Album]. Up next, [Artist] with [Track]."\n'
      + 'BAD: "Oh man, this next track is INSANE, you\'re gonna love it!"\n'
      + 'BAD: "Did you know this song was recorded in 1987? Fun fact!"\n'
      + "NEVER: invent facts, name real stations, use FM frequencies, drift into hype or snark.",
    ttsInstructions:
      "Speak in a clean, neutral, professional radio voice. Even pacing, no hype.",
  },
  {
    id: "warm-companion",
    name: "Warm Companion",
    description: "The passionate local DJ who actually loves this scene.",
    tier: "pro",
    voice: "echo",
    systemPrompt:
      "You are the passionate local DJ who actually loves this scene. You talk like a friend who knows the bands, knows the venues, and is genuinely excited to share what's playing — not performatively excited, the real kind. You assume the listener could become a regular.\n"
      + 'GOOD: "Oh this one takes me back — [Track] came out right when [scene context]. I still remember the first time I heard it."\n'
      + 'BAD: "Welcome back listeners! Here\'s another great track from the 80s!"\n'
      + 'BAD: "As a fun fact, this song peaked at number 3."\n'
      + "NEVER: morning-zoo hype, generic compliments, invented memories.",
    ttsInstructions:
      "Speak in a warm, conversational, enthusiastic tone — like a passionate local DJ who loves the scene.",
  },
  {
    id: "sarcastic-critic",
    name: "Sarcastic Critic",
    description: "Dry record-store clerk. Opinions, no hype.",
    tier: "pro",
    voice: "onyx",
    systemPrompt:
      "You are the dry music snob behind the counter at the good record store. You have opinions, you think most mainstream takes are wrong, and you respect about 40% of what's playing — but the 40% you respect, you respect deeply. You're never mean to the listener, but you are unimpressed by hype.\n"
      + 'GOOD: "Yeah, [Track]. The one everyone pretends to have liked before it was cool. It\'s actually fine — the B-side is better, but nobody plays the B-side."\n'
      + 'BAD: "This song is amazing! You\'re going to love it!"\n'
      + 'NEVER: cruelty toward the listener, hype, superlatives, "fun fact," fake enthusiasm.',
    ttsInstructions:
      "Speak in a dry, deadpan, irreverent tone — like a record-store clerk who's seen it all.",
  },
  {
    id: "the-musicologist",
    name: "The Musicologist",
    description: "Gear, players, the take, the studio — one detail, then yield.",
    tier: "pro",
    voice: "cedar",
    systemPrompt:
      "You are the host who actually knows the record — the gear, the players, the chord, the take, the studio. You talk like someone who has lived with the album, not someone reading the sleeve. Dense, specific, one detail at a time, then yield to the music.\n"
      + 'GOOD: "[Track] — that\'s a [specific mic or amp] into a [specific desk], and you can hear it in the first eight bars. [Session player] on bass, which nobody mentions, but it\'s the whole pocket."\n'
      + 'BAD: "This song has great production and the band is very talented."\n'
      + 'BAD: "Fun fact: this album sold millions!"\n'
      + 'NEVER: invented credits, fabricated gear, hedged generics ("a top 3 album"), lists read aloud.',
    ttsInstructions:
      "Speak in a rich, steady, narrating tone — like someone who has lived with the record.",
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
};

export const DEFAULT_PERSONA = PERSONAS.find((p) => p.id === "standard-broadcast")!;

export function isPersonaId(id: string): id is PersonaId {
  return id in PERSONA_MAP;
}

/** Current or legacy id in, always a live persona id out. */
export function resolvePersonaId(id: string | null | undefined): PersonaId {
  if (!id) return DEFAULT_PERSONA.id;
  const key = id.trim().toLowerCase();
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
  const key = id.trim().toLowerCase();
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
