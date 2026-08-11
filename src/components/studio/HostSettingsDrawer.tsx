/**
 * Studio-facing alias for Host Settings.
 * Persona audition controls (free OpenAI + Pro ElevenLabs) live in
 * {@link HostVoicePersonaSelector} — every voice card exposes Audition Voice.
 * Card labels use first-name UI display names from
 * {@link getPersonaUiDisplayName} (`@/lib/dj/personaConfig`).
 */
export { default } from "@/components/player/HostSettingsModal";
export type { HostSettingsModalProps as HostSettingsDrawerProps } from "@/components/player/HostSettingsModal";