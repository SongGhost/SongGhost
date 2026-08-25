/**
 * Shared host-persona helpers for Studio voice previews, voice ID resolution,
 * station auto-assignment, and related copy.
 */

import {
  DEFAULT_PERSONA,
  getPersonaById,
  isPersonaId,
  LEGACY_PERSONA_VOICE,
  PERSONAS,
  resolvePersonaId,
  type PersonaId,
} from "@/data/personas";
import { resolveElevenLabsVoiceId } from "@/config/elevenlabs-voices";
import { HOST_PERSONA_AFFINITY } from "@/config/host-persona-affinity";
import { isVoiceOption, VOICE_OPTIONS, type VoiceOption } from "@/types/voice";

/** Explicit Miles ElevenLabs voice — mothballed WS-7 path only. */
const milesVoiceId =
  process.env.ELEVENLABS_VOICE_MILES || "gyIv9PAQRvJjSZlk68oE";

/** Explicit Devon ElevenLabs voice — mothballed WS-7 path only. */
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
 * Strict Miles / Devon voice isolation for mothballed ElevenLabs callers.
 * Returns undefined for all other hosts so the shared map can resolve them.
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

/** User-facing labels for Host Studio / Control Deck UI. */
export const PERSONA_UI_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "standard-broadcast": "Standard Broadcast",
  "warm-companion": "Warm Companion",
  "sarcastic-critic": "Sarcastic Critic",
  "the-musicologist": "The Musicologist",
  /** Legacy named hosts — resolvePersonaId maps these; labels kept for old UI stamps. */
  miles: "Warm Companion",
  henry: "Warm Companion",
  devon: "Warm Companion",
  "devon-pulse": "Warm Companion",
  sloane: "Sarcastic Critic",
  "sloane-vance": "Sarcastic Critic",
  kira: "Warm Companion",
  "kira-nova": "Warm Companion",
  jasper: "The Musicologist",
  "jasper-reed": "The Musicologist",
  sam: "Standard Broadcast",
  maya: "Standard Broadcast",
  alex: "Standard Broadcast",
};

/** Pro-gated persona ids. Standard Broadcast is Free. */
export const PRO_HOST_PERSONA_IDS = [
  "warm-companion",
  "sarcastic-critic",
  "the-musicologist",
] as const;

/**
 * Short / legacy picker ids → live roster ids.
 */
export const SHORT_PRO_PERSONA_ALIASES: Readonly<Record<string, PersonaId>> =
  Object.freeze({
    devon: "warm-companion",
    sloane: "sarcastic-critic",
    kira: "warm-companion",
    jasper: "the-musicologist",
    henry: "warm-companion",
    miles: "warm-companion",
  });

export type ProHostPersonaId = (typeof PRO_HOST_PERSONA_IDS)[number];

export const FREE_PERSONA_ID: PersonaId = "standard-broadcast";

/** @deprecated WS-1 Free roster — all three collapse to Standard Broadcast. */
export type FreePersonaId = "sam" | "maya" | "alex" | "standard-broadcast";

/** Free-tier host picker labels (Save Station / Host Studio). */
export const FREE_HOST_OPTIONS = [
  {
    id: "standard-broadcast" as const,
    displayName: "Standard Broadcast",
    description: "Clean, factual, professional radio",
  },
] as const;

/** One option in a tier-filtered DJ persona `<select>`. */
export type AvailablePersonaOption = {
  id: string;
  displayName: string;
  description: string;
};

export type ActiveHostProvider = "elevenlabs" | "openai";

/** Resolved host for UI badges + TTS after subscription tier guards. */
export type ActiveHost = {
  personaId: string;
  displayName: string;
  provider: ActiveHostProvider;
  voiceId: string;
};

/**
 * Free roster — Standard Broadcast on OpenAI. Voice is a separate axis;
 * this default is only used when the caller did not pass a preferred voice.
 */
export const FREE_HOST_ROSTER: Readonly<
  Record<"standard-broadcast", Readonly<ActiveHost>>
> = Object.freeze({
  "standard-broadcast": Object.freeze({
    personaId: "standard-broadcast",
    displayName: "Standard Broadcast",
    provider: "openai" as const,
    voiceId: "alloy",
  }),
});

/**
 * Pro / legacy host → Standard Broadcast for Free-tier demotion.
 * Voice is not taken from this map — callers keep `preferredVoice`.
 */
const PRO_TO_FREE_HOST: Readonly<Record<string, typeof FREE_PERSONA_ID>> =
  Object.freeze({
    "warm-companion": "standard-broadcast",
    "sarcastic-critic": "standard-broadcast",
    "the-musicologist": "standard-broadcast",
    miles: "standard-broadcast",
    henry: "standard-broadcast",
    jasper: "standard-broadcast",
    "jasper-reed": "standard-broadcast",
    sloane: "standard-broadcast",
    "sloane-vance": "standard-broadcast",
    kira: "standard-broadcast",
    "kira-nova": "standard-broadcast",
    devon: "standard-broadcast",
    "devon-pulse": "standard-broadcast",
  });

/** Old Free roster + recommended OpenAI voices → Standard Broadcast. */
const FREE_SEED_TO_HOST: Readonly<Record<string, typeof FREE_PERSONA_ID>> =
  Object.freeze({
    sam: "standard-broadcast",
    maya: "standard-broadcast",
    alex: "standard-broadcast",
    "standard-broadcast": "standard-broadcast",
  });

function isFreePersonaId(id: string): boolean {
  return id === "sam" || id === "maya" || id === "alex" || id === "standard-broadcast";
}

function isProPersonaId(id: string): boolean {
  const resolved = resolvePersonaId(id);
  const persona = getPersonaById(resolved);
  return persona?.tier === "pro";
}

/**
 * Tier-filtered host roster for Save Station / Studio persona pickers.
 * Free → Standard Broadcast. Pro → all 4 personas.
 */
export function getAvailablePersonas(isPro: boolean): AvailablePersonaOption[] {
  const roster = isPro ? PERSONAS : PERSONAS.filter((p) => p.tier === "free");
  return roster.map((persona) => ({
    id: persona.id,
    displayName: persona.name,
    description: persona.description,
  }));
}

/**
 * Normalize a picker selection into a persistable `PersonaId`.
 * Free selections always persist Standard Broadcast.
 */
export function toStationPersonaId(
  selectedId: string,
  isPro: boolean,
): PersonaId {
  const key = selectedId.trim().toLowerCase();
  if (!isPro) return FREE_PERSONA_ID;
  return resolvePersonaId(key);
}

/** Picker value for an on-air / default host under the current tier. */
export function getPersonaPickerValue(
  personaOrVoiceId: string | null | undefined,
  isPro: boolean,
): string {
  const host = resolveActiveHost(personaOrVoiceId ?? "", isPro);
  return host.personaId;
}

function openAiVoiceHost(voice: OpenAiHostVoice): ActiveHost {
  return {
    personaId: FREE_PERSONA_ID,
    displayName: DEFAULT_PERSONA.name,
    provider: "openai",
    voiceId: voice,
  };
}

function defaultVoiceForRequest(key: string, personaVoice: VoiceOption): VoiceOption {
  const preserved = LEGACY_PERSONA_VOICE[key];
  if (preserved) return preserved;
  return personaVoice;
}

/**
 * Atomic Free vs Pro host resolver.
 *
 * Voice and persona are independent: this returns the persona identity plus a
 * default OpenAI voice (persona default, or the legacy host's documented
 * OpenAI voice). Callers with `preferredVoice` should prefer that over
 * `voiceId` so a listener pick is never overwritten.
 *
 * - Pro: requested persona (legacy aliases migrated). Always OpenAI.
 * - Free: Standard Broadcast. Pro personas demote. OpenAI voice ids pass through.
 */
export function resolveActiveHost(
  requestedPersonaId: PersonaId | string,
  isPro: boolean,
): ActiveHost {
  const key = String(requestedPersonaId ?? "").trim().toLowerCase();

  if (isOpenAiHostVoice(key)) {
    return openAiVoiceHost(key);
  }

  if (isPro) {
    if (isFreePersonaId(key) && key !== "standard-broadcast" && !isPersonaId(key)) {
      return { ...FREE_HOST_ROSTER["standard-broadcast"] };
    }

    const persona = getPersonaById(key) ?? getPersonaById(resolvePersonaId(key));
    const personaId = persona?.id ?? resolvePersonaId(key);
    const voiceId = defaultVoiceForRequest(key, persona?.voice ?? DEFAULT_PERSONA.voice);

    return {
      personaId,
      displayName: getPersonaUiDisplayName(personaId, persona?.name),
      provider: "openai",
      voiceId,
    };
  }

  // Free Mode — never keep a Pro persona on-air.
  if (isFreePersonaId(key) || FREE_SEED_TO_HOST[key]) {
    const fromSeed = FREE_SEED_TO_HOST[key] ?? "standard-broadcast";
    const preserved = LEGACY_PERSONA_VOICE[key];
    return {
      ...FREE_HOST_ROSTER[fromSeed],
      ...(preserved ? { voiceId: preserved } : {}),
    };
  }

  const fromPro = PRO_TO_FREE_HOST[key];
  if (fromPro) {
    const preserved = LEGACY_PERSONA_VOICE[key];
    return {
      ...FREE_HOST_ROSTER[fromPro],
      ...(preserved ? { voiceId: preserved } : {}),
    };
  }

  if (isPersonaId(key) && isProPersonaId(key)) {
    return { ...FREE_HOST_ROSTER["standard-broadcast"] };
  }

  const resolved = resolvePersonaId(key);
  if (isProPersonaId(resolved)) {
    return { ...FREE_HOST_ROSTER["standard-broadcast"] };
  }

  const persona = getPersonaById(resolved) ?? DEFAULT_PERSONA;
  return {
    personaId: persona.id,
    displayName: persona.name,
    provider: "openai",
    voiceId: defaultVoiceForRequest(key, persona.voice),
  };
}

/**
 * Resolve a persona id (or legacy alias) to its UI label.
 */
export function getPersonaUiDisplayName(
  personaId: string,
  fallbackName?: string,
): string {
  const key = personaId.trim().toLowerCase();
  const mapped = PERSONA_UI_DISPLAY_NAMES[key];
  if (mapped) return mapped;

  const persona = getPersonaById(key);
  const fullName = fallbackName?.trim() || persona?.name?.trim();
  if (fullName) return fullName;

  return "Host";
}

/** All 13 OpenAI built-in voices — identity-mapped TTS targets (no remapping). */
export const OPENAI_HOST_VOICES: readonly VoiceOption[] = VOICE_OPTIONS.map(
  (option) => option.id,
);

export type OpenAiHostVoice = VoiceOption;

export function isOpenAiHostVoice(id: string): id is OpenAiHostVoice {
  return isVoiceOption(id.trim().toLowerCase());
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

/** Effective host id after subscription tier guards (always a PersonaId). */
export type EffectivePersonaId = PersonaId;

/**
 * Subscription tier guard for host personas.
 *
 * - Pro: return the persona (legacy aliases normalized).
 * - Free: Standard Broadcast when the requested persona is Pro-gated.
 */
export function getEffectivePersona(
  personaId: PersonaId | string,
  isPro: boolean,
): EffectivePersonaId {
  const key = String(personaId ?? "").trim().toLowerCase();
  if (!key) return DEFAULT_PERSONA.id;

  const host = resolveActiveHost(key, isPro);
  return resolvePersonaId(host.personaId);
}

/** True when `personaId` is (or aliases to) a Pro-gated persona. */
export function isElevenLabsHostPersona(personaId: string): boolean {
  const key = personaId.trim().toLowerCase();
  if (!key) return false;
  if (isOpenAiHostVoice(key)) return false;
  return isProPersonaId(key);
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
      instructions?: string;
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
 * Accepts persona ids or OpenAI voice ids. Personas synthesize on OpenAI
 * with their `ttsInstructions` so delivery matches the live dial.
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

  return {
    provider: "openai",
    previewKey: persona.id,
    voiceId: persona.voice,
    displayName: persona.name,
    instructions: persona.ttsInstructions,
  };
}

/**
 * Resolve a live session voice target.
 * OpenAI voice ids map to themselves; persona ids map to the persona default
 * OpenAI voice (or the documented legacy OpenAI voice). ElevenLabs ids are
 * only returned for mothballed explicit-provider callers.
 */
export function resolveSessionVoiceId(
  personaOrVoiceKey: string,
): string | undefined {
  const key = personaOrVoiceKey.trim();
  if (!key) return undefined;

  const openAi = resolveOpenAiVoiceId(key);
  if (openAi) return openAi;

  const isolated = resolveMilesOrDevonVoiceId(key);
  if (isolated) return isolated;

  const eleven = resolveElevenLabsVoiceId(key);
  if (eleven) return eleven;

  const persona = getPersonaById(key);
  if (persona) {
    return defaultVoiceForRequest(key.toLowerCase(), persona.voice);
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
  return persona?.description;
}
