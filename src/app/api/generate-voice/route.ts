import { NextResponse } from "next/server";
import OpenAI from "openai";
import { DEFAULT_PERSONA, getPersonaById } from "@/data/personas";
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

async function generateElevenLabsSpeech(text: string, voice: VoiceOption): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured");
  }

  const voiceId = ELEVENLABS_VOICE_MAP[voice];

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.55,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
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
      audioBuffer = await generateElevenLabsSpeech(text, resolvedVoice);
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
