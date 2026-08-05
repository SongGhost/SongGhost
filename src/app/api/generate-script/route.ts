import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  type PromptBuilderContext,
} from "@/lib/dj/promptBuilder";
import { formatScriptForTts, sanitizeDjScript } from "@/lib/dj-script";
import { isSavedStationId } from "@/lib/saved-stations";
import { db, cachedLoreBreaks } from "@/lib/db";
import { uploadLoreAudioBuffer } from "@/lib/storage/r2";
import {
  DEFAULT_PERSONA,
  ELEVENLABS_TTS_MODEL_ID,
  PERSONAS,
  STANDARD_VOICE_SETTINGS,
  getPersonaById,
  resolvePremadeFallbackVoiceId,
} from "@/data/personas";
import type { PersonaId } from "@/data/personas";
import type { DjSegmentPlan, LocalConcertEvent } from "@/types/dj";
import {
  normalizeAlbumContext,
  normalizeVoiceProfileOverride,
  resolveChatterPacing,
  resolveEraLock,
  sanitizeVibePrompt,
  type StationMode,
} from "@/types/station";

/** Hard ceiling so the model cannot emit lecture-length DJ copy. */
const SCRIPT_MAX_TOKENS = 100;

/** TTS clips mid-sentence when scripts run long — keep under this char budget. */
const TTS_SCRIPT_MAX_CHARS = 280;

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

type LoreTrackRef = {
  title: string;
  artist: string;
};

type LoreCachePayload = {
  trackId: string;
  /** Explicit ElevenLabs voice — optional when `personaId` is supplied. */
  voiceId?: string;
  /**
   * UI host id (`sloane-vance` | `johnny-static` | `devon-pulse` |
   * `kira-nova` | `jasper-reed`). Preferred over a bare voiceId so the
   * route owns the roster → high-fidelity voice mapping.
   */
  personaId?: string;
  artist?: string;
  title?: string;
  album?: string;
  mode?: StationMode | string;
  recentHistory?: LoreTrackRef[];
  upcomingQueue?: LoreTrackRef[];
};

/**
 * Full UI persona roster → ElevenLabs voice IDs (env overrides with premade fallbacks).
 * Kept explicit so the lore pipeline never silently collapses hosts.
 */
const PERSONA_VOICE_MAP: Record<string, string> = {
  "sloane-vance":
    process.env.ELEVENLABS_VOICE_SLOANE || "21m00Tcm4TlvDq8ikWAM",
  "johnny-static":
    process.env.ELEVENLABS_VOICE_JOHNNY || "pNInz6obpgDQGcFmaJgB",
  "devon-pulse":
    process.env.ELEVENLABS_VOICE_DEVON || "2EiwWnXFnvU5JabPnv8n",
  "kira-nova": process.env.ELEVENLABS_VOICE_KIRA || "EXAVITQu4vr4xnSDxMaL",
  "jasper-reed":
    process.env.ELEVENLABS_VOICE_JASPER || "VR6AewLTigWG4xSOukaG",
};

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
 * caller-supplied voiceId / default Johnny Static voice is used.
 */
function resolveLoreVoiceId(body: LoreCachePayload): {
  voiceId: string;
  personaId?: PersonaId;
} {
  if (typeof body.personaId === "string" && body.personaId.trim()) {
    const persona = getPersonaById(body.personaId.trim());
    if (persona) {
      return {
        voiceId: PERSONA_VOICE_MAP[persona.id] ?? persona.elevenLabsVoiceId,
        personaId: persona.id,
      };
    }
  }

  if (typeof body.voiceId === "string" && body.voiceId.trim()) {
    return { voiceId: body.voiceId.trim() };
  }

  return {
    voiceId: DEFAULT_PERSONA.elevenLabsVoiceId,
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
  recentHistory?: LoreTrackRef[];
  upcomingQueue?: LoreTrackRef[];
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const isAlbumDive = input.mode === "album_deep_dive";
  const albumLine = input.album ? ` Album: ${input.album}.` : "";
  const recentHistory = input.recentHistory ?? [];
  const upcomingQueue = input.upcomingQueue ?? [];
  const hasHistory = recentHistory.length > 0;
  const hasUpcoming = upcomingQueue.length > 0;

  const systemPrompt =
    "You are a broadcast radio DJ delivering a short music-lore break." +
    " Write natural spoken radio patter — never trivia-setup phrases like 'fun fact' or 'did you know'." +
    " Hard cap: 20 to 35 words, 1 to 2 punchy sentences." +
    " Never invent producers, studios, chart positions, or gear you are not sure about." +
    " recentHistory contains songs that ALREADY FINISHED playing — only those may be framed as 'you just heard' / 'that was'." +
    " currentTrack is the song STARTING RIGHT NOW — introduce it as starting or playing now, NEVER as 'you just heard'." +
    (isAlbumDive
      ? " This is an album deep dive — one specific lore angle about this track on the record."
      : " Share one vivid, verified-feeling lore nugget about the song or artist.") +
    (hasHistory || hasUpcoming
      ? " When history or upcoming queue data is provided, naturally weave a brief multi-song recap"
        + ' (e.g. "That was Song A into Song B...") and/or an upcoming teaser'
        + ' (e.g. "Coming up next we have Song C...") alongside the trivia —'
        + " keep it conversational, not a playlist read."
      : "");

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
  contextLines.push("Write the on-air lore break now.");

  const userPrompt = contextLines.join(" ");

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
    throw new Error(`OpenAI error: ${error}`);
  }

  const data = await response.json();
  const rawScript = data.choices?.[0]?.message?.content?.trim();
  const script = rawScript
    ? truncateScriptForTts(formatScriptForTts(sanitizeDjScript(rawScript)))
    : "";

  if (!script) {
    throw new Error("No script generated");
  }

  return script;
}

async function synthesizeElevenLabsSpeech(
  text: string,
  voiceId: string,
  allowFallback = true,
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured");
  }

  console.log("[ElevenLabs] Requesting TTS for voiceId:", voiceId);

  const response = await fetch(
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
        voice_settings: STANDARD_VOICE_SETTINGS,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    const isLibraryVoiceRestricted =
      response.status === 400
      || response.status === 402
      || /paid_plan_required/i.test(error);

    if (isLibraryVoiceRestricted && allowFallback) {
      const fallbackVoiceId = resolvePremadeFallbackVoiceId(voiceId);
      if (fallbackVoiceId !== voiceId) {
        console.warn(
          "[ElevenLabs] Library voice restricted on free tier. Retrying with default premade voice...",
        );
        return synthesizeElevenLabsSpeech(text, fallbackVoiceId, false);
      }
    }

    throw new Error(`ElevenLabs error: ${error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Phase 5 check-cache-first lore pipeline:
 * cache hit → return CDN audio; miss → LLM → ElevenLabs → R2 → DB → return.
 */
async function handleLoreCachePipeline(body: LoreCachePayload) {
  const { trackId } = body;
  const { voiceId, personaId } = resolveLoreVoiceId(body);
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Unknown Track";
  const artist =
    typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : "Unknown Artist";
  const album = typeof body.album === "string" && body.album.trim() ? body.album.trim() : undefined;
  const mode = typeof body.mode === "string" ? body.mode : undefined;
  const recentHistory = parseLoreTrackRefs(body.recentHistory, 5);
  const upcomingQueue = parseLoreTrackRefs(body.upcomingQueue, 2);
  // History/queue-aware scripts are session-specific — never reuse a bare
  // trackId+voiceId cache hit that would drop the recap/teaser context.
  const contextAware = recentHistory.length > 0 || upcomingQueue.length > 0;

  console.log("[generate-script] Lore voice resolved", {
    trackId,
    personaId: personaId ?? null,
    voiceId,
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
      return NextResponse.json({
        audioUrl: cached.audioUrl,
        script: cached.scriptText,
        cached: true,
        cost: 0,
      });
    }
  }

  const script = await generateLoreScript({
    artist,
    title,
    album,
    mode,
    recentHistory,
    upcomingQueue,
  });
  const audioBuffer = await synthesizeElevenLabsSpeech(script, voiceId);
  const key = `lore/${trackId}-${voiceId}.mp3`;
  const audioUrl = await uploadLoreAudioBuffer(key, audioBuffer);
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

  return NextResponse.json({
    audioUrl,
    script,
    cached: false,
  });
}

/** Legacy DJ script path used by `generateDjBreak` (script-only, no TTS/cache). */
async function handleLegacyScriptGeneration(body: Record<string, unknown>) {
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
    localEvent,
    album,
    albumContext,
    talkLevel,
    chatterPacing,
    recentHistory,
    upcomingQueue,
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

  const resolvedTalkLevel = resolveChatterPacing(talkLevel ?? chatterPacing);
  const resolvedAlbum = normalizeAlbumContext(albumContext) ?? undefined;
  const parsedHistory = parseLoreTrackRefs(recentHistory, 5);
  const parsedUpcoming = parseLoreTrackRefs(upcomingQueue, 2);

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
    listenerCity: typeof listenerCity === "string" ? listenerCity : plan?.listenerCity,
    localEvent: (localEvent as LocalConcertEvent | undefined) ?? plan?.localEvent,
    segmentPlan: plan,
    albumContext: resolvedAlbum,
    talkLevel: resolvedTalkLevel,
    recentHistory: parsedHistory.length ? parsedHistory : undefined,
    upcomingQueue: parsedUpcoming.length ? parsedUpcoming : undefined,
    previousTrack: parsedHistory.length
      ? parsedHistory[parsedHistory.length - 1]
      : undefined,
  };

  const systemPrompt = buildSystemPrompt(context);
  const userPrompt = buildUserPrompt(context);

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

  return NextResponse.json({ script });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (isLoreCacheRequest(body)) {
      return await handleLoreCachePipeline(body);
    }

    return await handleLegacyScriptGeneration(body);
  } catch (error) {
    console.error("generate-script error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate script";
    if (message.includes("not configured") || message.includes("OpenAI") || message.includes("ElevenLabs")) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ error: "Failed to generate script" }, { status: 500 });
  }
}
