/**
 * Canonical ElevenLabs voice IDs for the SongGhost hosts.
 * Env vars win when set; otherwise the Voice Library fallbacks below apply.
 */

export type HostVoiceKey =
  | "henry"
  | "sloane"
  | "miles"
  | "devon"
  | "kira"
  | "jasper";

/** Hardcoded Voice Library fallbacks when env overrides are unset. */
export const ELEVENLABS_HOST_VOICE_DEFAULTS: Record<HostVoiceKey, string> = {
  henry: "TxGEqnFqp04tlrHPhzTr", // Josh (premade) — warm male country booth
  sloane: "qSeXEcewz7tA0Q0qk9fH",
  miles: "gyIv9PAQRvJjSZlk68oE",
  devon: "2ajXGJNYBR0iNHpS4VZb",
  kira: "lcMyyd2HUfFzxdCaC4Ta",
  jasper: "Cz0K1kOv9tD8l0b5Qu53",
};

/** Persona ids + short aliases → host voice key. */
const PERSONA_TO_HOST_VOICE_KEY: Record<string, HostVoiceKey> = {
  henry: "henry",
  sloane: "sloane",
  sloan: "sloane",
  "sloane-vance": "sloane",
  miles: "miles",
  devon: "devon",
  "devon-pulse": "devon",
  kira: "kira",
  "kira-nova": "kira",
  jasper: "jasper",
  "jasper-reed": "jasper",
  jasper_reed: "jasper",
};

function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/** Resolve a host key to its env-aware ElevenLabs voice id. */
export function resolveHostElevenLabsVoiceId(host: HostVoiceKey): string {
  switch (host) {
    case "henry":
      return envOr(process.env.ELEVENLABS_VOICE_HENRY, ELEVENLABS_HOST_VOICE_DEFAULTS.henry);
    case "sloane":
      return envOr(process.env.ELEVENLABS_VOICE_SLOANE, ELEVENLABS_HOST_VOICE_DEFAULTS.sloane);
    case "miles":
      return envOr(
        process.env.ELEVENLABS_VOICE_MILES || process.env.ELEVENLABS_VOICE_JOHNNY,
        ELEVENLABS_HOST_VOICE_DEFAULTS.miles,
      );
    case "devon":
      return envOr(process.env.ELEVENLABS_VOICE_DEVON, ELEVENLABS_HOST_VOICE_DEFAULTS.devon);
    case "kira":
      return envOr(process.env.ELEVENLABS_VOICE_KIRA, ELEVENLABS_HOST_VOICE_DEFAULTS.kira);
    case "jasper":
      return envOr(process.env.ELEVENLABS_VOICE_JASPER, ELEVENLABS_HOST_VOICE_DEFAULTS.jasper);
  }
}

/**
 * Resolve any persona id / short host key to an ElevenLabs voice id.
 * Returns `undefined` when the key is not a known host.
 */
export function resolveElevenLabsVoiceId(personaOrHostKey: string): string | undefined {
  const key = PERSONA_TO_HOST_VOICE_KEY[personaOrHostKey.trim().toLowerCase()];
  if (!key) return undefined;
  return resolveHostElevenLabsVoiceId(key);
}

/** Env-aware map keyed by live `PersonaId` for lore / TTS routes. */
export function getPersonaElevenLabsVoiceMap(): Record<string, string> {
  return {
    henry: resolveHostElevenLabsVoiceId("henry"),
    "sloane-vance": resolveHostElevenLabsVoiceId("sloane"),
    miles: resolveHostElevenLabsVoiceId("miles"),
    "devon-pulse": resolveHostElevenLabsVoiceId("devon"),
    "kira-nova": resolveHostElevenLabsVoiceId("kira"),
    "jasper-reed": resolveHostElevenLabsVoiceId("jasper"),
  };
}
