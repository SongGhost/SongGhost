import { createReadStream, existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ELEVENLABS_TTS_MODEL_ID,
  getPersonaById,
  isPersonaId,
  resolvePremadeFallbackVoiceId,
  STANDARD_VOICE_SETTINGS,
  type ElevenLabsVoiceSettings,
} from "@/data/personas";
import { getVoicePreviewScript } from "@/lib/dj/personaConfig";
import { prepareTtsSynthesisText } from "@/lib/tts";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Content-Type": "audio/mpeg",
} as const;

/** Deduplicate concurrent TTS synthesis for the same persona. */
const inflightSynthesis = new Map<string, Promise<Buffer>>();

function previewFilePath(personaId: string): string {
  return path.join(process.cwd(), "public", "audio", "previews", `${personaId}.mp3`);
}

function streamCachedFile(filePath: string): Response {
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, { headers: CACHE_HEADERS });
}

async function generateOpenAiSpeech(text: string, voice: "onyx" | "alloy" | "echo" | "nova" | "fable" | "shimmer"): Promise<Buffer> {
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
  allowFallback = true,
): Promise<Buffer> {
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
            false,
          );
        }
      }

      throw new Error(`ElevenLabs error (${response.status}): ${error}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.warn(
      "[voice-preview] ElevenLabs TTS failed; falling back to OpenAI tts-1:",
      err,
    );
    return generateOpenAiSpeech(text, "onyx");
  }
}

async function synthesizeAndCache(personaId: string): Promise<Buffer> {
  const existing = inflightSynthesis.get(personaId);
  if (existing) return existing;

  const task = (async () => {
    const persona = getPersonaById(personaId);
    if (!persona) {
      throw new Error(`Unknown persona: ${personaId}`);
    }

    const script = getVoicePreviewScript(persona.id, persona.name);
    const synthesisText = prepareTtsSynthesisText(script, "elevenlabs");
    const buffer = await generateElevenLabsSpeech(
      synthesisText,
      persona.elevenLabsVoiceId,
      persona.voiceSettings ?? STANDARD_VOICE_SETTINGS,
    );

    const filePath = previewFilePath(persona.id);
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, buffer);
    } catch (err) {
      // Serverless / read-only FS: still return audio even if disk cache fails.
      console.warn("[voice-preview] Failed to write disk cache:", err);
    }

    return buffer;
  })();

  inflightSynthesis.set(personaId, task);
  try {
    return await task;
  } finally {
    inflightSynthesis.delete(personaId);
  }
}

/**
 * GET /api/studio/voice-preview?personaId=miles
 *
 * Serves a long-lived cached MP3 audition for a host persona. Prefers a static
 * file under `public/audio/previews/`, otherwise synthesizes once via ElevenLabs
 * (OpenAI fallback) and writes the result for subsequent hits.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPersonaId = searchParams.get("personaId")?.trim() ?? "";

    if (!rawPersonaId || !isPersonaId(rawPersonaId)) {
      return NextResponse.json(
        {
          error:
            "Invalid personaId. Expected a valid host persona (e.g. miles, sloane-vance, kira-nova).",
        },
        { status: 400 },
      );
    }

    const personaId = rawPersonaId;
    const filePath = previewFilePath(personaId);

    if (existsSync(filePath)) {
      return streamCachedFile(filePath);
    }

    const buffer = await synthesizeAndCache(personaId);

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
