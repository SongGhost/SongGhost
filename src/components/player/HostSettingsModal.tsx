"use client";

import { Check, Lock, Mic2, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useTier } from "@/context/TierContext";
import { BreaksUsageLabel } from "@/components/player/HostBar";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import {
  AllowExplicitContentToggle,
  BreakPaceSelector,
  CommentaryFormatSelector,
  HostVoicePersonaSelector,
  ProBadge,
  PRO_HOST_PERSONA_IDS,
  optionCardClass,
} from "@/components/player/HostBar";
import type { PersonaId } from "@/data/personas";
import { lockHost } from "@/lib/store/sessionStore";
import {
  DJ_MOOD_DESCRIPTIONS,
  DJ_MOOD_LABELS,
  DJ_MOOD_OPTIONS,
  DJ_PERSONALITY_DESCRIPTIONS,
  DJ_PERSONALITY_LABELS,
  DJ_PERSONALITY_OPTIONS,
  type DjKnowledge,
  type DjMood,
  type DjPace,
  type DjPersonality,
  type DjTuningSettings,
} from "@/types/dj";
import { MAX_VIBE_PROMPT_LENGTH, sanitizeVibePrompt } from "@/types/station";
import type { VoiceOption } from "@/types/voice";

export type HostSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  value: DjTuningSettings;
  onChange: (next: DjTuningSettings) => void;
  personaId: PersonaId;
  onPersonaChange: (personaId: PersonaId) => void;
  /** Optional custom host directives (Pro). Falls back to local draft when omitted. */
  customDirectives?: string;
  onCustomDirectivesChange?: (value: string) => void;
};

/** Free-tier defaults for Tuning Console colour / depth. */
const FREE_TIER_MOOD: DjMood = "even_keel";
const FREE_TIER_PERSONALITY: DjPersonality = "normal";
const FREE_TIER_KNOWLEDGE: DjKnowledge = "basic_facts";

/** Mood options gated behind Pro — Free may only use Even Keel. */
const PRO_MOODS = new Set<DjMood>(["chill", "hyped"]);

/** Personality colours gated behind Pro — Free may only use Normal. */
const PRO_PERSONALITIES = new Set<DjPersonality>([
  "kind",
  "dry",
  "sarcastic",
  "funny",
]);

/**
 * Host Studio settings — the single modal for host, pace, lore, mood,
 * personality, custom directives, and explicit content.
 */
export default function HostSettingsModal({
  open,
  onClose,
  value,
  onChange,
  personaId,
  onPersonaChange,
  customDirectives,
  onCustomDirectivesChange,
}: HostSettingsModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const { djVolume, setDjVolume } = useMusicSource();
  const {
    isPro,
    isFree,
    openUpgradeModal,
    closeUpgradeModal,
    upgradeModalOpen,
  } = useTier();
  const { preferredVoice, setPreferredVoice } = useUserPreferences();
  const djVolumePercent = Math.round(djVolume * 100);

  const [hasChanges, setHasChanges] = useState(false);
  const [localDirectives, setLocalDirectives] = useState("");
  const directivesControlled = onCustomDirectivesChange != null;
  const directivesValue = directivesControlled
    ? (customDirectives ?? "")
    : localDirectives;

  const markChanged = useCallback(() => setHasChanges(true), []);

  /** Explicit Host Studio edits lock the active host across station changes. */
  const markHostLocked = useCallback(() => {
    lockHost();
    markChanged();
  }, [markChanged]);

  const handleClose = useCallback(() => {
    setHasChanges(false);
    onClose();
  }, [onClose]);

  const patch = useCallback(
    <K extends keyof DjTuningSettings>(key: K, next: DjTuningSettings[K]) => {
      onChange({ ...value, [key]: next });
    },
    [onChange, value],
  );

  const requirePro = useCallback((): boolean => {
    if (isPro) return true;
    openUpgradeModal();
    return false;
  }, [isPro, openUpgradeModal]);

  const handleStandardVoiceChange = useCallback(
    (voice: Extract<VoiceOption, "onyx" | "nova" | "echo">) => {
      setPreferredVoice(voice);
      markHostLocked();
    },
    [markHostLocked, setPreferredVoice],
  );

  const handlePersonaChange = useCallback(
    (nextPersonaId: PersonaId) => {
      // Instant session stamp — page.tsx applies activeHostId + aborts in-flight
      // generate-script work so the next break uses this host (e.g. "miles").
      onPersonaChange(nextPersonaId);
      markHostLocked();
    },
    [markHostLocked, onPersonaChange],
  );

  const handleMoodSelect = useCallback(
    (mood: DjMood) => {
      if (PRO_MOODS.has(mood) && !requirePro()) return;
      patch("mood", mood);
      markHostLocked();
    },
    [markHostLocked, patch, requirePro],
  );

  const handlePersonalitySelect = useCallback(
    (personality: DjPersonality) => {
      if (PRO_PERSONALITIES.has(personality) && !requirePro()) return;
      patch("personality", personality);
      markHostLocked();
    },
    [markHostLocked, patch, requirePro],
  );

  const handleDirectivesChange = useCallback(
    (raw: string) => {
      if (!requirePro()) return;
      const next = raw.slice(0, MAX_VIBE_PROMPT_LENGTH);
      if (directivesControlled) {
        onCustomDirectivesChange?.(next);
      } else {
        setLocalDirectives(next);
      }
      markHostLocked();
    },
    [directivesControlled, markHostLocked, onCustomDirectivesChange, requirePro],
  );

  /** Free tier: snap Pro-only colour / depth back to the allowed defaults. */
  useEffect(() => {
    if (!isFree) return;
    const next: DjTuningSettings = {
      ...value,
      mood: FREE_TIER_MOOD,
      personality: FREE_TIER_PERSONALITY,
      knowledge: FREE_TIER_KNOWLEDGE,
    };
    if (
      value.mood === next.mood
      && value.personality === next.personality
      && value.knowledge === next.knowledge
    ) {
      return;
    }
    onChange(next);
  }, [isFree, onChange, value]);

  const handlePaceChange = useCallback(
    (pace: DjPace) => {
      patch("pace", pace);
      markHostLocked();
    },
    [markHostLocked, patch],
  );

  useEffect(() => {
    setHasChanges(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (upgradeModalOpen) {
          closeUpgradeModal();
          return;
        }
        handleClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose, upgradeModalOpen, closeUpgradeModal]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open || directivesControlled) return;
    setLocalDirectives(sanitizeVibePrompt(customDirectives ?? ""));
  }, [open, customDirectives, directivesControlled]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={handleClose}
          aria-label="Close Host Studio settings"
        />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="host-settings-title"
          tabIndex={-1}
          className="relative z-[71] flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-[#121215]/98 shadow-2xl outline-none backdrop-blur-md sm:rounded-2xl"
        >
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/[0.08] bg-[#121215]/95 px-4 py-4 backdrop-blur-md sm:px-6">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent/90">
                <Mic2 className="h-3 w-3" aria-hidden="true" />
                Host Studio
              </p>
              <h2
                id="host-settings-title"
                className="mt-1 font-sans text-base font-semibold text-zinc-100"
              >
                Host Settings
              </h2>
              <p className="mt-0.5 font-sans text-xs text-zinc-500">
                Pick the host, pace the break, colour the voice, and set how deep the lore goes.
              </p>
              <BreaksUsageLabel />
            </div>
            <button
              type="button"
              onClick={handleClose}
              className={`group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${
                hasChanges
                  ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)] hover:border-emerald-400"
                  : "border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
              title={hasChanges ? "Changes saved. Click to close." : "Close"}
              aria-label={hasChanges ? "Changes saved. Click to close." : "Close"}
            >
              {hasChanges ? (
                <Check className="h-4 w-4 animate-in zoom-in-75 duration-200" />
              ) : (
                <X className="h-4 w-4 transition-transform group-hover:scale-110" />
              )}
            </button>
          </header>

          <div className="overscroll-region flex-1 space-y-7 overflow-y-auto p-4 sm:p-6">
            {/* 1 · Select Host Persona */}
            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                1 · Select Host Persona
              </p>
              <HostVoicePersonaSelector
                personaId={personaId}
                onPersonaChange={handlePersonaChange}
                standardVoice={preferredVoice}
                onStandardVoiceChange={handleStandardVoiceChange}
              />
              {isFree && PRO_HOST_PERSONA_IDS.has(personaId) ? (
                <p className="mt-2 font-sans text-[11px] leading-snug text-zinc-500">
                  Free tier plays OpenAI STANDARD voices. Upgrade for named Pro hosts.
                </p>
              ) : null}
            </section>

            {/* 2 · Master DJ Voice Volume */}
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  2 · Master DJ Voice Volume
                </p>
                <span className="font-mono text-sm tabular-nums tracking-widest text-cyan-300">
                  {djVolumePercent}%
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3.5">
                <Volume2
                  className="h-5 w-5 shrink-0 text-cyan-400"
                  aria-hidden="true"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={djVolumePercent}
                  onChange={(e) => {
                    setDjVolume(Number(e.target.value) / 100);
                    markHostLocked();
                  }}
                  className="volume-range h-2 w-full cursor-pointer rounded-lg accent-cyan-500"
                  aria-label="Master DJ Voice Volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={djVolumePercent}
                  aria-valuetext={`${djVolumePercent} percent`}
                />
              </div>
              <p className="mt-2 font-sans text-[11px] leading-snug text-zinc-600">
                Levels the host voice over ducked music — independent of the main deck volume.
              </p>
            </section>

            {/* 3 · Pace (Break Frequency) */}
            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                3 · Pace (Break Frequency)
              </p>
              <BreakPaceSelector
                value={value.pace}
                onChange={handlePaceChange}
                onInteract={markHostLocked}
              />
              {isFree ? (
                <p className="mt-2 font-sans text-[11px] leading-snug text-zinc-500">
                  Free tier runs Natural Pace. Upgrade for Silent, Every Song, and Long Breaks.
                </p>
              ) : null}
            </section>

            {/* 4 · Lore & Commentary */}
            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                4 · Lore &amp; Commentary
              </p>
              <CommentaryFormatSelector onInteract={markHostLocked} />
            </section>

            {/* 5 · Mood & Vocal Energy */}
            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                5 · Mood &amp; Vocal Energy
              </p>
              <div
                role="group"
                aria-label="Host mood"
                className="flex flex-col gap-1.5"
              >
                {DJ_MOOD_OPTIONS.map((mood) => {
                  const proLocked = PRO_MOODS.has(mood);
                  const locked = proLocked && !isPro;
                  const selected = value.mood === mood;
                  return (
                    <button
                      key={mood}
                      type="button"
                      aria-pressed={selected}
                      aria-disabled={locked || undefined}
                      onClick={() => handleMoodSelect(mood)}
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
                              {DJ_MOOD_LABELS[mood]}
                            </span>
                            {proLocked ? <ProBadge /> : null}
                          </span>
                          <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                            {DJ_MOOD_DESCRIPTIONS[mood]}
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
            </section>

            {/* 6 · Personality & Tone */}
            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                6 · Personality &amp; Tone
              </p>
              <div
                role="group"
                aria-label="Host personality"
                className="flex flex-col gap-1.5"
              >
                {DJ_PERSONALITY_OPTIONS.map((personality) => {
                  const proLocked = PRO_PERSONALITIES.has(personality);
                  const locked = proLocked && !isPro;
                  const selected = value.personality === personality;
                  return (
                    <button
                      key={personality}
                      type="button"
                      aria-pressed={selected}
                      aria-disabled={locked || undefined}
                      onClick={() => handlePersonalitySelect(personality)}
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
                              {DJ_PERSONALITY_LABELS[personality]}
                            </span>
                            {proLocked ? <ProBadge /> : null}
                          </span>
                          <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                            {DJ_PERSONALITY_DESCRIPTIONS[personality]}
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
            </section>

            {/* 7 · Custom Directives & Explicit Toggle */}
            <section className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    7 · Custom Directives
                  </p>
                  <ProBadge />
                </div>
                <div className="relative">
                  <textarea
                    value={directivesValue}
                    onChange={(e) => handleDirectivesChange(e.target.value)}
                    onFocus={() => {
                      if (isFree) openUpgradeModal();
                    }}
                    readOnly={isFree}
                    rows={3}
                    maxLength={MAX_VIBE_PROMPT_LENGTH}
                    placeholder="Steer host topics, station IDs, or custom rules..."
                    className={`w-full resize-y rounded-lg border bg-slate-900/60 px-3 py-2.5 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-500/70 ${
                      isFree
                        ? "cursor-pointer border-slate-800"
                        : "border-slate-800"
                    }`}
                    aria-label="Custom host directives"
                  />
                  {isFree ? (
                    <button
                      type="button"
                      onClick={openUpgradeModal}
                      className="absolute inset-0 flex items-center justify-center rounded-lg bg-zinc-950/40"
                      aria-label="Unlock Custom Directives with Pro"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-cyan-300">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        Pro feature
                      </span>
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 font-sans text-[11px] leading-snug text-zinc-600">
                  Steer the host&apos;s tone and topics for this mix.
                  {directivesControlled || !isFree
                    ? ` ${directivesValue.length} / ${MAX_VIBE_PROMPT_LENGTH}`
                    : null}
                </p>
              </div>

              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  Allow Explicit Content
                </p>
                <AllowExplicitContentToggle onInteract={markHostLocked} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
