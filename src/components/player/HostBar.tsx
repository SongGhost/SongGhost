"use client";

import { AudioLines, Loader2, Lock, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPersonaById, PERSONAS, type PersonaId } from "@/data/personas";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import {
  getPersonaUiDisplayName,
  resolveActiveHost,
} from "@/lib/dj/personaConfig";
import {
  COMMENTARY_FORMAT_DESCRIPTIONS,
  COMMENTARY_FORMAT_LABELS,
  COMMENTARY_FORMAT_OPTIONS,
  DEFAULT_DJ_TUNING,
  DJ_MOOD_DESCRIPTIONS,
  DJ_MOOD_LABELS,
  DJ_MOOD_OPTIONS,
  DJ_PACE_DESCRIPTIONS,
  DJ_PACE_LABELS,
  DJ_PACE_OPTIONS,
  DJ_PERSONALITY_DESCRIPTIONS,
  DJ_PERSONALITY_LABELS,
  DJ_PERSONALITY_OPTIONS,
  FREE_TIER_DJ_MOOD,
  FREE_TIER_DJ_PACE,
  FREE_TIER_DJ_PERSONALITY,
  PRO_COMMENTARY_FORMATS,
  PRO_DJ_MOODS,
  PRO_DJ_PACES,
  PRO_DJ_PERSONALITIES,
  resolveCommentaryFormat,
  type CommentaryFormat,
  type DjMood,
  type DjPace,
  type DjPersonality,
} from "@/types/dj";
import { DEFAULT_CHATTER_PACING } from "@/types/station";
import type { VoiceOption } from "@/types/voice";

import {
  HostControlsBar as HostControlsBarBase,
  type HostControlsBarProps,
} from "@/components/player/WebPlayer";

type VoicePreviewStatus = "idle" | "loading" | "playing";

export type { HostControlsBarProps as HostBarProps };

/**
 * Maps persisted `commentaryFormat` (global prefs or station override) to the
 * Host Studio / summary-pill label. Unknown or legacy values hydrate to Standard.
 */
export function formatCommentaryFormatLabel(
  format: CommentaryFormat | null | undefined,
): string {
  return COMMENTARY_FORMAT_LABELS[resolveCommentaryFormat(format)];
}

/**
 * Host Studio header-pill summary: pace • lore format.
 * Silent pace is pace-only; otherwise e.g. `Natural Pace • Director's Cut`.
 */
export function formatHostSettingsSummary(
  pace: DjPace,
  commentaryFormat: CommentaryFormat | null | undefined,
): string {
  if (pace === "silent") return DJ_PACE_LABELS.silent;
  return `${DJ_PACE_LABELS[pace]} • ${formatCommentaryFormatLabel(commentaryFormat)}`;
}

/** Shared Host Settings option card — inactive / active / locked states. */
export function optionCardClass(selected: boolean, locked = false): string {
  return [
    "w-full cursor-pointer rounded-lg border p-3 text-left transition",
    selected
      ? "border-cyan-500 bg-cyan-950/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
      : "border-slate-800 bg-slate-900/60 hover:border-slate-700",
    locked ? "opacity-90" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Host Studio / Control Deck usage meter label.
 * Free and Pro both show unlimited DJ breaks.
 */
export function BreaksUsageLabel({ className = "" }: { className?: string }) {
  const { isPro } = useTier();
  const text = isPro
    ? "BREAKS UNLIMITED · PRO"
    : "BREAKS UNLIMITED · FREE";

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
 * Subscribes to `commentaryFormat` so the header summary (`Natural Pace •
 * Director's Cut`) tracks Host Settings Lore & Commentary immediately.
 * Free-tier break caps are disabled (unlimited OpenAI host breaks).
 * When the active tier is Free, forces global chatter pacing back to
 * SHORT BREAKS (`standard`) so Pro-only paces cannot stick after a downgrade.
 */
export function HostControlsBar({
  onBreakNow,
  personaName: personaNameProp,
  ...rest
}: HostControlsBarProps) {
  const { isPro, isFree } = useTier();
  const {
    preferredVoice,
    activePersonaId,
    chatterPacing,
    setChatterPacing,
    commentaryFormat,
  } = useUserPreferences();
  const personaName = resolveHostDisplayName({
    preferredVoice,
    activePersonaId,
    isPro,
    fallback: personaNameProp,
  });
  const hostRules = formatHostSettingsSummary(rest.tuning.pace, commentaryFormat);

  useEffect(() => {
    if (!isFree) return;
    if (chatterPacing === DEFAULT_CHATTER_PACING) return;
    setChatterPacing(DEFAULT_CHATTER_PACING);
  }, [isFree, chatterPacing, setChatterPacing]);

  return (
    <HostControlsBarBase
      {...rest}
      personaName={personaName}
      hostRules={hostRules}
      onBreakNow={onBreakNow}
      breakQuotaLocked={false}
    />
  );
}

/** @deprecated Prefer named {@link HostControlsBar}. */
export default HostControlsBar;

/** Free-tier OpenAI TTS voices shown in the Host Studio selector (Sam/Maya/Alex). */
export const STANDARD_HOST_VOICES: {
  id: Extract<VoiceOption, "onyx" | "nova" | "echo">;
  label: string;
  description: string;
}[] = [
  { id: "onyx", label: "Sam", description: "Deep / Smooth" },
  { id: "nova", label: "Maya", description: "Upbeat Female" },
  { id: "echo", label: "Alex", description: "Warm Resonant" },
];

/**
 * Maps TTS voice / persona ids to the Host Status Pill display name.
 * Pill UI uppercases the result (`SAM`, `SLOANE`, …). Persona hosts use first names only.
 */
const VOICE_ID_DISPLAY_NAMES: Record<string, string> = {
  onyx: "Sam",
  echo: "Alex",
  nova: "Maya",
  sam: "Sam",
  maya: "Maya",
  alex: "Alex",
  // Legacy Free STANDARD voice labels remap onto the 3-host roster.
  alloy: "Maya",
  fable: "Sam",
  shimmer: "Maya",
  sloane: "Sloane",
  "sloane-vance": "Sloane",
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
 * Free: Sam / Maya / Alex via {@link resolveActiveHost}. Pro: named persona.
 */
export function resolveHostDisplayName(
  options: ResolveHostDisplayNameOptions,
): string {
  const fallback = options.fallback?.trim() || "Host";
  const isPro = Boolean(options.isPro);
  const seed = isPro
    ? (options.activePersonaId?.trim() || fallback)
    : (options.preferredVoice?.trim()
      || options.activePersonaId?.trim()
      || "sam");

  if (!seed || seed === "Host") return fallback;

  const host = resolveActiveHost(seed, isPro);
  if (host.displayName) return host.displayName;

  if (isPro) {
    const personaId = options.activePersonaId?.trim() ?? "";
    if (personaId) {
      const mapped = VOICE_ID_DISPLAY_NAMES[personaId];
      if (mapped) return mapped;
      const persona = getPersonaById(personaId);
      if (persona) return getPersonaUiDisplayName(persona.id, persona.name);
      return getPersonaUiDisplayName(personaId);
    }
  }

  return fallback;
}

export type AllowExplicitContentToggleProps = {
  /** Fired when the listener toggles Clean Mode / explicit content. */
  onInteract?: () => void;
};

export type BroadcastCityInputProps = {
  /** Fired when the listener edits Broadcast City. */
  onInteract?: () => void;
};

/**
 * Host Settings field for Broadcast City — VPN-safe weather / local colour.
 * Blank falls back to IP geolocation on the server.
 */
export function BroadcastCityInput({
  onInteract,
}: BroadcastCityInputProps = {}) {
  const { homeCity, setHomeCity } = useUserPreferences();
  const [draft, setDraft] = useState(homeCity ?? "");

  useEffect(() => {
    setDraft(homeCity ?? "");
  }, [homeCity]);

  const commit = useCallback(
    (raw: string) => {
      const next = raw.trim();
      const current = (homeCity ?? "").trim();
      if (next === current) return;
      setHomeCity(next);
      onInteract?.();
    },
    [homeCity, onInteract, setHomeCity],
  );

  return (
    <div className="rounded-lg border border-white/[0.08] bg-zinc-950/50 px-3 py-3">
      <label
        htmlFor="broadcast-city"
        className="block font-sans text-sm text-zinc-200"
      >
        Broadcast City
      </label>
      <p className="mt-0.5 font-sans text-[11px] text-zinc-500">
        Used for local weather colour when you&apos;re on a VPN. Leave blank to
        detect from your network.
      </p>
      <input
        id="broadcast-city"
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder="e.g. Salt Lake City, UT"
        autoComplete="address-level2"
        className="mt-2.5 w-full rounded-md border border-white/[0.08] bg-[#121215] px-3 py-2 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent/70"
      />
    </div>
  );
}

/**
 * Host Settings Drawer toggle for Clean Mode / explicit catalog + DJ commentary.
 * Free tier: forced off; tap opens the Pro upgrade modal.
 */
export function AllowExplicitContentToggle({
  onInteract,
}: AllowExplicitContentToggleProps = {}) {
  const { allowExplicit, setAllowExplicit } = useUserPreferences();
  const { isPro, isFree, openUpgradeModal } = useTier();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  /** Free tier may never leave Clean Mode. */
  useEffect(() => {
    if (!isFree || !allowExplicit) return;
    setAllowExplicit(false);
  }, [allowExplicit, isFree, setAllowExplicit]);

  const handleToggle = useCallback(() => {
    if (!isPro) {
      openUpgradeModal();
      onInteract?.();
      return;
    }
    const next = !allowExplicit;
    setAllowExplicit(next);
    onInteract?.();
    setToast(
      next
        ? "Explicit tracks & uncensored DJ commentary enabled"
        : "Explicit tracks & uncensored DJ commentary disabled",
    );
  }, [
    allowExplicit,
    isPro,
    onInteract,
    openUpgradeModal,
    setAllowExplicit,
  ]);

  const effectiveAllow = isPro && allowExplicit;

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={effectiveAllow}
        aria-disabled={!isPro || undefined}
        onClick={handleToggle}
        className={optionCardClass(effectiveAllow, !isPro)}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="inline-flex items-center gap-1.5 font-sans text-sm font-medium text-inherit">
              Allow Explicit Content
              <ProBadge />
            </span>
            <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
              {!isPro
                ? "Uncensored banter & explicit track commentary"
                : effectiveAllow
                  ? "Uncensored banter & explicit track commentary"
                  : "Clean Mode — explicit tracks filtered; FCC-safe DJ copy."}
            </span>
          </span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              effectiveAllow ? "bg-cyan-500" : "bg-zinc-700"
            }`}
            aria-hidden="true"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-zinc-950 shadow transition-transform ${
                effectiveAllow ? "left-5" : "left-0.5"
              }`}
            />
          </span>
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

/**
 * Host Settings Drawer selector for DJ break pace.
 * Free tier: only Natural Pace is selectable; Silent / Every Song / Long Breaks
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
      className="flex flex-col gap-1.5"
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
            className={optionCardClass(selected, locked)}
          >
            <span className="flex items-start gap-3">
              <span
                className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  selected ? "bg-cyan-400" : "bg-zinc-700"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-sans text-sm font-medium ${
                      selected ? "text-cyan-300" : "text-zinc-200"
                    }`}
                  >
                    {DJ_PACE_LABELS[pace]}
                  </span>
                  {proLocked ? <ProBadge /> : null}
                </span>
                <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                  {DJ_PACE_DESCRIPTIONS[pace]}
                </span>
              </span>
              {locked ? (
                <Lock
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/70"
                  aria-hidden="true"
                />
              ) : null}
            </span>
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
            className={optionCardClass(selected, locked)}
          >
            <span className="flex items-start gap-3">
              <span
                className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  selected ? "bg-cyan-400" : "bg-zinc-700"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-sans text-sm font-medium ${
                      selected ? "text-cyan-300" : "text-zinc-200"
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
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/70"
                  aria-hidden="true"
                />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type HostMoodSelectorProps = {
  /** When set, the pick is written to both global prefs and `stationConfigs[stationId]`. */
  stationId?: string;
  /** Fired when the listener changes mood (or opens the upgrade modal). */
  onInteract?: () => void;
  /** Keep session `DjTuningSettings` in sync with persisted prefs. */
  onChange?: (mood: DjMood) => void;
};

/**
 * Host Settings selector for vocal energy. Writes through `setDjMood` so the
 * pick survives a page refresh.
 */
export function HostMoodSelector({
  stationId,
  onInteract,
  onChange,
}: HostMoodSelectorProps = {}) {
  const { isPro, isFree, openUpgradeModal } = useTier();
  const { mood, getStationConfig, setDjMood } = useUserPreferences();
  const selected =
    (stationId ? getStationConfig(stationId)?.mood : undefined)
    ?? mood
    ?? DEFAULT_DJ_TUNING.mood;

  const applyMood = useCallback(
    (next: DjMood) => {
      setDjMood(next, stationId);
      onChange?.(next);
      onInteract?.();
    },
    [onChange, onInteract, setDjMood, stationId],
  );

  useEffect(() => {
    if (!isFree) return;
    if (selected === FREE_TIER_DJ_MOOD) return;
    applyMood(FREE_TIER_DJ_MOOD);
  }, [applyMood, isFree, selected]);

  const handleSelect = useCallback(
    (next: DjMood) => {
      if (PRO_DJ_MOODS.has(next) && !isPro) {
        openUpgradeModal();
        onInteract?.();
        return;
      }
      applyMood(next);
    },
    [applyMood, isPro, onInteract, openUpgradeModal],
  );

  return (
    <div role="group" aria-label="Host mood" className="flex flex-col gap-1.5">
      {DJ_MOOD_OPTIONS.map((option) => {
        const proLocked = PRO_DJ_MOODS.has(option);
        const locked = proLocked && !isPro;
        const isSelected = selected === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isSelected}
            aria-disabled={locked || undefined}
            onClick={() => handleSelect(option)}
            className={optionCardClass(isSelected, locked)}
          >
            <span className="flex items-start gap-3">
              <span
                className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  isSelected ? "bg-cyan-400" : "bg-zinc-700"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-sans text-sm font-medium ${
                      isSelected ? "text-cyan-300" : "text-zinc-200"
                    }`}
                  >
                    {DJ_MOOD_LABELS[option]}
                  </span>
                  {proLocked ? <ProBadge /> : null}
                </span>
                <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                  {DJ_MOOD_DESCRIPTIONS[option]}
                </span>
              </span>
              {locked ? (
                <Lock
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/70"
                  aria-hidden="true"
                />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type HostPersonalitySelectorProps = {
  /** When set, the pick is written to both global prefs and `stationConfigs[stationId]`. */
  stationId?: string;
  /** Fired when the listener changes personality (or opens the upgrade modal). */
  onInteract?: () => void;
  /** Keep session `DjTuningSettings` in sync with persisted prefs. */
  onChange?: (personality: DjPersonality) => void;
};

/**
 * Host Settings selector for personality colour. Writes through
 * `setDjPersonality` so the pick survives a page refresh.
 */
export function HostPersonalitySelector({
  stationId,
  onInteract,
  onChange,
}: HostPersonalitySelectorProps = {}) {
  const { isPro, isFree, openUpgradeModal } = useTier();
  const { personality, getStationConfig, setDjPersonality } = useUserPreferences();
  const selected =
    (stationId ? getStationConfig(stationId)?.personality : undefined)
    ?? personality
    ?? DEFAULT_DJ_TUNING.personality;

  const applyPersonality = useCallback(
    (next: DjPersonality) => {
      setDjPersonality(next, stationId);
      onChange?.(next);
      onInteract?.();
    },
    [onChange, onInteract, setDjPersonality, stationId],
  );

  useEffect(() => {
    if (!isFree) return;
    if (selected === FREE_TIER_DJ_PERSONALITY) return;
    applyPersonality(FREE_TIER_DJ_PERSONALITY);
  }, [applyPersonality, isFree, selected]);

  const handleSelect = useCallback(
    (next: DjPersonality) => {
      if (PRO_DJ_PERSONALITIES.has(next) && !isPro) {
        openUpgradeModal();
        onInteract?.();
        return;
      }
      applyPersonality(next);
    },
    [applyPersonality, isPro, onInteract, openUpgradeModal],
  );

  return (
    <div role="group" aria-label="Host personality" className="flex flex-col gap-1.5">
      {DJ_PERSONALITY_OPTIONS.map((option) => {
        const proLocked = PRO_DJ_PERSONALITIES.has(option);
        const locked = proLocked && !isPro;
        const isSelected = selected === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isSelected}
            aria-disabled={locked || undefined}
            onClick={() => handleSelect(option)}
            className={optionCardClass(isSelected, locked)}
          >
            <span className="flex items-start gap-3">
              <span
                className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  isSelected ? "bg-cyan-400" : "bg-zinc-700"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-sans text-sm font-medium ${
                      isSelected ? "text-cyan-300" : "text-zinc-200"
                    }`}
                  >
                    {DJ_PERSONALITY_LABELS[option]}
                  </span>
                  {proLocked ? <ProBadge /> : null}
                </span>
                <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                  {DJ_PERSONALITY_DESCRIPTIONS[option]}
                </span>
              </span>
              {locked ? (
                <Lock
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/70"
                  aria-hidden="true"
                />
              ) : null}
            </span>
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
  onStandardVoiceChange?: (voice: Extract<VoiceOption, "onyx" | "nova" | "echo">) => void;
};

/** Preview key for Studio audition — Pro persona id or OpenAI STANDARD voice id. */
type VoicePreviewKey = PersonaId | VoiceOption;

function VoiceAuditionButton({
  previewKey,
  label,
  isLoading,
  isPlaying,
  onToggle,
}: {
  previewKey: VoicePreviewKey;
  label: string;
  isLoading: boolean;
  isPlaying: boolean;
  onToggle: (id: VoicePreviewKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(previewKey);
      }}
      aria-label={
        isPlaying ? `Pause ${label} voice audition` : `Audition ${label} voice`
      }
      aria-pressed={isPlaying}
      title="Audition Voice"
      className={`m-1.5 flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-md border transition-colors ${
        isPlaying
          ? "border-accent/60 bg-accent/20 text-accent shadow-[0_0_12px_rgba(245,158,11,0.2)]"
          : isLoading
            ? "border-accent/30 bg-zinc-950/80 text-accent/80"
            : "border-white/[0.08] bg-zinc-950/70 text-zinc-400 hover:border-accent/40 hover:text-accent"
      }`}
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : isPlaying ? (
        <AudioLines className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
      ) : (
        <Play className="h-3.5 w-3.5 translate-x-px" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * TTS Voice / Persona selector for the Host Studio drawer.
 * Free: OpenAI STANDARD voices. Pro: named ElevenLabs / Cartesia hosts.
 * Audition play controls render on every card (free and Pro).
 */
export function HostVoicePersonaSelector({
  personaId,
  onPersonaChange,
  standardVoice = "onyx",
  onStandardVoiceChange,
}: HostVoicePersonaSelectorProps) {
  const { isPro, isFree, openUpgradeModal } = useTier();
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewRequestIdRef = useRef(0);
  const [previewKey, setPreviewKey] = useState<VoicePreviewKey | null>(null);
  const [previewStatus, setPreviewStatus] = useState<VoicePreviewStatus>("idle");

  const stopPreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPreviewKey(null);
    setPreviewStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      previewRequestIdRef.current += 1;
      const audio = previewAudioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      previewAudioRef.current = null;
    };
  }, []);

  const toggleVoicePreview = useCallback(
    async (id: VoicePreviewKey) => {
      if (previewKey === id && previewStatus === "playing") {
        stopPreview();
        return;
      }

      // Starting one preview always stops any other running sample.
      stopPreview();
      const requestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = requestId;
      setPreviewKey(id);
      setPreviewStatus("loading");

      try {
        const audio = previewAudioRef.current ?? new Audio();
        previewAudioRef.current = audio;
        audio.preload = "auto";
        audio.src = `/api/studio/voice-preview?personaId=${encodeURIComponent(id)}`;

        const clearWhenDone = () => {
          if (previewRequestIdRef.current !== requestId) return;
          setPreviewKey(null);
          setPreviewStatus("idle");
        };

        audio.onended = clearWhenDone;
        audio.onerror = () => {
          if (previewRequestIdRef.current !== requestId) return;
          console.warn("[voice-preview] Failed to play audition for", id);
          setPreviewKey(null);
          setPreviewStatus("idle");
        };

        await audio.play();
        if (previewRequestIdRef.current !== requestId) return;
        setPreviewStatus("playing");
      } catch (err) {
        if (previewRequestIdRef.current !== requestId) return;
        console.warn("[voice-preview] Audition play blocked or failed:", err);
        setPreviewKey(null);
        setPreviewStatus("idle");
      }
    },
    [previewKey, previewStatus, stopPreview],
  );

  const handleStandardSelect = (
    voice: Extract<VoiceOption, "onyx" | "nova" | "echo">,
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
            const isLoading =
              previewKey === voice.id && previewStatus === "loading";
            const isPlaying =
              previewKey === voice.id && previewStatus === "playing";

            return (
              <div
                key={voice.id}
                className={`flex items-stretch gap-1 rounded-lg border transition ${
                  selected
                    ? "border-cyan-500 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                    : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleStandardSelect(voice.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 p-3 text-left"
                >
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      selected ? "bg-cyan-400" : "bg-zinc-700"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-sans text-sm font-medium ${
                          selected ? "text-cyan-300" : "text-zinc-200"
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

                <VoiceAuditionButton
                  previewKey={voice.id}
                  label={voice.label}
                  isLoading={isLoading}
                  isPlaying={isPlaying}
                  onToggle={(id) => void toggleVoicePreview(id)}
                />
              </div>
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
            const uiName = getPersonaUiDisplayName(persona.id, persona.name);
            const isLoading =
              previewKey === persona.id && previewStatus === "loading";
            const isPlaying =
              previewKey === persona.id && previewStatus === "playing";

            return (
              <div
                key={persona.id}
                className={`flex items-stretch gap-1 rounded-lg border transition ${
                  selected
                    ? "border-cyan-500 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                    : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handlePersonaSelect(persona.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 p-3 text-left"
                >
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      selected ? "bg-cyan-400" : "bg-zinc-700"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-sans text-sm font-medium ${
                          selected ? "text-cyan-300" : "text-zinc-200"
                        }`}
                      >
                        {uiName}
                      </span>
                      <ProBadge />
                    </span>
                    <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                      {persona.tone}
                    </span>
                  </span>
                  {locked ? (
                    <Lock
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500/70"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>

                <VoiceAuditionButton
                  previewKey={persona.id}
                  label={uiName}
                  isLoading={isLoading}
                  isPlaying={isPlaying}
                  onToggle={(id) => void toggleVoicePreview(id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
