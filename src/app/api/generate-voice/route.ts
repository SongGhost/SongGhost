import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import OpenAI from "openai";
import {
  DEFAULT_PERSONA,
  getPersonaById,
  ELEVENLABS_TTS_MODEL_ID,
  STANDARD_VOICE_SETTINGS,
  type DjPersona,
  type ElevenLabsVoiceSettings,
} from "@/data/personas";
import {
  resolveElevenLabsVoiceId as resolveHostElevenLabsVoiceId,
  resolveMilesOrDevonVoiceId,
} from "@/lib/dj/personaConfig";
import { voiceSettingsForPersonality } from "@/lib/dj/voice-settings";
import {
  assertOpenAiTtsInputLength,
  isOpenAiTtsInputTooLongError,
  OPENAI_TTS_MODEL,
  prepareTtsSynthesisText,
} from "@/lib/tts";
import type { DjPersonality } from "@/types/dj";
import {
  ELEVENLABS_VOICE_MAP,
  isVoiceOption,
  type LegacyOpenAiVoice,
  type VoiceOption,
} from "@/types/voice";
import type { TtsProvider } from "@/types/voice";

function isValidVoice(v: string): v is VoiceOption {
  return isVoiceOption(v);
}

/** Explicit Miles ElevenLabs voice — never shares a fallback with Devon or Johnny. */
const milesVoiceId =
  process.env.ELEVENLABS_VOICE_MILES || "gyIv9PAQRvJjSZlk68oE";

/** Explicit Devon ElevenLabs voice — never shares a fallback with Miles or Johnny. */
const devonVoiceId =
  process.env.ELEVENLABS_VOICE_DEVON || "2ajXGJNYBR0iNHpS4VZb";

/** Pro voice engines that Free-tier requests must demote to OpenAI. */
const PRO_VOICE_PROVIDERS = new Set<string>(["elevenlabs", "cartesia"]);

type SubscriptionTier = "free" | "pro";

type SpeechResult = {
  buffer: ArrayBuffer;
  /** Engine that actually produced the audio (may differ after degrade). */
  provider: TtsProvider;
};

function elevenLabsVoiceForOpenAi(voice: VoiceOption): string {
  if (voice in ELEVENLABS_VOICE_MAP) {
    return ELEVENLABS_VOICE_MAP[voice as LegacyOpenAiVoice];
  }
  return ELEVENLABS_VOICE_MAP.onyx;
}

/**
 * Resolve the ElevenLabs voice ID for a host via env-aware persona mapping.
 */
function resolveElevenLabsVoiceId(
  personaId: string | undefined,
  persona: DjPersona | undefined,
  synthesisVoice: VoiceOption,
): string {
  const key = personaId?.trim() || persona?.id;
  if (key) {
    const normalized = key.toLowerCase();
    if (normalized === "miles") return milesVoiceId;
    if (normalized === "devon" || normalized === "devon-pulse") {
      return devonVoiceId;
    }
    const isolated = resolveMilesOrDevonVoiceId(key);
    if (isolated) return isolated;
    const mapped = resolveHostElevenLabsVoiceId(key);
    if (mapped) return mapped;
  }

  return persona?.elevenLabsVoiceId ?? elevenLabsVoiceForOpenAi(synthesisVoice);
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
 * ElevenLabs → OpenAI fallback for a demoted Free-tier request.
 * Uses the persona's actual OpenAI `voice` field (all 13 are available to Free).
 */
function closestStandardVoice(
  persona: DjPersona | undefined,
  requestedVoice: VoiceOption,
): VoiceOption {
  if (persona?.voice && isValidVoice(persona.voice)) return persona.voice;
  return requestedVoice;
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

async function generateOpenAiSpeech(
  text: string,
  voice: VoiceOption,
  instructions?: string,
): Promise<ArrayBuffer> {
  assertOpenAiTtsInputLength(text);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const openai = new OpenAI({ apiKey });
  console.log("[generate-voice] OpenAI", OPENAI_TTS_MODEL, "for voice:", voice);
  const response = await openai.audio.speech.create({
    model: OPENAI_TTS_MODEL,
    voice,
    input: text,
    ...(instructions ? { instructions } : {}),
  });

  return response.arrayBuffer();
}

/**
 * ElevenLabs TTS — fail-closed. 400 / 402 / 429 (and any other engine fault)
 * must not degrade to Rachel, Antoni, or OpenAI `gpt-4o-mini-tts` (`onyx` / `alloy`)
 * while the UI still claims the requested host.
 */
async function generateElevenLabsSpeech(
  text: string,
  voiceId: string,
  voiceSettings: ElevenLabsVoiceSettings,
  personaId?: string,
): Promise<SpeechResult> {
  console.log("[Voice Resolution]", {
    personaId: personaId ?? "(unknown)",
    resolvedVoiceId: voiceId,
  });

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
    const failClosed =
      response.status === 400
      || response.status === 402
      || response.status === 429
      || /paid_plan_required/i.test(error);

    if (failClosed) {
      console.error(
        `[ElevenLabs] Fail-closed (${response.status}) — refusing Rachel/onyx fallback for persona:`,
        personaId ?? "(unknown)",
      );
    }

    throw new Error(`ElevenLabs error (${response.status}): ${error}`);
  }

  return { buffer: await response.arrayBuffer(), provider: "elevenlabs" };
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

    // Free-tier guard: Pro engines demote to OpenAI + the persona's OpenAI voice.
    if (tier !== "pro" && PRO_VOICE_PROVIDERS.has(selectedProvider)) {
      const fallbackVoice = closestStandardVoice(persona, resolvedVoice);
      console.warn(
        `[generate-voice] Free tier requested ${selectedProvider}; falling back to OpenAI ${OPENAI_TTS_MODEL} (${fallbackVoice}).`,
      );
      selectedProvider = "openai";
      synthesisVoice = fallbackVoice;
    }

    // Punctuation + SSML pause handling + trailing silence so voice decay is
    // not clipped. Both ElevenLabs and OpenAI `gpt-4o-mini-tts` receive SSML-free
    // copy — prepareTtsSynthesisText converts `<break>` tags into ellipsis
    // pacing cues and strips remaining XML (`<say-as>`, etc.).
    const synthesisProvider: TtsProvider =
      selectedProvider === "cartesia" ? "elevenlabs" : selectedProvider;
    const synthesisText = prepareTtsSynthesisText(text, synthesisProvider);

    let audioBuffer: ArrayBuffer;
    let responseProvider: TtsProvider | "cartesia" = selectedProvider;

    if (selectedProvider === "elevenlabs" || selectedProvider === "cartesia") {
      // Hosts resolve via env-aware persona voice map (see src/config/elevenlabs-voices.ts).
      // Personality (when supplied) overrides roster calibration for expressive pacing.
      // Cartesia streaming is Phase 2+; Free already demoted above. Pro without a
      // wired Cartesia path falls through to ElevenLabs so audio still returns.
      const elevenLabsVoiceId = resolveElevenLabsVoiceId(
        personaId,
        persona,
        synthesisVoice,
      );
      const result = await generateElevenLabsSpeech(
        synthesisText,
        elevenLabsVoiceId,
        elevenLabsVoiceSettings,
        typeof personaId === "string" ? personaId : persona?.id,
      );
      audioBuffer = result.buffer;
      responseProvider = result.provider;
    } else {
      audioBuffer = await generateOpenAiSpeech(synthesisText, synthesisVoice);
    }

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "X-SongHost-Voice-Provider": responseProvider,
        "X-SongHost-Tier": tier,
      },
    });
  } catch (error) {
    console.error("generate-voice error:", error);
    if (isOpenAiTtsInputTooLongError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to generate voice" }, { status: 500 });
  }
}
