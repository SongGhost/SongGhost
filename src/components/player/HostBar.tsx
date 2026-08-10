"use client";

import { Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPersonaById, PERSONAS, type PersonaId } from "@/data/personas";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import {
  COMMENTARY_FORMAT_DESCRIPTIONS,
  COMMENTARY_FORMAT_LABELS,
  COMMENTARY_FORMAT_OPTIONS,
  DJ_PACE_LABELS,
  DJ_PACE_OPTIONS,
  FREE_TIER_DJ_PACE,
  PRO_COMMENTARY_FORMATS,
  PRO_DJ_PACES,
  type CommentaryFormat,
  type DjPace,
} from "@/types/dj";
import { DEFAULT_CHATTER_PACING } from "@/types/station";
import type { VoiceOption } from "@/types/voice";
import { VOICE_OPTIONS } from "@/types/voice";

import {
  HostControlsBar as HostControlsBarBase,
  type HostControlsBarProps,
} from "@/components/player/WebPlayer";

export type { HostControlsBarProps as HostBarProps };

/**
 * Host Studio / Control Deck usage meter label.
 * Free: `BREAKS 14/30 THIS MONTH · FREE` · Pro: `BREAKS UNLIMITED · PRO`.
 */
export function BreaksUsageLabel({ className = "" }: { className?: string }) {
  const { isPro, breaksUsed, breaksLimit } = useTier();
  const text = isPro
    ? "BREAKS UNLIMITED · PRO"
    : `BREAKS ${breaksUsed}/${breaksLimit} THIS MONTH · FREE`;

  return (
    <p
      className={
        className
        || "mt-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600"
      }
      aria-live="polite"
    >
      {text}
    </p>
  );
}

/**
 * Host Status Pill wrapper — resolves the host label from
 * `preferredVoice` / `activePersonaId` so Free-tier voice picks update live.
 * Also wires Free-tier break metering: locks Break Now at 30/30 and opens
 * {@link ProUpgradeModal} when the listener attempts a break past quota.
 * When the active tier is Free, forces global chatter pacing back to
 * SHORT BREAKS (`standard`) so Pro-only paces cannot stick after a downgrade.
 */
export function HostControlsBar({
  onBreakNow,
  personaName: personaNameProp,
  ...rest
}: HostControlsBarProps) {
  const { isPro, isFree, canUseBreak, openUpgradeModal } = useTier();
  const {
    preferredVoice,
    activePersonaId,
    chatterPacing,
    setChatterPacing,
  } = useUserPreferences();
  const personaName = resolveHostDisplayName({
    preferredVoice,
    activePersonaId,
    isPro,
    fallback: personaNameProp,
  });

  useEffect(() => {
    if (!isFree) return;
    if (chatterPacing === DEFAULT_CHATTER_PACING) return;
    setChatterPacing(DEFAULT_CHATTER_PACING);
  }, [isFree, chatterPacing, setChatterPacing]);

  const breakQuotaLocked = isFree && !canUseBreak;

  const handleBreakNow = useCallback(() => {
    if (breakQuotaLocked) {
      openUpgradeModal();
      return;
    }
    onBreakNow();
  }, [breakQuotaLocked, onBreakNow, openUpgradeModal]);

  return (
    <HostControlsBarBase
      {...rest}
      personaName={personaName}
      onBreakNow={handleBreakNow}
      breakQuotaLocked={breakQuotaLocked}
    />
  );
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

export type AllowExplicitContentToggleProps = {
  /** Fired when the listener toggles Clean Mode / explicit content. */
  onInteract?: () => void;
};

/**
 * Host Settings Drawer toggle for Clean Mode / explicit catalog + DJ commentary.
 */
export function AllowExplicitContentToggle({
  onInteract,
}: AllowExplicitContentToggleProps = {}) {
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
    onInteract?.();
    setToast(
      next
        ? "Explicit tracks & uncensored DJ commentary enabled"
        : "Explicit tracks & uncensored DJ commentary disabled",
    );
  }, [allowExplicit, onInteract, setAllowExplicit]);

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

export type BreakPaceSelectorProps = {
  value: DjPace;
  onChange: (pace: DjPace) => void;
  /** Fired when the listener changes pace (or opens the upgrade modal). */
  onInteract?: () => void;
};

const paceSegmentBtn = (selected: boolean, locked: boolean) =>
  `relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
    selected
      ? "bg-accent/20 text-accent ring-1 ring-accent/50"
      : locked
        ? "bg-[#121215] text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
        : "bg-[#121215] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
  }`;

/**
 * Host Settings Drawer selector for DJ break pace.
 * Free tier: only SHORT BREAKS is selectable; SILENT / EVERY SONG / LONG BREAKS
 * show PRO badges and open the upgrade modal on click.
 */
export function BreakPaceSelector({
  value,
  onChange,
  onInteract,
}: BreakPaceSelectorProps) {
  const { isPro, isFree, openUpgradeModal } = useTier();

  useEffect(() => {
    if (!isFree) return;
    if (value === FREE_TIER_DJ_PACE) return;
    onChange(FREE_TIER_DJ_PACE);
    onInteract?.();
  }, [isFree, value, onChange, onInteract]);

  const handleSelect = useCallback(
    (pace: DjPace) => {
      if (PRO_DJ_PACES.has(pace) && !isPro) {
        openUpgradeModal();
        onInteract?.();
        return;
      }
      onChange(pace);
      onInteract?.();
    },
    [isPro, onChange, onInteract, openUpgradeModal],
  );

  return (
    <div
      role="group"
      aria-label="Host pace"
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {DJ_PACE_OPTIONS.map((pace) => {
        const proLocked = PRO_DJ_PACES.has(pace);
        const locked = proLocked && !isPro;
        const selected = value === pace;
        return (
          <button
            key={pace}
            type="button"
            aria-pressed={selected}
            aria-disabled={locked || undefined}
            onClick={() => handleSelect(pace)}
            className={paceSegmentBtn(selected, locked)}
          >
            <span className="inline-flex items-center gap-1">
              {DJ_PACE_LABELS[pace]}
              {locked ? (
                <Lock className="h-3 w-3 shrink-0 text-accent/70" aria-hidden="true" />
              ) : null}
            </span>
            {proLocked ? <ProBadge /> : null}
          </button>
        );
      })}
    </div>
  );
}

export type CommentaryFormatSelectorProps = {
  /** Fired when the listener changes lore depth (or opens the upgrade modal). */
  onInteract?: () => void;
};

/**
 * Host Settings Drawer selector for lore / commentary depth.
 * Extended formats (`roots_branches`, `time_capsule`, `directors_cut`) are Pro-gated.
 */
export function CommentaryFormatSelector({
  onInteract,
}: CommentaryFormatSelectorProps = {}) {
  const { isPro, openUpgradeModal } = useTier();
  const { commentaryFormat, setCommentaryFormat } = useUserPreferences();

  const handleSelect = useCallback(
    (format: CommentaryFormat) => {
      if (PRO_COMMENTARY_FORMATS.has(format) && !isPro) {
        openUpgradeModal();
        onInteract?.();
        return;
      }
      setCommentaryFormat(format);
      onInteract?.();
    },
    [isPro, onInteract, openUpgradeModal, setCommentaryFormat],
  );

  return (
    <div role="group" aria-label="Lore and commentary depth" className="flex flex-col gap-1.5">
      {COMMENTARY_FORMAT_OPTIONS.map((format) => {
        const selected = commentaryFormat === format;
        const proLocked = PRO_COMMENTARY_FORMATS.has(format);
        const locked = proLocked && !isPro;
        return (
          <button
            key={format}
            type="button"
            aria-pressed={selected}
            onClick={() => handleSelect(format)}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              selected
                ? proLocked
                  ? "border-accent/50 bg-accent/10"
                  : "border-emerald-500/50 bg-emerald-500/10"
                : locked
                  ? "border-white/[0.06] bg-zinc-950/40 hover:border-accent/30"
                  : "border-white/[0.08] bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-900"
            }`}
          >
            <span
              className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                selected
                  ? proLocked
                    ? "bg-accent"
                    : "bg-emerald-400"
                  : "bg-zinc-700"
              }`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={`font-sans text-sm font-medium ${
                    selected
                      ? proLocked
                        ? "text-accent"
                        : "text-emerald-300"
                      : "text-zinc-200"
                  }`}
                >
                  {COMMENTARY_FORMAT_LABELS[format]}
                </span>
                {proLocked ? <ProBadge /> : <StandardBadge />}
              </span>
              <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                {COMMENTARY_FORMAT_DESCRIPTIONS[format]}
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
