"use client";

import { Lock } from "lucide-react";
import { PERSONAS, type PersonaId } from "@/data/personas";
import { useTier } from "@/context/TierContext";
import type { VoiceOption } from "@/types/voice";

/**
 * @deprecated Prefer {@link HostControlsBar} from `@/components/player/WebPlayer`
 * — kept as a thin alias for existing imports.
 */
export {
  HostControlsBar as default,
  type HostControlsBarProps as HostBarProps,
} from "@/components/player/WebPlayer";

/** Free-tier OpenAI TTS voices shown in the Host Studio selector. */
export const STANDARD_HOST_VOICES: {
  id: Extract<VoiceOption, "onyx" | "echo" | "alloy">;
  label: string;
  description: string;
}[] = [
  { id: "onyx", label: "Onyx", description: "Deep, authoritative male" },
  { id: "echo", label: "Echo", description: "Smooth, neutral male" },
  { id: "alloy", label: "Alloy", description: "Warm, versatile female" },
];

/** Named ElevenLabs / Cartesia hosts — Pro voice engines. */
export const PRO_HOST_PERSONA_IDS = new Set<PersonaId>(
  PERSONAS.map((persona) => persona.id),
);

export function StandardBadge() {
  return (
    <span className="inline-flex items-center rounded border border-emerald-500/45 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-emerald-300">
      STANDARD
    </span>
  );
}

export function ProBadge() {
  return (
    <span className="inline-flex items-center rounded border border-accent/45 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-accent">
      PRO
    </span>
  );
}

export type HostVoicePersonaSelectorProps = {
  personaId: PersonaId;
  onPersonaChange: (personaId: PersonaId) => void;
  /** Currently selected free-tier OpenAI voice (highlighted when Free). */
  standardVoice?: VoiceOption;
  onStandardVoiceChange?: (voice: Extract<VoiceOption, "onyx" | "echo" | "alloy">) => void;
};

/**
 * TTS Voice / Persona selector for the Host Studio drawer.
 * Free: OpenAI STANDARD voices. Pro: named ElevenLabs / Cartesia hosts.
 */
export function HostVoicePersonaSelector({
  personaId,
  onPersonaChange,
  standardVoice = "onyx",
  onStandardVoiceChange,
}: HostVoicePersonaSelectorProps) {
  const { isPro, isFree, openUpgradeModal } = useTier();

  const handleStandardSelect = (
    voice: Extract<VoiceOption, "onyx" | "echo" | "alloy">,
  ) => {
    onStandardVoiceChange?.(voice);
  };

  const handlePersonaSelect = (id: PersonaId) => {
    if (!isPro) {
      openUpgradeModal();
      return;
    }
    onPersonaChange(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Standard voices · OpenAI
        </p>
        <div
          role="group"
          aria-label="Standard TTS voices"
          className="flex flex-col gap-1.5"
        >
          {STANDARD_HOST_VOICES.map((voice) => {
            const selected = isFree && standardVoice === voice.id;
            return (
              <button
                key={voice.id}
                type="button"
                aria-pressed={selected}
                onClick={() => handleStandardSelect(voice.id)}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-white/[0.08] bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-900"
                }`}
              >
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    selected ? "bg-emerald-400" : "bg-zinc-700"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-sans text-sm font-medium ${
                        selected ? "text-emerald-300" : "text-zinc-200"
                      }`}
                    >
                      {voice.label}
                    </span>
                    <StandardBadge />
                  </span>
                  <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                    {voice.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Pro hosts · ElevenLabs / Cartesia
        </p>
        <div
          role="group"
          aria-label="Pro host personas"
          className="flex flex-col gap-1.5"
        >
          {PERSONAS.map((persona) => {
            const selected = isPro && personaId === persona.id;
            const locked = isFree;
            return (
              <button
                key={persona.id}
                type="button"
                aria-pressed={selected}
                onClick={() => handlePersonaSelect(persona.id)}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? "border-accent/50 bg-accent/10"
                    : locked
                      ? "border-white/[0.06] bg-zinc-950/40 hover:border-accent/30"
                      : "border-white/[0.08] bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-900"
                }`}
              >
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    selected ? "bg-accent" : "bg-zinc-700"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-sans text-sm font-medium ${
                        selected ? "text-accent" : "text-zinc-200"
                      }`}
                    >
                      {persona.name.split(" ")[0]}
                    </span>
                    <ProBadge />
                  </span>
                  <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                    {persona.tone}
                  </span>
                </span>
                {locked ? (
                  <Lock
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/70"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
