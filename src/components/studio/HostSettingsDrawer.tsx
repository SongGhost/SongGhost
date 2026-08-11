/**
 * Studio-facing alias for Host Settings.
 * Persona audition controls (free OpenAI + Pro ElevenLabs) live in
 * {@link HostVoicePersonaSelector} — every voice card exposes Audition Voice.
 */
export { default } from "@/components/player/HostSettingsModal";
export type { HostSettingsModalProps as HostSettingsDrawerProps } from "@/components/player/HostSettingsModal";