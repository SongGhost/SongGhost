import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import OpenAI from "openai";
import {
  DEFAULT_PERSONA,
  getPersonaById,
  resolvePremadeFallbackVoiceId,
  ELEVENLABS_TTS_MODEL_ID,
  STANDARD_VOICE_SETTINGS,
  type DjPersona,
  type ElevenLabsVoiceSettings,
} from "@/data/personas";
import { voiceSettingsForPersonality } from "@/lib/dj/voice-settings";
import { prepareTtsSynthesisText } from "@/lib/tts";
import type { DjPersonality } from "@/types/dj";
import { ELEVENLABS_VOICE_MAP, type VoiceOption } from "@/types/voice";
import type { TtsProvider } from "@/types/voice";

const OPENAI_VOICES: VoiceOption[] = ["onyx", "fable", "nova", "alloy", "echo", "shimmer"];

/** Pro voice engines that Free-tier requests must demote to OpenAI. */
const PRO_VOICE_PROVIDERS = new Set<string>(["elevenlabs", "cartesia"]);

type SubscriptionTier = "free" | "pro";

function isValidVoice(v: string): v is VoiceOption {
  return OPENAI_VOICES.includes(v as VoiceOption);
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

function resolveDjPersonality(value: unknown): DjPersonality | undefined {
  if (value === "obnoxious") return "funny";
  if (value === "elitist") return "sarcastic";
  if (value === "neutral") return "normal";
  return isDjPersonality(value) ? value : undefined;
}

function coerceTier(raw: unknown): SubscriptionTier {
  if (typeof raw !== "string") return "free";
  return raw.trim().toLowerCase() === "pro" ? "pro" : "free";
}

/**
 * Closest OpenAI STANDARD voice for a Pro host on Free tier.
 * Onyx = deep male, Echo = neutral, Alloy = female.
 */
function closestStandardVoice(
  persona: DjPersona | undefined,
  requestedVoice: VoiceOption,
): VoiceOption {
  if (persona?.gender === "female") return "alloy";
  if (
    requestedVoice === "alloy"
    || requestedVoice === "nova"
    || requestedVoice === "shimmer"
  ) {
    return "alloy";
  }
  if (persona?.voice === "onyx" || requestedVoice === "onyx") return "onyx";
  return "echo";
}

async function resolveRequestTier(
  bodyTier: unknown,
): Promise<SubscriptionTier> {
  // Explicit client/dev override (DevTierToggle) wins when present.
  if (bodyTier != null) return coerceTier(bodyTier);

  try {
    const user = await currentUser();
    if (user?.unsafeMetadata?.tier != null) {
      return coerceTier(user.unsafeMetadata.tier);
    }
  } catch (err) {
    console.warn("[generate-voice] Clerk auth unavailable for tier check", err);
  }

  return "free";
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
    const {
      text,
      voice,
      personaId,
      provider = "openai",
      personality,
      tier: bodyTier,
    } = body as {
      text: string;
      voice?: string;
      personaId?: string;
      provider?: TtsProvider | "cartesia";
      /** Tuning Console narrative tone → dynamic ElevenLabs voice_settings. */
      personality?: DjPersonality | string;
      /** Client / DevTierToggle hint — reconciled with Clerk when omitted. */
      tier?: string;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const persona = typeof personaId === "string" ? getPersonaById(personaId) : undefined;
    // Explicit `voice` wins (Free STANDARD picks); otherwise the host's mapped voice.
    const resolvedVoice: VoiceOption =
      (voice && isValidVoice(voice) ? voice : undefined)
      ?? persona?.voice
      ?? DEFAULT_PERSONA.voice;
    const resolvedPersonality = resolveDjPersonality(personality);
    const elevenLabsVoiceSettings: ElevenLabsVoiceSettings = resolvedPersonality
      ? voiceSettingsForPersonality(resolvedPersonality)
      : (persona?.voiceSettings ?? STANDARD_VOICE_SETTINGS);

    const tier = await resolveRequestTier(bodyTier);
    let selectedProvider: TtsProvider | "cartesia" =
      provider === "elevenlabs" || provider === "cartesia" ? provider : "openai";
    let synthesisVoice = resolvedVoice;

    // Free-tier guard: Pro engines demote to OpenAI tts-1 + closest STANDARD voice.
    if (tier !== "pro" && PRO_VOICE_PROVIDERS.has(selectedProvider)) {
      const fallbackVoice = closestStandardVoice(persona, resolvedVoice);
      console.warn(
        `[generate-voice] Free tier requested ${selectedProvider}; falling back to OpenAI tts-1 (${fallbackVoice}).`,
      );
      selectedProvider = "openai";
      synthesisVoice = fallbackVoice;
    }

    // Punctuation + trailing pause padding so voice decay is not clipped.
    const synthesisProvider: TtsProvider =
      selectedProvider === "cartesia" ? "elevenlabs" : selectedProvider;
    const synthesisText = prepareTtsSynthesisText(text, synthesisProvider);

    let audioBuffer: ArrayBuffer;

    if (selectedProvider === "elevenlabs") {
      // Hosts carry their own ElevenLabs voice; the fallback map only serves voice
      // previews, which pass a bare VoiceOption and no persona.
      // Personality (when supplied) overrides roster calibration for expressive pacing.
      audioBuffer = await generateElevenLabsSpeech(
        synthesisText,
        persona?.elevenLabsVoiceId ?? ELEVENLABS_VOICE_MAP[synthesisVoice],
        elevenLabsVoiceSettings,
      );
    } else if (selectedProvider === "cartesia") {
      // Cartesia streaming is Phase 2+; Free already demoted above. Pro without a
      // wired Cartesia path falls through to ElevenLabs so audio still returns.
      audioBuffer = await generateElevenLabsSpeech(
        synthesisText,
        persona?.elevenLabsVoiceId ?? ELEVENLABS_VOICE_MAP[synthesisVoice],
        elevenLabsVoiceSettings,
      );
    } else {
      audioBuffer = await generateOpenAiSpeech(synthesisText, synthesisVoice);
    }

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "X-SongHost-Voice-Provider": selectedProvider === "openai" ? "openai" : selectedProvider,
        "X-SongHost-Tier": tier,
      },
    });
  } catch (error) {
    console.error("generate-voice error:", error);
    return NextResponse.json({ error: "Failed to generate voice" }, { status: 500 });
  }
}
