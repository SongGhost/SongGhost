import { createReadStream, existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ELEVENLABS_TTS_MODEL_ID,
  resolvePremadeFallbackVoiceId,
  STANDARD_VOICE_SETTINGS,
  type ElevenLabsVoiceSettings,
} from "@/data/personas";
import {
  getVoicePreviewScript,
  resolveMilesOrDevonVoiceId,
  resolveVoicePreviewTarget,
  type VoicePreviewTarget,
} from "@/lib/dj/personaConfig";
import { prepareTtsSynthesisText } from "@/lib/tts";
import type { VoiceOption } from "@/types/voice";

export const dynamic = "force-dynamic";

/** Explicit Miles ElevenLabs voice — never shares a fallback with Devon or Johnny. */
const milesVoiceId =
  process.env.ELEVENLABS_VOICE_MILES || "gyIv9PAQRvJjSZlk68oE";

/** Explicit Devon ElevenLabs voice — never shares a fallback with Miles or Johnny. */
const devonVoiceId =
  process.env.ELEVENLABS_VOICE_DEVON || "2ajXGJNYBR0iNHpS4VZb";

/**
 * Strict preview mapping for Miles / Devon so they cannot collapse to one ID.
 */
function enforceIsolatedPreviewVoiceId(
  personaId: string,
  resolvedVoiceId: string,
): string {
  const key = personaId.trim().toLowerCase();
  if (key === "miles") return milesVoiceId;
  if (key === "devon" || key === "devon-pulse") return devonVoiceId;
  return resolveMilesOrDevonVoiceId(key) ?? resolvedVoiceId;
}

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Content-Type": "audio/mpeg",
} as const;

/** Deduplicate concurrent TTS synthesis for the same preview key. */
const inflightSynthesis = new Map<string, Promise<Buffer>>();

function previewFilePath(previewKey: string): string {
  return path.join(process.cwd(), "public", "audio", "previews", `${previewKey}.mp3`);
}

function streamCachedFile(filePath: string): Response {
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, { headers: CACHE_HEADERS });
}

async function generateOpenAiSpeech(text: string, voice: VoiceOption): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
  });

  return Buffer.from(await response.arrayBuffer());
}

async function generateElevenLabsSpeech(
  text: string,
  voiceId: string,
  voiceSettings: ElevenLabsVoiceSettings,
  openaiFallbackVoice: VoiceOption,
  allowFallback = true,
  personaId?: string,
): Promise<Buffer> {
  console.log("[Voice Resolution]", {
    personaId: personaId ?? "(unknown)",
    resolvedVoiceId: voiceId,
  });

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ElevenLabs API key not configured");
    }

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
          voice_settings: voiceSettings,
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
            "[voice-preview] Library voice restricted. Retrying with premade fallback...",
          );
          return generateElevenLabsSpeech(
            text,
            fallbackVoiceId,
            voiceSettings,
            openaiFallbackVoice,
            false,
            personaId,
          );
        }
      }

      throw new Error(`ElevenLabs error (${response.status}): ${error}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.warn(
      `[voice-preview] ElevenLabs TTS failed; falling back to OpenAI tts-1 (${openaiFallbackVoice}):`,
      err,
    );
    const openaiText = prepareTtsSynthesisText(text, "openai");
    return generateOpenAiSpeech(openaiText, openaiFallbackVoice);
  }
}

async function synthesizePreviewTarget(target: VoicePreviewTarget): Promise<Buffer> {
  const script = getVoicePreviewScript(target.previewKey, target.displayName);

  if (target.provider === "openai") {
    const synthesisText = prepareTtsSynthesisText(script, "openai");
    return generateOpenAiSpeech(synthesisText, target.voiceId);
  }

  const isolatedVoiceId = enforceIsolatedPreviewVoiceId(
    target.previewKey,
    target.voiceId,
  );
  const synthesisText = prepareTtsSynthesisText(script, "elevenlabs");
  return generateElevenLabsSpeech(
    synthesisText,
    isolatedVoiceId,
    STANDARD_VOICE_SETTINGS,
    target.openaiFallbackVoice,
    true,
    target.previewKey,
  );
}

async function synthesizeAndCache(target: VoicePreviewTarget): Promise<Buffer> {
  const cacheKey = target.previewKey;
  const existing = inflightSynthesis.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    const buffer = await synthesizePreviewTarget(target);

    const filePath = previewFilePath(cacheKey);
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);
    } catch (err) {
      // Serverless / read-only FS: still return audio even if disk cache fails.
      console.warn("[voice-preview] Failed to write disk cache:", err);
    }

    return buffer;
  })();

  inflightSynthesis.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflightSynthesis.delete(cacheKey);
  }
}

/**
 * GET /api/studio/voice-preview?personaId=miles
 * GET /api/studio/voice-preview?personaId=onyx
 *
 * Serves a long-lived cached MP3 audition. Prefers a static file under
 * `public/audio/previews/`, otherwise synthesizes via ElevenLabs (Pro hosts)
 * or OpenAI TTS (free STANDARD voices) and caches the result when possible.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPersonaId = searchParams.get("personaId")?.trim() ?? "";

    const target = resolveVoicePreviewTarget(rawPersonaId);
    if (!target) {
      return NextResponse.json(
        {
          error:
            "Invalid personaId. Expected a host persona (e.g. miles, sloane-vance) or OpenAI voice (e.g. onyx, alloy, echo).",
        },
        { status: 400 },
      );
    }

    const filePath = previewFilePath(target.previewKey);

    if (existsSync(filePath)) {
      return streamCachedFile(filePath);
    }

    const buffer = await synthesizeAndCache(target);

    // Prefer streaming the freshly written file when available.
    if (existsSync(filePath)) {
      return streamCachedFile(filePath);
    }

    return new Response(new Uint8Array(buffer), {
      headers: {
        ...CACHE_HEADERS,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (error) {
    console.error("[voice-preview] error:", error);
    return NextResponse.json(
      { error: "Failed to generate voice preview" },
      { status: 500 },
    );
  }
}
