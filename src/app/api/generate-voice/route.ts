import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  DEFAULT_PERSONA,
  getPersonaById,
  resolvePremadeFallbackVoiceId,
  ELEVENLABS_TTS_MODEL_ID,
  STANDARD_VOICE_SETTINGS,
  type ElevenLabsVoiceSettings,
} from "@/data/personas";
import { ELEVENLABS_VOICE_MAP, type VoiceOption } from "@/types/voice";
import type { TtsProvider } from "@/types/voice";

const OPENAI_VOICES: VoiceOption[] = ["onyx", "fable", "nova", "alloy", "echo", "shimmer"];

function isValidVoice(v: string): v is VoiceOption {
  return OPENAI_VOICES.includes(v as VoiceOption);
}

async function generateOpenAiSpeech(text: string, voice: VoiceOption): Promise<ArrayBuffer> {
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

  return response.arrayBuffer();
}

async function generateElevenLabsSpeech(
  text: string,
  voiceId: string,
  voiceSettings: ElevenLabsVoiceSettings,
  allowFallback = true,
): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured");
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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
  });

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
        return generateElevenLabsSpeech(text, fallbackVoiceId, voiceSettings, false);
      }
    }

    throw new Error(`ElevenLabs error: ${error}`);
  }

  return response.arrayBuffer();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, voice, personaId, provider = "openai" } = body as {
      text: string;
      voice?: string;
      personaId?: string;
      provider?: TtsProvider;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const persona = typeof personaId === "string" ? getPersonaById(personaId) : undefined;
    const resolvedVoice: VoiceOption =
      persona?.voice ?? (voice && isValidVoice(voice) ? voice : DEFAULT_PERSONA.voice);
    const selectedProvider: TtsProvider = provider === "elevenlabs" ? "elevenlabs" : "openai";

    let audioBuffer: ArrayBuffer;

    if (selectedProvider === "elevenlabs") {
      // Hosts carry their own ElevenLabs voice; the fallback map only serves voice
      // previews, which pass a bare VoiceOption and no persona.
      audioBuffer = await generateElevenLabsSpeech(
        text,
        persona?.elevenLabsVoiceId ?? ELEVENLABS_VOICE_MAP[resolvedVoice],
        persona?.voiceSettings ?? STANDARD_VOICE_SETTINGS,
      );
    } else {
      audioBuffer = await generateOpenAiSpeech(text, resolvedVoice);
    }

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
      },
    });
  } catch (error) {
    console.error("generate-voice error:", error);
    return NextResponse.json({ error: "Failed to generate voice" }, { status: 500 });
  }
}
