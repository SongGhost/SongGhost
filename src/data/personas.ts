import { ELEVENLABS_HOST_VOICE_DEFAULTS } from "@/config/elevenlabs-voices";
import { HOST_PERSONA_AFFINITY } from "@/config/host-persona-affinity";
import type { VoiceOption } from "@/types/voice";

/** The six standard SongGhost broadcast hosts. */
export type PersonaId =
  | "henry"
  | "sloane-vance"
  | "miles"
  | "devon-pulse"
  | "kira-nova"
  | "jasper-reed";

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
  stability: 0.35,
  similarity_boost: 0.85,
  style: 0.2,
  use_speaker_boost: true,
};

/** High-fidelity ElevenLabs model for companion lore + generate-voice TTS. */
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
 * Prefers Antoni for known male defaults, otherwise Rachel.
 */
export function resolvePremadeFallbackVoiceId(failedVoiceId: string): string {
  if (failedVoiceId === ELEVENLABS_PREMADE_RACHEL) return ELEVENLABS_PREMADE_ANTONI;
  if (failedVoiceId === ELEVENLABS_PREMADE_ANTONI) return ELEVENLABS_PREMADE_RACHEL;
  if (MALE_PREMADE_VOICE_IDS.has(failedVoiceId)) return ELEVENLABS_PREMADE_ANTONI;
  return ELEVENLABS_PREMADE_RACHEL;
}

export type DjPersona = {
  id: PersonaId;
  name: string;
  gender: DjGender;
  /** Delivery character handed to the script model */
  tone: string;
  /** Booth atmosphere handed to the script model */
  vibe: string;
  /** OpenAI TTS voice — the Free-tier fallback for this host */
  voice: VoiceOption;
  elevenLabsVoiceId: string;
  voiceSettings: ElevenLabsVoiceSettings;
  defaultGenre: string;
  /** Lowercase decade/genre keywords consumed by the dynamic resolver */
  genreTags: readonly string[];
  /** Decade coverage for affinity / decade fallback matching */
  decadeTags: readonly string[];
  systemPrompt: string;
};

/** @deprecated Use `DjPersona`. */
export type Persona = DjPersona;

/**
 * Personas define voice and character only. Segment format — what to say, how long,
 * and whether to name a track at all — comes from the segment brief in promptBuilder.
 * Station identity comes from the live station, never from the persona.
 */
export const PERSONAS: DjPersona[] = [
  {
    id: "henry",
    name: "Henry",
    gender: "male",
    tone: "Warm, grounded, unhurried twang without the caricature",
    vibe: "Anything-country host — classic, outlaw, modern, and Americana",
    voice: "onyx",
    elevenLabsVoiceId: ELEVENLABS_HOST_VOICE_DEFAULTS.henry,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: HOST_PERSONA_AFFINITY.henry.primary,
    genreTags: HOST_PERSONA_AFFINITY.henry.genres,
    decadeTags: HOST_PERSONA_AFFINITY.henry.decades,
    systemPrompt:
      "You are Henry, the country host. Classic country, outlaw, Americana, bluegrass, and modern country are your lane — you talk like someone who knows the writers, the towns, and the trucks in the songs. Warm and grounded: no cartoon drawl, just honest booth talk that respects the song.",
  },
  {
    id: "sloane-vance",
    name: "Sloane Vance",
    gender: "female",
    tone: "Dry wit, deadpan, unimpressed by hype",
    vibe: "Modern alternative, indie, and new wave specialist",
    voice: "alloy",
    elevenLabsVoiceId: ELEVENLABS_HOST_VOICE_DEFAULTS.sloane,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: HOST_PERSONA_AFFINITY["sloane-vance"].primary,
    genreTags: HOST_PERSONA_AFFINITY["sloane-vance"].genres,
    decadeTags: HOST_PERSONA_AFFINITY["sloane-vance"].decades,
    systemPrompt:
      "You are Sloane Vance, the modern alternative, indie, and new wave host. You talk about alt rock, post-punk, and synthwave like someone who lived the scene — dry, deadpan wit that undercuts hype and gives a good record respect instead of superlatives.",
  },
  {
    id: "miles",
    name: "Miles Vanguard",
    gender: "male",
    tone: "Relaxed, pocket-aware, street-smart without shouting",
    vibe: "Hip-hop, R&B, rap, and beats host who knows the crate",
    voice: "onyx",
    elevenLabsVoiceId: ELEVENLABS_HOST_VOICE_DEFAULTS.miles,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: HOST_PERSONA_AFFINITY.miles.primary,
    genreTags: HOST_PERSONA_AFFINITY.miles.genres,
    decadeTags: HOST_PERSONA_AFFINITY.miles.decades,
    systemPrompt:
      "You are Miles Vanguard, an authority on Hip-Hop, R&B, Rap, and Beats. Boom bap, trap, neo-soul, and the sample lineage are your bread and butter — you ride the pocket, name the producers when it matters, and keep the energy cool rather than hyped.",
  },
  {
    id: "devon-pulse",
    name: "Devon Pulse",
    gender: "male",
    tone: "Smooth, late-night, effortlessly cool",
    vibe: "Jazz, soul, Motown, and lo-fi host for quiet hours",
    voice: "echo",
    elevenLabsVoiceId: ELEVENLABS_HOST_VOICE_DEFAULTS.devon,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: HOST_PERSONA_AFFINITY["devon-pulse"].primary,
    genreTags: HOST_PERSONA_AFFINITY["devon-pulse"].genres,
    decadeTags: HOST_PERSONA_AFFINITY["devon-pulse"].decades,
    systemPrompt:
      "You are Devon Pulse, the jazz, soul, Motown, and lo-fi host. Smooth and unhurried — quiet storm, downtempo, and chillout sets get the late-night treatment. You care about players, grooves, and atmosphere more than chart noise.",
  },
  {
    id: "kira-nova",
    name: "Kira Nova",
    gender: "female",
    tone: "Sleek, vibrant, high-energy",
    vibe: "Pop, mainstream, dance, and club-floor host",
    voice: "nova",
    elevenLabsVoiceId: ELEVENLABS_HOST_VOICE_DEFAULTS.kira,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: HOST_PERSONA_AFFINITY["kira-nova"].primary,
    genreTags: HOST_PERSONA_AFFINITY["kira-nova"].genres,
    decadeTags: HOST_PERSONA_AFFINITY["kira-nova"].decades,
    systemPrompt:
      "You are Kira Nova, the pop, mainstream, and dance host. Top 40, disco, house, EDM, and club energy — short, bright bursts that keep the floor moving. You care about the hook, the build, and the moment the chorus hits.",
  },
  {
    id: "jasper-reed",
    name: "Jasper Reed",
    gender: "male",
    tone: "Laid-back, warm, unhurried",
    vibe: "Folk, grunge, punk, and hard-rock storyteller",
    voice: "fable",
    elevenLabsVoiceId: ELEVENLABS_HOST_VOICE_DEFAULTS.jasper,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: HOST_PERSONA_AFFINITY["jasper-reed"].primary,
    genreTags: HOST_PERSONA_AFFINITY["jasper-reed"].genres,
    decadeTags: HOST_PERSONA_AFFINITY["jasper-reed"].decades,
    systemPrompt:
      "You are Jasper Reed, the folk, grunge, punk, and hard-rock host. Indie folk to classic rock to metal — you tell the story behind a song the way you would across a porch railing or in a sticky-floor club, taking your time without wasting it.",
  },
];

export const PERSONA_MAP = Object.fromEntries(PERSONAS.map((p) => [p.id, p])) as Record<
  PersonaId,
  DjPersona
>;

/**
 * Pre-roster persona ids, kept so persisted listener preferences and saved stations
 * from older builds resolve to a real host instead of rendering a blank DJ.
 */
export const LEGACY_PERSONA_ALIASES: Readonly<Record<string, PersonaId>> = {
  madison: "sloane-vance",
  sloan: "sloane-vance",
  /** Pre-rename classic-rock host id (Johnny Static / Johnny Ray). */
  "johnny-static": "miles",
  wolfman: "miles",
  groovy_greg: "miles",
  studio_val: "devon-pulse",
  hype_jay: "devon-pulse",
  cyber_anya: "kira-nova",
  chill_maya: "devon-pulse",
  smooth_duke: "devon-pulse",
};

export const DEFAULT_PERSONA = PERSONAS.find((p) => p.id === "miles")!;

export function isPersonaId(id: string): id is PersonaId {
  return id in PERSONA_MAP;
}

/** Current or legacy id in, always a live host id out. */
export function resolvePersonaId(id: string | null | undefined): PersonaId {
  if (!id) return DEFAULT_PERSONA.id;
  if (isPersonaId(id)) return id;
  return LEGACY_PERSONA_ALIASES[id] ?? DEFAULT_PERSONA.id;
}

export function getPersonaById(id: string): DjPersona | undefined {
  if (isPersonaId(id)) return PERSONA_MAP[id];
  const alias = LEGACY_PERSONA_ALIASES[id];
  return alias ? PERSONA_MAP[alias] : undefined;
}
