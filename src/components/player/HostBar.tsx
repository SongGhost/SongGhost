"use client";

import { Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPersonaById, PERSONAS, type PersonaId } from "@/data/personas";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import type { VoiceOption } from "@/types/voice";
import { VOICE_OPTIONS } from "@/types/voice";

import {
  HostControlsBar as HostControlsBarBase,
  type HostControlsBarProps,
} from "@/components/player/WebPlayer";

export type { HostControlsBarProps as HostBarProps };

/**
 * Host Status Pill wrapper — resolves the host label from
 * `preferredVoice` / `activePersonaId` so Free-tier voice picks update live.
 */
export function HostControlsBar(props: HostControlsBarProps) {
  const { isPro } = useTier();
  const { preferredVoice, activePersonaId } = useUserPreferences();
  const personaName = resolveHostDisplayName({
    preferredVoice,
    activePersonaId,
    isPro,
    fallback: props.personaName,
  });
  return <HostControlsBarBase {...props} personaName={personaName} />;
}

/** @deprecated Prefer named {@link HostControlsBar}. */
export default HostControlsBar;

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

/**
 * Maps TTS voice / persona ids to the Host Status Pill display name.
 * Pill UI uppercases the result (`ONYX`, `SLOANE VANCE`, …).
 */
const VOICE_ID_DISPLAY_NAMES: Record<string, string> = {
  onyx: "Onyx",
  echo: "Echo",
  alloy: "Alloy",
  fable: "Fable",
  nova: "Nova",
  shimmer: "Shimmer",
  sloane: "Sloane Vance",
  "sloane-vance": "Sloane Vance",
};

export type ResolveHostDisplayNameOptions = {
  preferredVoice?: string | null;
  activePersonaId?: string | null;
  /** When false / Free tier, resolve from `preferredVoice` instead of persona. */
  isPro?: boolean;
  fallback?: string;
};

/**
 * Reactive host label for the Control Deck status pill.
 * Free: OpenAI voice id → display name. Pro: named persona.
 */
export function resolveHostDisplayName(
  options: ResolveHostDisplayNameOptions,
): string {
  const fallback = options.fallback?.trim() || "Host";

  if (!options.isPro) {
    const voiceId = (options.preferredVoice ?? "onyx").trim().toLowerCase();
    if (VOICE_ID_DISPLAY_NAMES[voiceId]) {
      return VOICE_ID_DISPLAY_NAMES[voiceId];
    }
    const fromStandard = STANDARD_HOST_VOICES.find((v) => v.id === voiceId);
    if (fromStandard) return fromStandard.label;
    const fromCatalog = VOICE_OPTIONS.find((v) => v.id === voiceId);
    if (fromCatalog) return fromCatalog.label;
    if (voiceId) {
      return voiceId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return fallback;
  }

  const personaId = options.activePersonaId?.trim() ?? "";
  if (personaId) {
    const mapped = VOICE_ID_DISPLAY_NAMES[personaId];
    if (mapped) return mapped;
    const persona = getPersonaById(personaId);
    if (persona?.name) return persona.name;
  }

  return fallback;
}

/**
 * Host Settings Drawer toggle for Clean Mode / explicit catalog + DJ commentary.
 */
export function AllowExplicitContentToggle() {
  const { allowExplicit, setAllowExplicit } = useUserPreferences();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleToggle = useCallback(() => {
    const next = !allowExplicit;
    setAllowExplicit(next);
    setToast(
      next
        ? "Explicit tracks & uncensored DJ commentary enabled"
        : "Explicit tracks & uncensored DJ commentary disabled",
    );
  }, [allowExplicit, setAllowExplicit]);

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={allowExplicit}
        onClick={handleToggle}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
          allowExplicit
            ? "border-accent/50 bg-accent/10"
            : "border-white/[0.08] bg-zinc-950/50 hover:border-zinc-600"
        }`}
      >
        <span className="min-w-0">
          <span className="block font-sans text-sm text-zinc-200">
            Allow Explicit Content
          </span>
          <span className="mt-0.5 block font-sans text-[11px] text-zinc-500">
            {allowExplicit
              ? "Explicit tracks and uncensored host commentary are on."
              : "Clean Mode — explicit tracks filtered; FCC-safe DJ copy."}
          </span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            allowExplicit ? "bg-accent" : "bg-zinc-700"
          }`}
          aria-hidden="true"
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-zinc-950 shadow transition-transform ${
              allowExplicit ? "left-5" : "left-0.5"
            }`}
          />
        </span>
      </button>
      {toast ? (
        <p
          role="status"
          className="pointer-events-none fixed bottom-20 right-4 z-[100] rounded-md border border-white/10 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-200 shadow-lg backdrop-blur-sm"
        >
          {toast}
        </p>
      ) : null}
    </>
  );
}

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
