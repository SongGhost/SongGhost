/**
 * Shared host-persona helpers for Studio voice previews, voice ID resolution,
 * station auto-assignment, and related copy.
 */

import {
  getPersonaById,
  isPersonaId,
  PERSONAS,
  resolvePersonaId,
  type PersonaId,
} from "@/data/personas";
import { resolveElevenLabsVoiceId } from "@/config/elevenlabs-voices";
import { HOST_PERSONA_AFFINITY } from "@/config/host-persona-affinity";
import { isVoiceOption, VOICE_OPTIONS, type VoiceOption } from "@/types/voice";

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

/**
 * User-facing first-name labels for Host Studio / Control Deck UI.
 * Full broadcast names (`persona.name` / system prompts) stay unchanged for on-air copy.
 */
export const PERSONA_UI_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  miles: "Miles",
  henry: "Henry",
  devon: "Devon",
  "devon-pulse": "Devon",
  sloane: "Sloane",
  "sloane-vance": "Sloane",
  kira: "Kira",
  "kira-nova": "Kira",
  jasper: "Jasper",
  "jasper-reed": "Jasper",
  /** Free-tier OpenAI hosts — never flash a Pro name in Free Mode. */
  sam: "Sam",
  maya: "Maya",
  alex: "Alex",
};

/** Six Pro ElevenLabs hosts (canonical short ids). */
export const PRO_HOST_PERSONA_IDS = [
  "henry",
  "miles",
  "devon",
  "sloane",
  "kira",
  "jasper",
] as const;

/**
 * Short Pro picker ids → live roster ids.
 * `resolvePersonaId("devon")` is `devon-pulse`, never DEFAULT_PERSONA (`miles`).
 */
export const SHORT_PRO_PERSONA_ALIASES: Readonly<Record<string, PersonaId>> =
  Object.freeze({
    devon: "devon-pulse",
    sloane: "sloane-vance",
    kira: "kira-nova",
    jasper: "jasper-reed",
  });

export type ProHostPersonaId = (typeof PRO_HOST_PERSONA_IDS)[number];

/** Three Free OpenAI hosts. */
export type FreePersonaId = "sam" | "maya" | "alex";

/** Free-tier host picker labels (Save Station / Host Studio). */
export const FREE_HOST_OPTIONS = [
  { id: "sam" as const, displayName: "Sam", description: "Deep/Smooth" },
  { id: "maya" as const, displayName: "Maya", description: "Upbeat" },
  { id: "alex" as const, displayName: "Alex", description: "Warm" },
] as const;

/**
 * Free UI host → stable `PersonaId` seed for persisted stations.
 * `resolveActiveHost(id, false)` maps these back to Sam / Maya / Alex.
 */
const FREE_HOST_TO_PERSONA_SEED: Readonly<Record<FreePersonaId, PersonaId>> =
  Object.freeze({
    sam: "miles",
    maya: "sloane-vance",
    alex: "devon-pulse",
  });

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
 * Strict Free roster — OpenAI STANDARD voices only.
 * Sam (onyx), Maya (nova), Alex (echo).
 */
export const FREE_HOST_ROSTER: Readonly<
  Record<FreePersonaId, Readonly<ActiveHost>>
> = Object.freeze({
  sam: Object.freeze({
    personaId: "sam",
    displayName: "Sam",
    provider: "openai",
    voiceId: "onyx",
  }),
  maya: Object.freeze({
    personaId: "maya",
    displayName: "Maya",
    provider: "openai",
    voiceId: "nova",
  }),
  alex: Object.freeze({
    personaId: "alex",
    displayName: "Alex",
    provider: "openai",
    voiceId: "echo",
  }),
});

/**
 * Pro ElevenLabs host → Free OpenAI host.
 * Short aliases + live `PersonaId` forms both resolve.
 */
const PRO_TO_FREE_HOST: Readonly<Record<string, FreePersonaId>> = Object.freeze({
  miles: "sam",
  henry: "sam",
  jasper: "sam",
  "jasper-reed": "sam",
  sloane: "maya",
  "sloane-vance": "maya",
  kira: "maya",
  "kira-nova": "maya",
  devon: "alex",
  "devon-pulse": "alex",
});

/**
 * Recommended-default seeds → Free roster entry.
 * onyx/nova/echo keep their Sam/Maya/Alex labels. The other 10 OpenAI voices
 * pass through {@link resolveActiveHost} as themselves (no 3-voice collapse).
 */
const FREE_SEED_TO_HOST: Readonly<Record<string, FreePersonaId>> = Object.freeze({
  sam: "sam",
  onyx: "sam",
  maya: "maya",
  nova: "maya",
  alex: "alex",
  echo: "alex",
});

function isFreePersonaId(id: string): id is FreePersonaId {
  return id === "sam" || id === "maya" || id === "alex";
}

/**
 * Tier-filtered host roster for Save Station / Studio persona pickers.
 * Free → Sam / Maya / Alex recommended defaults. Host Studio lists all 13
 * OpenAI voices separately; this picker still persists a PersonaId seed.
 * Pro → the six named hosts (WS-2 will re-surface them on OpenAI voices).
 */
export function getAvailablePersonas(isPro: boolean): AvailablePersonaOption[] {
  if (!isPro) {
    return FREE_HOST_OPTIONS.map((host) => ({
      id: host.id,
      displayName: host.displayName,
      description: host.description,
    }));
  }

  return PERSONAS.map((persona) => ({
    id: persona.id,
    displayName: getPersonaUiDisplayName(persona.id, persona.name),
    description: persona.defaultGenre,
  }));
}

/**
 * Normalize a picker selection into a persistable `PersonaId`.
 * Free selections (`sam` / `maya` / `alex`) map onto Pro seeds that Free Mode
 * remaps back to the matching OpenAI host.
 */
export function toStationPersonaId(
  selectedId: string,
  isPro: boolean,
): PersonaId {
  const key = selectedId.trim().toLowerCase();
  if (!isPro && isFreePersonaId(key)) {
    return FREE_HOST_TO_PERSONA_SEED[key];
  }
  return resolvePersonaId(key);
}

/** Picker value for an on-air / default host under the current tier. */
export function getPersonaPickerValue(
  personaOrVoiceId: string | null | undefined,
  isPro: boolean,
): string {
  const host = resolveActiveHost(personaOrVoiceId ?? "", isPro);
  if (!isPro) return host.personaId;
  return resolvePersonaId(host.personaId);
}

function openAiVoiceHost(voice: OpenAiHostVoice): ActiveHost {
  const fromSeed = FREE_SEED_TO_HOST[voice];
  if (fromSeed) return { ...FREE_HOST_ROSTER[fromSeed] };
  return {
    personaId: voice,
    displayName: openAiDisplayName(voice),
    provider: "openai",
    voiceId: voice,
  };
}

/**
 * Atomic Free vs Pro host resolver.
 *
 * - Pro: requested persona as-is (ElevenLabs voice still used by mothballed
 *   paths). OpenAI voice ids pass through so Host Studio picks stick.
 * - Free: OpenAI voice ids pass through (all 13). Named Pro hosts still
 *   collapse onto Sam / Maya / Alex recommended defaults.
 */
export function resolveActiveHost(
  requestedPersonaId: PersonaId | string,
  isPro: boolean,
): ActiveHost {
  const key = String(requestedPersonaId ?? "").trim().toLowerCase();

  if (isPro) {
    if (isFreePersonaId(key)) {
      return { ...FREE_HOST_ROSTER[key] };
    }
    if (isOpenAiHostVoice(key)) {
      return openAiVoiceHost(key);
    }

    const persona = getPersonaById(key);
    const personaId = persona?.id ?? resolvePersonaId(key);
    const voiceId =
      resolveMilesOrDevonVoiceId(personaId)
      ?? resolveElevenLabsVoiceId(personaId)
      ?? persona?.elevenLabsVoiceId
      ?? "";

    return {
      personaId,
      displayName: getPersonaUiDisplayName(personaId, persona?.name),
      provider: "elevenlabs",
      voiceId,
    };
  }

  // Free Mode — never keep an ElevenLabs Pro host name or voice id.
  if (isFreePersonaId(key)) {
    return { ...FREE_HOST_ROSTER[key] };
  }
  const fromSeed = FREE_SEED_TO_HOST[key];
  if (fromSeed) return { ...FREE_HOST_ROSTER[fromSeed] };

  if (isOpenAiHostVoice(key)) {
    return openAiVoiceHost(key);
  }

  const fromPro = PRO_TO_FREE_HOST[key];
  if (fromPro) return { ...FREE_HOST_ROSTER[fromPro] };

  if (isPersonaId(key)) {
    const mapped = PRO_TO_FREE_HOST[key] ?? "sam";
    return { ...FREE_HOST_ROSTER[mapped] };
  }

  const resolved = resolvePersonaId(key);
  const mapped = PRO_TO_FREE_HOST[resolved] ?? "sam";
  return { ...FREE_HOST_ROSTER[mapped] };
}

/**
 * Resolve a persona id (or legacy alias) to its short UI label.
 * Falls back to the first token of the broadcast name when unknown.
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
  if (fullName) {
    const first = fullName.split(/\s+/)[0];
    if (first) return first;
  }

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

/**
 * ElevenLabs Pro hosts (canonical ids + short aliases) → Free OpenAI STANDARD voices.
 * Mirrors {@link PRO_TO_FREE_HOST} voice targets (Sam/Maya/Alex).
 */
const ELEVENLABS_TO_OPENAI_FALLBACK: Readonly<Record<string, OpenAiHostVoice>> =
  Object.freeze({
    miles: "onyx",
    henry: "onyx",
    devon: "echo",
    "devon-pulse": "echo",
    sloane: "nova",
    "sloane-vance": "nova",
    kira: "nova",
    "kira-nova": "nova",
    jasper: "onyx",
    "jasper-reed": "onyx",
  });

/** Effective host id after subscription tier guards (Pro persona or Free OpenAI voice). */
export type EffectivePersonaId = PersonaId | OpenAiHostVoice;

/**
 * Subscription tier guard for host personas.
 *
 * Delegates to {@link resolveActiveHost}:
 * - Pro: return the persona unchanged (legacy aliases normalized).
 * - Free: return the OpenAI voice id (all 13; Sam/Maya/Alex remain defaults).
 */
export function getEffectivePersona(
  personaId: PersonaId | string,
  isPro: boolean,
): EffectivePersonaId {
  const key = String(personaId ?? "").trim().toLowerCase();
  if (!key) return isPro ? resolvePersonaId(key) : "onyx";

  const host = resolveActiveHost(key, isPro);
  if (!isPro) {
    return isOpenAiHostVoice(host.voiceId) ? host.voiceId : "onyx";
  }

  if (isOpenAiHostVoice(host.voiceId) && host.provider === "openai") {
    return host.voiceId;
  }
  return resolvePersonaId(host.personaId);
}

/** True when `personaId` is (or aliases to) a named ElevenLabs Pro host. */
export function isElevenLabsHostPersona(personaId: string): boolean {
  const key = personaId.trim().toLowerCase();
  if (!key) return false;
  if (isFreePersonaId(key) || isOpenAiHostVoice(key)) return false;
  if (key in PRO_TO_FREE_HOST || key in ELEVENLABS_TO_OPENAI_FALLBACK) {
    return true;
  }
  return resolvePersonaId(key) in PRO_TO_FREE_HOST;
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
