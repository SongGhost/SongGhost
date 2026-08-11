/**
 * Shared host-persona helpers for Studio voice previews, voice ID resolution,
 * station auto-assignment, and related copy.
 */

import { getPersonaById } from "@/data/personas";
import { resolveElevenLabsVoiceId } from "@/config/elevenlabs-voices";
import { HOST_PERSONA_AFFINITY } from "@/config/host-persona-affinity";
import { VOICE_OPTIONS, type VoiceOption } from "@/types/voice";

/** Explicit Miles ElevenLabs voice — never shares a fallback with Devon or Johnny. */
const milesVoiceId =
  process.env.ELEVENLABS_VOICE_MILES || "gyIv9PAQRvJjSZlk68oE";

/** Explicit Devon ElevenLabs voice — never shares a fallback with Miles or Johnny. */
const devonVoiceId =
  process.env.ELEVENLABS_VOICE_DEVON || "2ajXGJNYBR0iNHpS4VZb";

export {
  ELEVENLABS_HOST_VOICE_DEFAULTS,
  getPersonaElevenLabsVoiceMap,
  resolveElevenLabsVoiceId,
  resolveHostElevenLabsVoiceId,
  type HostVoiceKey,
} from "@/config/elevenlabs-voices";

/**
 * Strict Miles / Devon voice isolation. Returns undefined for all other hosts
 * so the shared map can resolve them. Never chains to ELEVENLABS_VOICE_JOHNNY.
 */
export function resolveMilesOrDevonVoiceId(
  personaId: string,
): string | undefined {
  const key = personaId.trim().toLowerCase();
  if (key === "miles") return milesVoiceId;
  if (key === "devon" || key === "devon-pulse") return devonVoiceId;
  return undefined;
}

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
      /** Query / persona key (persona id). */
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

/**
 * Sanitize a voice id for use in on-disk preview cache filenames.
 * ElevenLabs ids are typically alphanumeric; strip path separators / odd chars.
 */
export function sanitizeVoicePreviewVoiceId(voiceId: string): string {
  return voiceId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Disk cache basename for a voice preview: `${personaId}-${voiceId}`.
 * A cached MP3 is valid only when BOTH persona and active voice id match.
 */
export function getVoicePreviewCacheKey(
  personaId: string,
  voiceId: string,
): string {
  const safePersona = personaId.trim().toLowerCase();
  const safeVoice = sanitizeVoicePreviewVoiceId(voiceId);
  return `${safePersona}-${safeVoice}`;
}

/**
 * Voice id used for preview synthesis and cache naming.
 * Miles / Devon stay isolated; all other targets use their resolved voiceId.
 */
export function resolvePreviewCacheVoiceId(
  target: VoicePreviewTarget,
): string {
  if (target.provider === "openai") return target.voiceId;
  return resolveMilesOrDevonVoiceId(target.previewKey) ?? target.voiceId;
}

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
    resolveMilesOrDevonVoiceId(persona.id)
    ?? resolveElevenLabsVoiceId(persona.id)
    ?? persona.elevenLabsVoiceId;

  console.log("[Voice Resolution]", {
    personaId: persona.id,
    resolvedVoiceId: voiceId,
  });

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

  const isolated = resolveMilesOrDevonVoiceId(key);
  if (isolated) {
    console.log("[Voice Resolution]", {
      personaId: key.toLowerCase(),
      resolvedVoiceId: isolated,
    });
    return isolated;
  }

  const eleven = resolveElevenLabsVoiceId(key);
  if (eleven) return eleven;

  const persona = getPersonaById(key);
  if (persona) {
    const personaIsolated = resolveMilesOrDevonVoiceId(persona.id);
    if (personaIsolated) {
      console.log("[Voice Resolution]", {
        personaId: persona.id,
        resolvedVoiceId: personaIsolated,
      });
      return personaIsolated;
    }
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
