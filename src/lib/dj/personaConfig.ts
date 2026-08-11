/**
 * Shared host-persona helpers for Studio voice previews, voice ID resolution,
 * station auto-assignment, and related copy.
 */

import { getPersonaById } from "@/data/personas";
import { resolveElevenLabsVoiceId } from "@/config/elevenlabs-voices";
import { HOST_PERSONA_AFFINITY } from "@/config/host-persona-affinity";
import { VOICE_OPTIONS, type VoiceOption } from "@/types/voice";

export {
  ELEVENLABS_HOST_VOICE_DEFAULTS,
  getPersonaElevenLabsVoiceMap,
  resolveElevenLabsVoiceId,
  resolveHostElevenLabsVoiceId,
  type HostVoiceKey,
} from "@/config/elevenlabs-voices";

export {
  HOST_PERSONA_AFFINITY,
  type HostPersonaAffinity,
  type AffinityPersonaId,
} from "@/config/host-persona-affinity";

export {
  getPersonaForStation,
  resolveDjForStation,
  resolveDjForQuery,
  resolveDjIdForQuery,
  type StationPersonaInput,
} from "@/lib/dj-resolver";

/** Free / OpenAI STANDARD voices — identity-mapped TTS targets (no remapping). */
export const OPENAI_HOST_VOICES = [
  "alloy",
  "echo",
  "onyx",
  "fable",
  "nova",
  "shimmer",
] as const satisfies readonly VoiceOption[];

export type OpenAiHostVoice = (typeof OPENAI_HOST_VOICES)[number];

export function isOpenAiHostVoice(id: string): id is OpenAiHostVoice {
  return (OPENAI_HOST_VOICES as readonly string[]).includes(
    id.trim().toLowerCase(),
  );
}

/**
 * Resolve a free/OpenAI voice key to its OpenAI TTS voice string.
 * Returns the voice itself — never remaps to a different fallback.
 */
export function resolveOpenAiVoiceId(voiceKey: string): VoiceOption | undefined {
  const key = voiceKey.trim().toLowerCase();
  if (!isOpenAiHostVoice(key)) return undefined;
  return key;
}

export type VoicePreviewTarget =
  | {
      provider: "elevenlabs";
      /** Cache / query key (persona id). */
      previewKey: string;
      voiceId: string;
      displayName: string;
      /** OpenAI voice used only if ElevenLabs synthesis fails. */
      openaiFallbackVoice: VoiceOption;
    }
  | {
      provider: "openai";
      previewKey: string;
      voiceId: VoiceOption;
      displayName: string;
    };

function openAiDisplayName(voice: VoiceOption): string {
  return VOICE_OPTIONS.find((v) => v.id === voice)?.label ?? voice;
}

/**
 * Resolve a Studio audition id to a concrete TTS target.
 * Accepts Pro persona ids (`miles`, `kira-nova`, …) or OpenAI voice ids
 * (`alloy`, `echo`, `onyx`, …).
 */
export function resolveVoicePreviewTarget(
  rawId: string,
): VoicePreviewTarget | null {
  const id = rawId.trim().toLowerCase();
  if (!id) return null;

  const openAiVoice = resolveOpenAiVoiceId(id);
  if (openAiVoice) {
    return {
      provider: "openai",
      previewKey: openAiVoice,
      voiceId: openAiVoice,
      displayName: openAiDisplayName(openAiVoice),
    };
  }

  const persona = getPersonaById(id);
  if (!persona) return null;

  const voiceId =
    resolveElevenLabsVoiceId(persona.id) ?? persona.elevenLabsVoiceId;

  return {
    provider: "elevenlabs",
    previewKey: persona.id,
    voiceId,
    displayName: persona.name,
    openaiFallbackVoice: persona.voice,
  };
}

/**
 * Resolve a live session voice target for orchestrator / generate-voice paths.
 * ElevenLabs host keys win; OpenAI STANDARD voice ids map to themselves.
 */
export function resolveSessionVoiceId(
  personaOrVoiceKey: string,
): string | undefined {
  const key = personaOrVoiceKey.trim();
  if (!key) return undefined;

  const eleven = resolveElevenLabsVoiceId(key);
  if (eleven) return eleven;

  const persona = getPersonaById(key);
  if (persona) {
    return (
      resolveElevenLabsVoiceId(persona.id)
      ?? persona.elevenLabsVoiceId
      ?? resolveOpenAiVoiceId(persona.voice)
    );
  }

  return resolveOpenAiVoiceId(key);
}

/**
 * Canonical audition script for a host voice sample.
 * `personaId` is reserved for future per-host script variants.
 */
export function getVoicePreviewScript(personaId: string, hostName: string): string {
  void personaId;
  return (
    "You're locked into SongHost. I'm "
    + hostName
    + ", keeping your station flowing with live breaks, local weather, and hand-picked tracks. Let me take the wheel."
  );
}

/** Specialty blurb for a host — from the affinity table when known. */
export function getHostPrimarySpecialty(personaId: string): string | undefined {
  const key = personaId.trim().toLowerCase();
  if (key in HOST_PERSONA_AFFINITY) {
    return HOST_PERSONA_AFFINITY[key as keyof typeof HOST_PERSONA_AFFINITY].primary;
  }
  const persona = getPersonaById(key);
  return persona?.defaultGenre;
}
