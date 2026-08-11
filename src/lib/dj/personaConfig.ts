/**
 * Shared host-persona helpers for Studio voice previews, voice ID resolution,
 * and related copy.
 */

export {
  ELEVENLABS_HOST_VOICE_DEFAULTS,
  getPersonaElevenLabsVoiceMap,
  resolveElevenLabsVoiceId,
  resolveHostElevenLabsVoiceId,
  type HostVoiceKey,
} from "@/config/elevenlabs-voices";

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
