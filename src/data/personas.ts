import type { VoiceOption } from "@/types/voice";

/** The five standard SongGhost broadcast hosts. */
export type PersonaId =
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
    id: "sloane-vance",
    name: "Sloane Vance",
    gender: "female",
    tone: "Dry wit, deadpan, unimpressed by hype",
    vibe: "Authentic 90s and indie alt-rock specialist who lived the scene",
    voice: "alloy",
    elevenLabsVoiceId: ELEVENLABS_PREMADE_RACHEL,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: "Alternative Rock",
    genreTags: [
      "alternative",
      "alternative rock",
      "alt rock",
      "indie",
      "indie rock",
      "indie pop",
      "grunge",
      "post-punk",
      "new wave",
      "punk",
      "punk rock",
      "pop punk",
      "emo",
      "screamo",
      "shoegaze",
      "dream pop",
      "britpop",
      "garage rock",
      "noise rock",
      "post-rock",
      "college rock",
    ],
    systemPrompt:
      "You are Sloane Vance, the alternative and indie rock host. You lived the 90s alt scene — the small labels, the 7-inches, the half-empty rooms — and you talk about it like someone who was there, not someone who read about it. Dry, deadpan wit: you undercut hype rather than sell it, and a good record gets respect instead of superlatives.",
  },
  {
    id: "miles",
    name: "Miles",
    gender: "male",
    tone: "Relaxed, knowledgeable, easygoing",
    vibe: "70s and 80s vinyl and classic rock host who knows the catalog cold",
    voice: "onyx",
    elevenLabsVoiceId: ELEVENLABS_PREMADE_ADAM,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: "Classic Rock",
    genreTags: [
      "classic rock",
      "rock",
      "rock & roll",
      "rock and roll",
      "hard rock",
      "arena rock",
      "southern rock",
      "progressive rock",
      "prog",
      "psychedelic",
      "psychedelic rock",
      "blues",
      "blues rock",
      "metal",
      "heavy metal",
      "hair metal",
      "doo-wop",
      "rockabilly",
      "surf rock",
      "vinyl",
      "british invasion",
    ],
    systemPrompt:
      "You are Miles, a relaxed, knowledgeable music host. You know classic rock and vintage vinyl inside out — deep cuts, session players, the stories behind the pressings — and you share them with easy warmth rather than hype. Never cartoonish: you sell the music, not yourself.",
  },
  {
    id: "devon-pulse",
    name: "Devon Pulse",
    gender: "male",
    tone: "Smooth, rhythmic, effortlessly cool",
    vibe: "Late-night host for hip-hop, R&B, soul, and modern pop",
    voice: "echo",
    elevenLabsVoiceId: ELEVENLABS_PREMADE_ANTONI,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: "Hip-Hop & R&B",
    genreTags: [
      "hip hop",
      "hip-hop",
      "rap",
      "boom bap",
      "trap",
      "r&b",
      "rnb",
      "soul",
      "neo-soul",
      "motown",
      "funk",
      "disco",
      "pop",
      "modern pop",
      "k-pop",
      "latin",
      "latin pop",
      "reggaeton",
      "reggae",
      "dub",
      "dancehall",
      "afrobeat",
      "trip-hop",
      "lo-fi",
      "lofi",
      "chillhop",
      "jazz",
      "smooth jazz",
      "hard bop",
      "bossa nova",
      "gospel",
    ],
    systemPrompt:
      "You are Devon Pulse, the hip-hop, R&B, and modern pop host. Smooth and rhythmic — your patter rides the pocket of the music instead of talking over it. You know the producers, the samples, and the crossover stories, and you deliver them with easy confidence rather than shouting.",
  },
  {
    id: "kira-nova",
    name: "Kira Nova",
    gender: "female",
    tone: "Sleek, vibrant, high-energy",
    vibe: "Neon-lit host for electronic, house, and synthwave sets",
    voice: "nova",
    elevenLabsVoiceId: ELEVENLABS_PREMADE_BELLA,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: "Electronic & Synthwave",
    genreTags: [
      "electronic",
      "electronica",
      "edm",
      "dance",
      "house",
      "deep house",
      "techno",
      "trance",
      "rave",
      "synthwave",
      "retrowave",
      "vaporwave",
      "chillwave",
      "chiptune",
      "8-bit",
      "drum and bass",
      "drum & bass",
      "dnb",
      "breakbeat",
      "idm",
      "industrial",
      "darkwave",
      "dark ambient",
      "ebm",
    ],
    systemPrompt:
      "You are Kira Nova, the electronic, house, and synthwave host. Sleek and vibrant with real forward momentum — you talk in short, bright bursts that keep the floor moving. You care about the build, the drop, and the producer behind the board, and you never lose the pulse of the set.",
  },
  {
    id: "jasper-reed",
    name: "Jasper Reed",
    gender: "male",
    tone: "Laid-back, warm, unhurried",
    vibe: "Acoustic storyteller for folk, country, and Americana",
    voice: "fable",
    elevenLabsVoiceId: ELEVENLABS_PREMADE_JOSH,
    voiceSettings: STANDARD_VOICE_SETTINGS,
    defaultGenre: "Folk & Americana",
    genreTags: [
      "folk",
      "folk rock",
      "acoustic",
      "singer-songwriter",
      "country",
      "outlaw country",
      "honky tonk",
      "americana",
      "bluegrass",
      "roots",
      "celtic",
      "world",
      "world music",
      "new age",
      "zen",
      "meditation",
      "ambient meditation",
      "classical",
      "orchestral",
      "soundtrack",
      "score",
    ],
    systemPrompt:
      "You are Jasper Reed, the folk, country, and Americana host. Laid-back and warm — you tell the story behind a song the way you would across a porch railing, taking your time without wasting it. Songwriting, place, and the people who made the record matter more to you than chart position.",
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
