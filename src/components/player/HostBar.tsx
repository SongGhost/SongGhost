"use client";

import { AudioLines, Loader2, Lock, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPersonaById, PERSONAS, type PersonaId } from "@/data/personas";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { getPersonaUiDisplayName } from "@/lib/dj/personaConfig";
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

type VoicePreviewStatus = "idle" | "loading" | "playing";

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
 * Pill UI uppercases the result (`ONYX`, `SLOANE`, …). Persona hosts use first names only.
 */
const VOICE_ID_DISPLAY_NAMES: Record<string, string> = {
  onyx: "Onyx",
  echo: "Echo",
  alloy: "Alloy",
  fable: "Fable",
  nova: "Nova",
  shimmer: "Shimmer",
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
    if (persona) return getPersonaUiDisplayName(persona.id, persona.name);
    return getPersonaUiDisplayName(personaId);
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
            const isLoading =
              previewKey === voice.id && previewStatus === "loading";
            const isPlaying =
              previewKey === voice.id && previewStatus === "playing";

            return (
              <div
                key={voice.id}
                className={`flex items-stretch gap-1 rounded-lg border transition-colors ${
                  selected
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-white/[0.08] bg-zinc-950/50"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleStandardSelect(voice.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/80"
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
                className={`flex items-stretch gap-1 rounded-lg border transition-colors ${
                  selected
                    ? "border-accent/50 bg-accent/10"
                    : locked
                      ? "border-white/[0.06] bg-zinc-950/40"
                      : "border-white/[0.08] bg-zinc-950/50"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handlePersonaSelect(persona.id)}
                  className={`flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                    locked
                      ? "hover:bg-accent/5"
                      : "hover:bg-zinc-900/80"
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
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/70"
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
