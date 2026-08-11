import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { parseAllowExplicit } from "@/lib/content-filter";
import { getExcludedFactTopics } from "@/lib/dj/factEngine";
import {
  buildAntiRepetitionDirective,
  buildCommentaryFormatDirective,
  buildDjScriptPrompt,
  buildExplicitContentDirective,
  resolveAtmosphericBroadcastContext,
  type PromptBuilderContext,
} from "@/lib/dj/promptBuilder";
import {
  extractClientIp,
  formatLocationForPrompt,
  formatWeatherForPrompt,
  getBriefWeatherWithin,
  resolveClientClock,
  WEATHER_LOOKUP_DEADLINE_MS,
} from "@/lib/location/weather";
import { formatScriptForTts, sanitizeDjScript } from "@/lib/dj-script";
import {
  ensureTerminalPunctuation,
  prepareTtsSynthesisText,
} from "@/lib/tts";
import { isSavedStationId } from "@/lib/saved-stations";
import { db, cachedLoreBreaks } from "@/lib/db";
import {
  audioBufferToDataUrl,
  isR2Configured,
  uploadLoreAudioBuffer,
} from "@/lib/storage/r2";
import { getPersonaElevenLabsVoiceMap } from "@/config/elevenlabs-voices";
import { resolveMilesOrDevonVoiceId } from "@/lib/dj/personaConfig";
import {
  DEFAULT_PERSONA,
  ELEVENLABS_TTS_MODEL_ID,
  PERSONAS,
  STANDARD_VOICE_SETTINGS,
  getPersonaById,
  resolvePremadeFallbackVoiceId,
  type ElevenLabsVoiceSettings,
} from "@/data/personas";
import type { PersonaId } from "@/data/personas";
import { voiceSettingsForPersonality } from "@/lib/dj/voice-settings";

/** Explicit Miles ElevenLabs voice — never shares a fallback with Devon or Johnny. */
const milesVoiceId =
  process.env.ELEVENLABS_VOICE_MILES || "gyIv9PAQRvJjSZlk68oE";

/** Explicit Devon ElevenLabs voice — never shares a fallback with Miles or Johnny. */
const devonVoiceId =
  process.env.ELEVENLABS_VOICE_DEVON || "2ajXGJNYBR0iNHpS4VZb";
import {
  enforceFreeTierBreakQuota,
  incrementFreeTierBreakCount,
  resolveListenerTier,
  type SubscriptionTier,
} from "@/lib/usage/dj-breaks";
import {
  FREE_TIER_DJ_PACE,
  resolveCommentaryFormat,
  type CommentaryFormat,
  type DjKnowledge,
  type DjMode,
  type DjMood,
  type DjPersonality,
  type DjSegmentPlan,
  type LocalConcertEvent,
} from "@/types/dj";
import {
  DEFAULT_CHATTER_PACING,
  normalizeAlbumContext,
  normalizeVoiceProfileOverride,
  resolveChatterPacing,
  resolveEraLock,
  sanitizeVibePrompt,
  type ChatterPacing,
  type StationMode,
} from "@/types/station";

/** Hard ceiling so the model cannot emit lecture-length DJ copy. */
const SCRIPT_MAX_TOKENS = 100;

/** In-depth lore needs more headroom (~90 words). */
const SCRIPT_MAX_TOKENS_IN_DEPTH = 160;

/** TTS clips mid-sentence when scripts run long — keep under this char budget. */
const TTS_SCRIPT_MAX_CHARS = 280;

/** Char budgets roughly matching per-mode word caps (avg ~6 chars/word). */
const DJ_MODE_MAX_CHARS: Record<Exclude<DjMode, "no_dj">, number> = {
  active: 140,
  balanced: 320,
  in_depth: 580,
};

/** Strict spoken-word ceilings enforced after generation. */
const DJ_MODE_MAX_WORDS: Record<Exclude<DjMode, "no_dj">, number> = {
  active: 20,
  balanced: 50,
  in_depth: 90,
};

function isScriptDjMode(value: unknown): value is Exclude<DjMode, "no_dj"> {
  return value === "active" || value === "balanced" || value === "in_depth";
}

function resolveScriptDjMode(value: unknown): Exclude<DjMode, "no_dj"> {
  return isScriptDjMode(value) ? value : "balanced";
}

/**
 * Free-tier pace lock: SHORT BREAKS only (`balanced` / `standard` chatter),
 * regardless of client `djMode` / `talkLevel` / `chatterPacing` / `breakPace`.
 */
function resolveScriptDjModeForTier(
  value: unknown,
  tier: SubscriptionTier,
): Exclude<DjMode, "no_dj"> {
  if (tier === "free") return "balanced";
  return resolveScriptDjMode(value);
}

function resolveTalkLevelForTier(
  value: unknown,
  tier: SubscriptionTier,
): ChatterPacing {
  if (tier === "free") return DEFAULT_CHATTER_PACING;
  return resolveChatterPacing(value);
}

/** Normalize Free-tier pace fields on the request body before script generation. */
function applyFreeTierPaceGuard(
  body: Record<string, unknown>,
  tier: SubscriptionTier,
): Record<string, unknown> {
  if (tier !== "free") return body;
  return {
    ...body,
    breakPace: "short",
    pace: FREE_TIER_DJ_PACE,
    djMode: "balanced",
    talkLevel: DEFAULT_CHATTER_PACING,
    chatterPacing: DEFAULT_CHATTER_PACING,
  };
}

function isDjMood(value: unknown): value is DjMood {
  return value === "chill" || value === "even_keel" || value === "hyped";
}

function resolveDjMood(value: unknown): DjMood {
  // Legacy Tuning Console labels.
  if (value === "balanced") return "even_keel";
  return isDjMood(value) ? value : "even_keel";
}

function isDjPersonality(value: unknown): value is DjPersonality {
  return (
    value === "kind"
    || value === "dry"
    || value === "sarcastic"
    || value === "funny"
    || value === "normal"
  );
}

function resolveDjPersonality(value: unknown): DjPersonality {
  // Legacy Tuning Console labels.
  if (value === "obnoxious") return "funny";
  if (value === "elitist") return "sarcastic";
  if (value === "neutral") return "normal";
  return isDjPersonality(value) ? value : "normal";
}

/**
 * Absolute ban on fabricated recording lore. Appended to every generate-script
 * system prompt (companion lore + classic segment path).
 */
const STRICT_TRUTH_GUARDRAIL =
  " STRICT TRUTH GUARDRAIL: Never invent false recording anecdotes, studio locations,"
  + " or biographical details. If you lack verified historical facts for a song or"
  + " artist, describe the musical vibe, production elements, or chart context instead"
  + " of making up trivia.";

/** Absolute ban on FM / dial / call-letter language in every generated script. */
const DIGITAL_STATION_IDENTITY_RULE =
  " STATION IDENTITY: You host a SongHost digital stream / curated station."
  + " NEVER mention FM frequencies, dial numbers, or radio call letters."
  + " Refer only to SongHost, the curated station name, or the genre title given in context.";

/**
 * Strict TTS pacing rules so the LLM emits copy that synthesizes cleanly.
 * Appended to every generate-script system prompt.
 */
const TTS_FORMATTING_RULES =
  " Write all numbers as words (e.g., 'nineteen ninety-nine' not '1999')."
  + " Use ellipses ('...') before comedic punchlines, sarcastic observations, or transition pauses."
  + " Use em-dashes ('—') for fast digital-stream transitions."
  + " Avoid ALL CAPS or uncommon punctuation that disrupts speech synthesis flow.";

function isDjKnowledge(value: unknown): value is DjKnowledge {
  return value === "basic_facts" || value === "smart" || value === "genius";
}

function resolveDjKnowledge(value: unknown): DjKnowledge {
  // Legacy Tuning Console labels.
  if (value === "minimal") return "basic_facts";
  if (value === "moderate") return "smart";
  if (value === "deep") return "genius";
  return isDjKnowledge(value) ? value : "smart";
}

function personalityGuidance(personality: DjPersonality): string {
  switch (personality) {
    case "kind":
      return " Tone: Exceptionally warm, encouraging, and welcoming.";
    case "dry":
      return " Tone: Deadpan, dryly witty, and understated. Use subtle irony.";
    case "sarcastic":
      return (
        " Tone: Snarky, sarcastic, and biting. Use sharp wit and clever jabs"
        + " about musical trends."
      );
    case "funny":
      return (
        " Tone: Lighthearted, witty, and hilarious. Focus on funny anecdotes"
        + " or humorous observations about the band."
      );
    case "normal":
    default:
      return " Tone: Clean, polished, broadcast-standard SongHost digital stream host.";
  }
}

function knowledgeGuidance(knowledge: DjKnowledge): string {
  switch (knowledge) {
    case "basic_facts":
      return (
        " Keep trivia minimal. Limit commentary to artist name, song title,"
        + " and chart context."
      );
    case "genius":
      return (
        " Provide deep, obscure musicologist lore—discuss studio gear,"
        + " producer techniques, or rare B-side trivia."
      );
    case "smart":
    default:
      return (
        " Include 1 interesting, verified historical fact about the band,"
        + " release year, or album origins."
      );
  }
}

function truncateToWordLimit(text: string, maxWords: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxWords <= 0) return trimmed;
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;

  const slice = words.slice(0, maxWords).join(" ");
  const lastPunct = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );
  if (lastPunct > slice.length * 0.4) {
    return slice.slice(0, lastPunct + 1).trim();
  }
  return slice.replace(/[,:;—.]+$/, "").trim();
}

function parseExcludedFacts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const topic = entry.trim();
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    out.push(topic);
  }
  return out;
}

/**
 * Prefer caller-supplied topics; otherwise load previously served fact texts
 * for the authenticated Clerk user from the Anti-Repetition Fact Engine ledger.
 */
async function resolveExcludedFacts(
  bodyExcluded: unknown,
  userId: string | null | undefined,
): Promise<string[]> {
  const fromBody = parseExcludedFacts(bodyExcluded);
  if (fromBody.length) return fromBody;

  const trimmedUser = userId?.trim();
  if (!trimmedUser) return [];

  try {
    return await getExcludedFactTopics(trimmedUser);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[generate-script] Fact-engine history lookup failed, continuing without exclusions:",
      message,
    );
    return [];
  }
}

function buildLoreSystemPrompt(input: {
  djMode: Exclude<DjMode, "no_dj">;
  isAlbumDive: boolean;
  hasHistory: boolean;
  hasUpcoming: boolean;
  personality: DjPersonality;
  knowledge: DjKnowledge;
  allowExplicit?: boolean;
  commentaryFormat?: CommentaryFormat;
  excludedFacts?: string[];
}): string {
  const {
    djMode,
    isAlbumDive,
    hasHistory,
    hasUpcoming,
    personality,
    knowledge,
    allowExplicit,
    commentaryFormat,
    excludedFacts,
  } = input;
  const maxWords = DJ_MODE_MAX_WORDS[djMode];

  const modeGuidance =
    djMode === "active"
      ? ` MODE: ACTIVE. STRICT MAXIMUM ${maxWords} WORDS.`
        + " Station ID + a quick track recap or intro only."
        + " Keep it snappy — liners and teases, not stories."
      : djMode === "in_depth"
        ? ` MODE: IN-DEPTH. STRICT MAXIMUM ${maxWords} WORDS.`
          + " Deliver a vivid story arc about the song or artist — not a laundry list of facts."
        : ` MODE: BALANCED. STRICT MAXIMUM ${maxWords} WORDS.`
          + " Brief recap and a next-track tease when context allows.";

  const pacingCues =
    " Format for human speech: use ellipsis (...) for mid-sentence micro-pauses,"
    + " and em-dashes (—) or exclamation marks for natural vocal cadence shifts."
    + " Write like a live SongHost digital stream host — conversational, using natural curated-station transitions."
    + " Never sound like you are reading an encyclopedia entry.";

  return (
    "You are a SongHost digital stream host delivering a short music-lore break."
    + modeGuidance
    + personalityGuidance(personality)
    + knowledgeGuidance(knowledge)
    + STRICT_TRUTH_GUARDRAIL
    + DIGITAL_STATION_IDENTITY_RULE
    + buildExplicitContentDirective(allowExplicit)
    + pacingCues
    + TTS_FORMATTING_RULES
    + buildCommentaryFormatDirective(commentaryFormat)
    + " Never invent producers, studios, chart positions, or gear you are not sure about."
    + " Never use trivia-setup phrases like 'fun fact' or 'did you know'."
    + " recentHistory contains songs that ALREADY FINISHED playing — only those may be framed as 'you just heard' / 'that was'."
    + " currentTrack is the song STARTING RIGHT NOW — introduce it as starting or playing now, NEVER as 'you just heard'."
    + (isAlbumDive
      ? " This is an album deep dive — one specific lore angle about this track on the record."
      : "")
    + (hasHistory || hasUpcoming
      ? " When history or upcoming queue data is provided, naturally weave a brief multi-song recap"
        + ' (e.g. "That was Song A into Song B...") and/or an upcoming teaser'
        + ' (e.g. "Coming up next we have Song C...")'
        + (djMode === "active"
          ? " — keep it ultra-brief."
          : " alongside the break — keep it conversational, not a playlist read.")
      : "")
    + buildAntiRepetitionDirective(excludedFacts)
  );
}

/** ElevenLabs MPEG output is typically 128 kbps CBR. */
const MP3_BITRATE_BPS = 128_000;

/**
 * Trim verbose scripts at the last complete sentence so TTS never cuts off mid-phrase.
 * Falls back to the last whitespace before the cap when no sentence end is found.
 *
 * Kept file-local — Next.js route modules may only export HTTP handlers.
 */
function truncateScriptForTts(
  text: string,
  maxChars: number = TTS_SCRIPT_MAX_CHARS,
): string {
  const script = text.trim();
  if (script.length <= maxChars) return script;

  const slice = script.slice(0, maxChars);
  const lastPunct = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );

  if (lastPunct > 0) {
    return slice.slice(0, lastPunct + 1).trim();
  }

  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

function estimateMp3DurationSec(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  return Math.round(((byteLength * 8) / MP3_BITRATE_BPS) * 100) / 100;
}

/** Server-side transcript log for every generate-script response that carries copy. */
function logDjScriptTranscript(
  personaId: string | undefined,
  djMode: string,
  scriptText: string,
): void {
  console.log(
    `[LinerLore DJ Script] (${personaId ?? "unknown"} | ${djMode}): "${scriptText}"`,
  );
}

/** Fatal missing-env response used by early validation in POST. */
function missingEnvResponse(varName: string): NextResponse {
  console.error("[generate-script FATAL] Missing environment variable:", varName);
  return NextResponse.json({ error: `Missing env var: ${varName}` }, { status: 500 });
}

/** Ensure a required env var is present. Returns a 500 response when missing. */
function requireEnvVar(varName: string): NextResponse | null {
  const value = process.env[varName];
  if (!value || !value.trim()) {
    return missingEnvResponse(varName);
  }
  return null;
}

function requireEnvVars(varNames: readonly string[]): NextResponse | null {
  for (const varName of varNames) {
    const missing = requireEnvVar(varName);
    if (missing) return missing;
  }
  return null;
}

/** Always required for LLM script generation. */
const LLM_ENV_VARS = ["OPENAI_API_KEY"] as const;

/**
 * Required when the lore path synthesizes speech.
 * R2 is optional — when unset, audio is returned as a base64 data URL.
 */
const LORE_PIPELINE_ENV_VARS = [
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
] as const;

type LoreTrackRef = {
  title: string;
  artist: string;
};

type LoreCachePayload = {
  trackId: string;
  /** Explicit ElevenLabs voice — optional when `personaId` is supplied. */
  voiceId?: string;
  /**
   * UI host id (`sloane-vance` | `miles` | `devon-pulse` |
   * `kira-nova` | `jasper-reed`). Preferred over a bare voiceId so the
   * route owns the roster → high-fidelity voice mapping.
   */
  personaId?: string;
  /**
   * Authored studio host copy. When set with `voiceId`, skip LLM script
   * generation and synthesize this text directly (no Jasper/Kira defaults).
   */
  customText?: string;
  artist?: string;
  title?: string;
  album?: string;
  mode?: StationMode | string;
  /** Companion DJ depth / length mode from the UI selector. */
  djMode?: DjMode | string;
  /** Tuning Console vocal energy (cache key / future delivery knobs). */
  mood?: DjMood | string;
  /** Tuning Console narrative tone → ElevenLabs voice_settings. */
  personality?: DjPersonality | string;
  /** Tuning Console trivia depth guardrail. */
  knowledge?: DjKnowledge | string;
  /** Clean Mode gate — false enforces FCC-safe DJ copy. */
  allowExplicit?: boolean;
  /** Lore / commentary depth from Host Settings. */
  commentaryFormat?: CommentaryFormat | string;
  recentHistory?: LoreTrackRef[];
  upcomingQueue?: LoreTrackRef[];
};

/**
 * Full UI persona roster → ElevenLabs voice IDs (env overrides with catalog fallbacks).
 * Kept explicit so the lore pipeline never silently collapses hosts.
 */
const PERSONA_VOICE_MAP = getPersonaElevenLabsVoiceMap();

function isLoreCacheRequest(body: Record<string, unknown>): body is LoreCachePayload {
  if (typeof body.trackId !== "string" || body.trackId.length === 0) return false;
  const hasVoice =
    typeof body.voiceId === "string" && body.voiceId.length > 0;
  const hasPersona =
    typeof body.personaId === "string" && body.personaId.length > 0;
  return hasVoice || hasPersona;
}

/**
 * Resolve the ElevenLabs voice for a lore break.
 * Persona roster wins when a known host id is provided; otherwise the
 * caller-supplied voiceId / default Miles voice is used.
 */
function resolveLoreVoiceId(body: LoreCachePayload): {
  voiceId: string;
  personaId?: PersonaId;
} {
  if (typeof body.personaId === "string" && body.personaId.trim()) {
    const persona = getPersonaById(body.personaId.trim());
    if (persona) {
      const key = persona.id.toLowerCase();
      let voiceId: string;
      if (key === "miles") {
        voiceId = milesVoiceId;
      } else if (key === "devon" || key === "devon-pulse") {
        voiceId = devonVoiceId;
      } else {
        voiceId =
          resolveMilesOrDevonVoiceId(persona.id)
          ?? PERSONA_VOICE_MAP[persona.id]
          ?? persona.elevenLabsVoiceId;
      }
      return {
        voiceId,
        personaId: persona.id,
      };
    }
  }

  if (typeof body.voiceId === "string" && body.voiceId.trim()) {
    return { voiceId: body.voiceId.trim() };
  }

  return {
    voiceId: milesVoiceId,
    personaId: DEFAULT_PERSONA.id,
  };
}

function parseLoreTrackRefs(value: unknown, limit: number): LoreTrackRef[] {
  if (!Array.isArray(value) || limit <= 0) return [];
  const out: LoreTrackRef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const title =
      typeof (raw as { title?: unknown }).title === "string"
        ? (raw as { title: string }).title.trim()
        : "";
    const artist =
      typeof (raw as { artist?: unknown }).artist === "string"
        ? (raw as { artist: string }).artist.trim()
        : "";
    if (!title || !artist) continue;
    out.push({ title, artist });
    if (out.length >= limit) break;
  }
  return out;
}

function formatLoreTrackList(tracks: LoreTrackRef[]): string {
  return tracks.map((t) => `"${t.title}" by ${t.artist}`).join(", then ");
}

async function generateLoreScript(input: {
  artist: string;
  title: string;
  album?: string;
  mode?: string;
  djMode?: DjMode | string;
  mood?: DjMood | string;
  personality?: DjPersonality | string;
  knowledge?: DjKnowledge | string;
  allowExplicit?: boolean;
  commentaryFormat?: CommentaryFormat | string;
  recentHistory?: LoreTrackRef[];
  upcomingQueue?: LoreTrackRef[];
  excludedFacts?: string[];
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const djMode = resolveScriptDjMode(input.djMode);
  const personality = resolveDjPersonality(input.personality);
  const knowledge = resolveDjKnowledge(input.knowledge);
  const allowExplicit = parseAllowExplicit(input.allowExplicit);
  const commentaryFormat = resolveCommentaryFormat(input.commentaryFormat);
  const isAlbumDive = input.mode === "album_deep_dive";
  const albumLine = input.album ? ` Album: ${input.album}.` : "";
  const recentHistory = input.recentHistory ?? [];
  const upcomingQueue = input.upcomingQueue ?? [];
  const hasHistory = recentHistory.length > 0;
  const hasUpcoming = upcomingQueue.length > 0;
  const maxWords = DJ_MODE_MAX_WORDS[djMode];
  const maxChars = DJ_MODE_MAX_CHARS[djMode];

  const systemPrompt = buildLoreSystemPrompt({
    djMode,
    isAlbumDive,
    hasHistory,
    hasUpcoming,
    personality,
    knowledge,
    allowExplicit,
    commentaryFormat,
    excludedFacts: input.excludedFacts,
  });

  const contextLines: string[] = [
    `currentTrack (STARTING RIGHT NOW — introduce as playing/starting now, NOT "you just heard"): "${input.title}" by ${input.artist}.${albumLine}`,
  ];
  if (hasHistory) {
    contextLines.push(
      `recentHistory (ALREADY FINISHED — weave a natural recap like "That was [Song] into [Song]..."): ${formatLoreTrackList(recentHistory)}.`,
    );
  }
  if (hasUpcoming) {
    contextLines.push(
      `Coming up next — optional teaser like "Coming up next we have [Song]...": ${formatLoreTrackList(upcomingQueue)}.`,
    );
  }
  contextLines.push(
    `Write the on-air lore break now. STRICT MAXIMUM ${maxWords} WORDS.`,
  );

  const userPrompt = contextLines.join(" ");
  const maxTokens =
    djMode === "in_depth" ? SCRIPT_MAX_TOKENS_IN_DEPTH : SCRIPT_MAX_TOKENS;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.92,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error: ${error}`);
  }

  const data = await response.json();
  const rawScript = data.choices?.[0]?.message?.content?.trim();
  const script = rawScript
    ? truncateToWordLimit(
        truncateScriptForTts(
          formatScriptForTts(sanitizeDjScript(rawScript)),
          maxChars,
        ),
        maxWords,
      )
    : "";

  if (!script) {
    throw new Error("No script generated");
  }

  return script;
}

async function synthesizeElevenLabsSpeech(
  text: string,
  voiceId: string,
  voiceSettings: ElevenLabsVoiceSettings = STANDARD_VOICE_SETTINGS,
  allowFallback = true,
  personaId?: string,
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured");
  }

  console.log("[Voice Resolution]", {
    personaId: personaId ?? "(unknown)",
    resolvedVoiceId: voiceId,
  });
  console.log("[ElevenLabs] Requesting TTS for voiceId:", voiceId);

  const elevenLabsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_TTS_MODEL_ID,
        voice_settings: voiceSettings,
      }),
    },
  );

  if (!elevenLabsRes.ok) {
    const errorBody = await elevenLabsRes.text();
    const isLibraryVoiceRestricted =
      elevenLabsRes.status === 400
      || elevenLabsRes.status === 402
      || /paid_plan_required/i.test(errorBody);

    if (isLibraryVoiceRestricted && allowFallback) {
      const fallbackVoiceId = resolvePremadeFallbackVoiceId(voiceId);
      if (fallbackVoiceId !== voiceId) {
        console.warn(
          "[ElevenLabs] Library voice restricted on free tier. Retrying with default premade voice...",
        );
        return synthesizeElevenLabsSpeech(
          text,
          fallbackVoiceId,
          voiceSettings,
          false,
          personaId,
        );
      }
    }

    console.error(`[ElevenLabs Error] Status ${elevenLabsRes.status}:`, errorBody);
    const err = new Error(`ElevenLabs error: ${errorBody}`) as Error & {
      errorBody: string;
      status: number;
    };
    err.errorBody = errorBody;
    err.status = elevenLabsRes.status;
    throw err;
  }

  const arrayBuffer = await elevenLabsRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Phase 5 check-cache-first lore pipeline:
 * cache hit → return CDN audio; miss → LLM → ElevenLabs → R2 → DB → return.
 */
async function handleLoreCachePipeline(
  body: LoreCachePayload & { excludedFacts?: unknown },
  userId: string | null,
  tier: SubscriptionTier = "free",
) {
  const { trackId } = body;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Unknown Track";
  const artist =
    typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : "Unknown Artist";
  const album = typeof body.album === "string" && body.album.trim() ? body.album.trim() : undefined;
  const mode = typeof body.mode === "string" ? body.mode : undefined;
  const djMode = resolveScriptDjModeForTier(body.djMode, tier);
  const mood = resolveDjMood(body.mood);
  const personality = resolveDjPersonality(body.personality);
  const knowledge = resolveDjKnowledge(body.knowledge);
  const allowExplicit = parseAllowExplicit(body.allowExplicit);
  const commentaryFormat = resolveCommentaryFormat(body.commentaryFormat);
  const recentHistory = parseLoreTrackRefs(body.recentHistory, 5);
  const upcomingQueue = parseLoreTrackRefs(body.upcomingQueue, 2);
  const excludedFacts = await resolveExcludedFacts(body.excludedFacts, userId);

  // Studio authored script: TTS customText with the exact voiceId — never run
  // persona LLM generation or fall back to Jasper/Kira roster defaults.
  const customText =
    typeof body.customText === "string" ? body.customText.trim() : "";
  if (customText) {
    const authoredVoiceId =
      typeof body.voiceId === "string" && body.voiceId.trim()
        ? body.voiceId.trim()
        : null;
    if (!authoredVoiceId) {
      return NextResponse.json(
        { error: "customText requires an explicit voiceId" },
        { status: 400 },
      );
    }

    console.log("[generate-script] Studio customText TTS", {
      trackId,
      voiceId: authoredVoiceId,
      customTextChars: customText.length,
    });

    const punctuatedCustomText = ensureTerminalPunctuation(customText);
    let audioBuffer: Buffer;
    try {
      audioBuffer = await synthesizeElevenLabsSpeech(
        prepareTtsSynthesisText(punctuatedCustomText, "elevenlabs"),
        authoredVoiceId,
        voiceSettingsForPersonality(personality),
        true,
        typeof body.personaId === "string" ? body.personaId : undefined,
      );
    } catch (phase2Err) {
      console.error(
        "[generate-script] Studio customText ElevenLabs TTS failed:",
        phase2Err,
      );
      throw phase2Err;
    }

    const key = `studio-custom/${trackId}-${authoredVoiceId}-${customText.length}.mp3`;
    let audioUrl: string;
    if (isR2Configured()) {
      try {
        audioUrl = await uploadLoreAudioBuffer(key, audioBuffer);
      } catch (phase3Err) {
        console.error(
          "[generate-script] Studio customText R2 upload failed:",
          phase3Err,
        );
        audioUrl = audioBufferToDataUrl(audioBuffer);
      }
    } else {
      audioUrl = audioBufferToDataUrl(audioBuffer);
    }

    logDjScriptTranscript(undefined, djMode, punctuatedCustomText);
    return NextResponse.json({
      audioUrl,
      script: punctuatedCustomText,
      cached: false,
    });
  }

  const { voiceId, personaId } = resolveLoreVoiceId(body);
  // History/queue-aware scripts are session-specific — never reuse a bare
  // trackId+voiceId cache hit that would drop the recap/teaser context.
  // Mode/tuning-specific length/voice also must not reuse a different clip.
  // Anti-repetition exclusions are also per-listener — never share a bare cache hit.
  const contextAware =
    recentHistory.length > 0
    || upcomingQueue.length > 0
    || excludedFacts.length > 0
    || djMode !== "balanced"
    || mood !== "even_keel"
    || personality !== "normal"
    || knowledge !== "smart"
    // Clean vs explicit scripts must never share a bare trackId cache hit.
    || allowExplicit
    // Extended commentary formats must not reuse a standard-format cache hit.
    || commentaryFormat !== "standard";

  console.log("[generate-script] Lore voice resolved", {
    trackId,
    personaId: personaId ?? null,
    voiceId,
    djMode,
    mood,
    personality,
    knowledge,
    allowExplicit,
    commentaryFormat,
    roster: PERSONAS.map((p) => p.id),
  });

  let cached: typeof cachedLoreBreaks.$inferSelect | null = null;
  if (!contextAware) {
    try {
      const [row] = await db
        .select()
        .from(cachedLoreBreaks)
        .where(
          and(eq(cachedLoreBreaks.trackId, trackId), eq(cachedLoreBreaks.voiceId, voiceId)),
        )
        .limit(1);
      cached = row ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        "[generate-script] DB cache read failed, continuing with live generation:",
        message,
      );
      cached = null;
    }

    if (cached) {
      logDjScriptTranscript(personaId, djMode, cached.scriptText);
      return NextResponse.json({
        audioUrl: cached.audioUrl,
        script: cached.scriptText,
        cached: true,
        cost: 0,
      });
    }
  }

  let script: string;
  try {
    console.log("[generate-script Phase 1] Generating script with LLM...");
    script = await generateLoreScript({
      artist,
      title,
      album,
      mode,
      djMode,
      mood,
      personality,
      knowledge,
      allowExplicit,
      commentaryFormat,
      recentHistory,
      upcomingQueue,
      excludedFacts,
    });
  } catch (phase1Err) {
    console.error("[generate-script Phase 1] LLM script generation failed:", phase1Err);
    throw phase1Err;
  }

  // Store / display the punctuated script; pad only the synthesis payload so
  // the teleprompter never shows ElevenLabs `<break>` tags.
  script = ensureTerminalPunctuation(script);

  let audioBuffer: Buffer;
  try {
    console.log(
      "[generate-script Phase 2] Requesting ElevenLabs TTS for voiceId:",
      voiceId,
    );
    audioBuffer = await synthesizeElevenLabsSpeech(
      prepareTtsSynthesisText(script, "elevenlabs"),
      voiceId,
      voiceSettingsForPersonality(personality),
      true,
      personaId,
    );
  } catch (phase2Err) {
    console.error("[generate-script Phase 2] ElevenLabs TTS failed:", phase2Err);
    throw phase2Err;
  }

  const key = `lore/${trackId}-${voiceId}.mp3`;
  let audioUrl: string;
  if (isR2Configured()) {
    try {
      console.log("[generate-script Phase 3] Uploading MP3 to R2...");
      audioUrl = await uploadLoreAudioBuffer(key, audioBuffer);
    } catch (phase3Err) {
      console.error("[generate-script Phase 3] Storage upload failed:", phase3Err);
      throw new Error(
        `Cloudflare R2 Upload failed: ${
          phase3Err instanceof Error ? phase3Err.message : String(phase3Err)
        }`,
      );
    }
  } else {
    console.warn(
      "[generate-script Phase 3] R2 unconfigured — returning inline base64 audio data URL",
    );
    audioUrl = audioBufferToDataUrl(audioBuffer);
  }
  const durationSec = estimateMp3DurationSec(audioBuffer.byteLength);

  if (!contextAware) {
    try {
      await db.insert(cachedLoreBreaks).values({
        trackId,
        voiceId,
        scriptText: script,
        audioUrl,
        durationSec,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[generate-script] DB cache write failed, returning live result:", message);
    }
  }

  logDjScriptTranscript(personaId, djMode, script);
  return NextResponse.json({
    audioUrl,
    script,
    cached: false,
  });
}

/** Legacy DJ script path used by `generateDjBreak` (script-only, no TTS/cache). */
async function handleLegacyScriptGeneration(
  body: Record<string, unknown>,
  userId: string | null,
  tier: SubscriptionTier = "free",
  clientIp: string | null = null,
  requestHeaders: Headers = new Headers(),
) {
  const {
    songTitle,
    artistName,
    maxDurationInSeconds,
    personaId,
    djPersonaPrompt,
    segmentPlan,
    stationId,
    stationName,
    stationFrequency,
    eraLock,
    vibePrompt,
    voiceProfile,
    listenerCity,
    homeCity,
    localEvent,
    album,
    albumContext,
    talkLevel,
    chatterPacing,
    recentHistory,
    upcomingQueue,
    personality,
    knowledge,
    allowExplicit: allowExplicitBody,
    commentaryFormat: commentaryFormatBody,
    excludedFacts: excludedFactsBody,
  } = body;

  const plan = segmentPlan as DjSegmentPlan | undefined;
  const title = plan?.announceTracks.at(-1)?.title ?? songTitle ?? stationName ?? "Station";
  const artist = plan?.announceTracks.at(-1)?.artist ?? artistName ?? "DJ";

  if (!title || !artist) {
    if (plan?.kind !== "stinger") {
      return NextResponse.json(
        { error: "songTitle and artistName are required" },
        { status: 400 },
      );
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const resolvedTalkLevel = resolveTalkLevelForTier(
    talkLevel ?? chatterPacing,
    tier,
  );
  const resolvedAlbum = normalizeAlbumContext(albumContext) ?? undefined;
  const parsedHistory = parseLoreTrackRefs(recentHistory, 5);
  const parsedUpcoming = parseLoreTrackRefs(upcomingQueue, 2);
  const resolvedPersonality = resolveDjPersonality(personality);
  const resolvedKnowledge = resolveDjKnowledge(knowledge);
  const allowExplicit = parseAllowExplicit(allowExplicitBody);
  const commentaryFormat = resolveCommentaryFormat(commentaryFormatBody);
  const excludedFacts = await resolveExcludedFacts(excludedFactsBody, userId);

  // Weather: prefer Broadcast City (`homeCity`), else IP. Clock always from
  // client timezone headers so VPN egress cannot skew daypart / weekday.
  // Race budget is 800ms by default; getBriefWeatherWithin extends to 3000ms
  // when homeCity is set so cold Open-Meteo geocoding can finish on localhost.
  const resolvedHomeCity =
    typeof homeCity === "string" && homeCity.trim()
      ? homeCity.trim()
      : typeof listenerCity === "string" && listenerCity.trim()
        ? listenerCity.trim()
        : undefined;
  const briefWeather = await getBriefWeatherWithin(
    { homeCity: resolvedHomeCity, ipAddress: clientIp },
    WEATHER_LOOKUP_DEADLINE_MS,
  );
  const clientClock = resolveClientClock(requestHeaders);
  const resolvedListenerCity =
    resolvedHomeCity
    ?? (typeof listenerCity === "string" ? listenerCity : plan?.listenerCity);
  const broadcastContext = resolveAtmosphericBroadcastContext(new Date(), {
    timeZone: clientClock.timeZone ?? undefined,
    timeOfDay: clientClock.timeOfDay,
    location:
      briefWeather ? formatLocationForPrompt(briefWeather)
      : resolvedListenerCity?.trim() || undefined,
    weather: briefWeather ? formatWeatherForPrompt(briefWeather) : undefined,
  });

  const context: PromptBuilderContext = {
    track: {
      title: String(title),
      artist: String(artist),
      album: plan?.announceTracks.at(-1)?.album ?? (typeof album === "string" ? album : undefined),
    },
    personaId: typeof personaId === "string" ? (personaId as PersonaId) : undefined,
    customPersonaPrompt:
      typeof djPersonaPrompt === "string" ? djPersonaPrompt : undefined,
    maxDurationSeconds:
      plan?.maxDurationSeconds ??
      (typeof maxDurationInSeconds === "number" ? maxDurationInSeconds : 5),
    stationId: typeof stationId === "string" ? stationId : undefined,
    stationName: typeof stationName === "string" ? stationName : undefined,
    stationFrequency:
      typeof stationFrequency === "number" && Number.isFinite(stationFrequency)
        ? stationFrequency
        : undefined,
    isUserSavedStation: typeof stationId === "string" && isSavedStationId(stationId),
    eraLock: resolveEraLock(eraLock),
    vibePrompt: sanitizeVibePrompt(vibePrompt),
    voiceProfile: normalizeVoiceProfileOverride(voiceProfile),
    listenerCity: resolvedListenerCity,
    localEvent: (localEvent as LocalConcertEvent | undefined) ?? plan?.localEvent,
    segmentPlan: plan,
    albumContext: resolvedAlbum,
    talkLevel: resolvedTalkLevel,
    allowExplicit,
    commentaryFormat,
    excludedFacts: excludedFacts.length ? excludedFacts : undefined,
    recentHistory: parsedHistory.length ? parsedHistory : undefined,
    upcomingQueue: parsedUpcoming.length ? parsedUpcoming : undefined,
    previousTrack: parsedHistory.length
      ? parsedHistory[parsedHistory.length - 1]
      : undefined,
    hyperLocal: {
      timeOfDay: broadcastContext.timeOfDay,
      timezone: clientClock.timeZone ?? undefined,
      weatherSummary: broadcastContext.weather,
      localeLabel: broadcastContext.location,
    },
  };

  const { system: baseSystem, user: userPrompt } = buildDjScriptPrompt(context, {
    excludedFacts,
    broadcastContext,
  });
  const systemPrompt =
    baseSystem
    + personalityGuidance(resolvedPersonality)
    + knowledgeGuidance(resolvedKnowledge)
    + STRICT_TRUTH_GUARDRAIL
    + TTS_FORMATTING_RULES;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: SCRIPT_MAX_TOKENS,
      temperature: 0.92,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json({ error: `OpenAI error: ${error}` }, { status: 502 });
  }

  const data = await response.json();
  const rawScript = data.choices?.[0]?.message?.content?.trim();
  const script = rawScript
    ? truncateScriptForTts(formatScriptForTts(sanitizeDjScript(rawScript)))
    : "";

  if (!script) {
    return NextResponse.json({ error: "No script generated" }, { status: 502 });
  }

  logDjScriptTranscript(
    typeof personaId === "string" ? personaId : undefined,
    resolveScriptDjModeForTier(body.djMode, tier),
    script,
  );
  return NextResponse.json({ script });
}

/**
 * Meter Free-tier DJ breaks: reject when over quota, then increment only after
 * a successful *new* script generation (HTTP 2xx and not a lore cache hit).
 */
async function meterFreeTierBreakResponse(
  response: NextResponse,
  userId: string | null,
  tier: SubscriptionTier,
): Promise<NextResponse> {
  if (!response.ok || tier !== "free" || !userId) return response;

  let cachedHit = false;
  try {
    const clone = response.clone();
    const payload = (await clone.json()) as { cached?: unknown };
    cachedHit = payload.cached === true;
  } catch {
    cachedHit = false;
  }

  if (!cachedHit) {
    await incrementFreeTierBreakCount(userId, tier);
  }

  return response;
}

export async function POST(req: Request) {
  try {
    const clientIp = extractClientIp(req.headers);
    const rawBody = (await req.json()) as Record<string, unknown>;
    const { userId } = await auth();
    const tier = await resolveListenerTier(rawBody.tier);
    // Free tier: force SHORT BREAKS (`balanced` / `standard`) regardless of payload.
    const body = applyFreeTierPaceGuard(rawBody, tier);
    const isLorePath = isLoreCacheRequest(body);

    // Free-tier monthly break quota (30 / rolling 30 days).
    const quotaError = await enforceFreeTierBreakQuota(userId, tier);
    if (quotaError) return quotaError;

    // Validate required env vars before any LLM / TTS / storage work.
    const envError = requireEnvVars(
      isLorePath ? LORE_PIPELINE_ENV_VARS : LLM_ENV_VARS,
    );
    if (envError) return envError;

    if (isLorePath) {
      const response = await handleLoreCachePipeline(body, userId, tier);
      return meterFreeTierBreakResponse(response, userId, tier);
    }

    const response = await handleLegacyScriptGeneration(
      body,
      userId,
      tier,
      clientIp,
      req.headers,
    );
    return meterFreeTierBreakResponse(response, userId, tier);
  } catch (err) {
    console.error("[generate-script CRITICAL FAILURE]:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: errorMessage,
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 },
    );
  }
}
