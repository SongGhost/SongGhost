"use client";

import { Lock, Mic2, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useTier } from "@/context/TierContext";
import ProUpgradeModal from "@/components/modals/ProUpgradeModal";
import { PERSONAS, type PersonaId } from "@/data/personas";
import {
  DJ_KNOWLEDGE_LABELS,
  DJ_KNOWLEDGE_OPTIONS,
  DJ_MOOD_LABELS,
  DJ_MOOD_OPTIONS,
  DJ_PACE_LABELS,
  DJ_PACE_OPTIONS,
  DJ_PERSONALITY_LABELS,
  DJ_PERSONALITY_OPTIONS,
  type DjPersonality,
  type DjTuningSettings,
} from "@/types/dj";
import { MAX_VIBE_PROMPT_LENGTH, sanitizeVibePrompt } from "@/types/station";

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

/** Premium hosts gated behind SongGhost Pro. */
const PRO_PERSONA_IDS = new Set<PersonaId>(["devon-pulse", "johnny-static"]);

/** Advanced personality colour gated behind Pro. */
const PRO_PERSONALITIES = new Set<DjPersonality>(["sarcastic"]);

const segmentBtn = (selected: boolean) =>
  `rounded-md px-2 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
    selected
      ? "bg-accent/20 text-accent ring-1 ring-accent/50"
      : "bg-[#121215] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
  }`;

const chipBtn = (selected: boolean) =>
  `rounded-full border px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
    selected
      ? "border-accent/60 bg-accent/15 text-accent"
      : "border-white/[0.08] bg-[#121215] text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
  }`;

function ProBadge() {
  return (
    <span className="inline-flex items-center rounded border border-accent/45 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-accent">
      PRO
    </span>
  );
}

function personalityLabel(personality: DjPersonality): string {
  if (personality === "sarcastic") return "SARCASTIC CRITIC";
  return DJ_PERSONALITY_LABELS[personality];
}

/**
 * Host Studio settings — the single modal for host, pace, mood,
 * personality, and knowledge depth.
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
    hdVoiceEnabled,
    setHdVoiceEnabled,
    openUpgradeModal,
    closeUpgradeModal,
    upgradeModalOpen,
    breaksUsed,
    breaksLimit,
  } = useTier();
  const voiceDisabled = value.pace === "silent";
  const djVolumePercent = Math.round(djVolume * 100);

  const [localDirectives, setLocalDirectives] = useState("");
  const directivesControlled = onCustomDirectivesChange != null;
  const directivesValue = directivesControlled
    ? (customDirectives ?? "")
    : localDirectives;

  const close = useCallback(() => onClose(), [onClose]);

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

  const handlePersonaSelect = useCallback(
    (id: PersonaId) => {
      if (PRO_PERSONA_IDS.has(id) && !requirePro()) return;
      onPersonaChange(id);
    },
    [onPersonaChange, requirePro],
  );

  const handlePersonalitySelect = useCallback(
    (personality: DjPersonality) => {
      if (PRO_PERSONALITIES.has(personality) && !requirePro()) return;
      patch("personality", personality);
    },
    [patch, requirePro],
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
    },
    [directivesControlled, onCustomDirectivesChange, requirePro],
  );

  const handleHdToggle = useCallback(() => {
    if (isFree) {
      openUpgradeModal();
      return;
    }
    setHdVoiceEnabled(!hdVoiceEnabled);
  }, [hdVoiceEnabled, isFree, openUpgradeModal, setHdVoiceEnabled]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (upgradeModalOpen) {
          closeUpgradeModal();
          return;
        }
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close, upgradeModalOpen, closeUpgradeModal]);

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
          onClick={close}
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
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                Breaks {breaksUsed}/{breaksLimit} this month
                {isFree ? " · Free" : " · Pro"}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-zinc-950/80 font-mono text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Close"
            >
              <span className="sr-only">Close</span>
              <span aria-hidden="true" className="flex items-center gap-1">
                [ <X className="h-3.5 w-3.5" /> ]
              </span>
            </button>
          </header>

          <div className="overscroll-region flex-1 space-y-7 overflow-y-auto p-4 sm:p-6">
            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                1 · Host
              </p>
              <div
                role="group"
                aria-label="Host selection"
                className="flex flex-col gap-1.5"
              >
                {PERSONAS.map((persona) => {
                  const proLocked = PRO_PERSONA_IDS.has(persona.id);
                  const selected = personaId === persona.id;
                  return (
                    <button
                      key={persona.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handlePersonaSelect(persona.id)}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? "border-accent/50 bg-accent/10"
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
                            {persona.name}
                          </span>
                          {proLocked ? <ProBadge /> : null}
                        </span>
                        <span className="mt-0.5 block font-sans text-[11px] leading-snug text-zinc-500">
                          {persona.tone}
                        </span>
                      </span>
                      {proLocked && isFree ? (
                        <Lock
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/70"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  HD Broadcast Voice Engine
                </p>
                <ProBadge />
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hdVoiceEnabled}
                onClick={handleHdToggle}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                  hdVoiceEnabled
                    ? "border-accent/50 bg-accent/10"
                    : "border-white/[0.08] bg-zinc-950/50 hover:border-zinc-600"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-sans text-sm text-zinc-200">
                    Broadcast-grade host voice
                  </span>
                  <span className="mt-0.5 block font-sans text-[11px] text-zinc-500">
                    {isFree
                      ? "Pro unlocks the HD voice engine."
                      : hdVoiceEnabled
                        ? "HD voice engine is on."
                        : "Tap to enable HD voice."}
                  </span>
                </span>
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    hdVoiceEnabled ? "bg-accent" : "bg-zinc-700"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-zinc-950 shadow transition-transform ${
                      hdVoiceEnabled ? "left-5" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </section>

            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                2 · Pace
              </p>
              <div
                role="group"
                aria-label="Host pace"
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {DJ_PACE_OPTIONS.map((pace) => (
                  <button
                    key={pace}
                    type="button"
                    aria-pressed={value.pace === pace}
                    onClick={() => patch("pace", pace)}
                    className={segmentBtn(value.pace === pace)}
                  >
                    {DJ_PACE_LABELS[pace]}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  DJ Voice Volume
                </p>
                <span className="font-mono text-[10px] tabular-nums tracking-widest text-accent/90">
                  {djVolumePercent}%
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-zinc-950/50 px-3 py-3">
                <Volume2
                  className="h-4 w-4 shrink-0 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={djVolumePercent}
                  onChange={(e) => setDjVolume(Number(e.target.value) / 100)}
                  className="volume-range h-1.5 w-full rounded-lg accent-accent"
                  aria-label="DJ Voice Volume"
                />
              </div>
              <p className="mt-2 font-sans text-[11px] leading-snug text-zinc-600">
                Levels the host voice over ducked music — independent of the main deck volume.
              </p>
            </section>

            {voiceDisabled ? (
              <p className="rounded-lg border border-white/[0.08] bg-zinc-950/40 px-3 py-3 font-sans text-xs leading-snug text-zinc-500">
                Host commentary is disabled.
              </p>
            ) : (
              <>
                <section>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    3 · Mood · Vocal Energy
                  </p>
                  <div
                    role="group"
                    aria-label="Host mood"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                  >
                    {DJ_MOOD_OPTIONS.map((mood) => (
                      <button
                        key={mood}
                        type="button"
                        aria-pressed={value.mood === mood}
                        onClick={() => patch("mood", mood)}
                        className={chipBtn(value.mood === mood)}
                      >
                        {DJ_MOOD_LABELS[mood]}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    4 · Personality
                  </p>
                  <div
                    role="group"
                    aria-label="Host personality"
                    className="flex flex-wrap gap-2"
                  >
                    {DJ_PERSONALITY_OPTIONS.map((personality) => {
                      const proLocked = PRO_PERSONALITIES.has(personality);
                      const selected = value.personality === personality;
                      return (
                        <button
                          key={personality}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => handlePersonalitySelect(personality)}
                          className={`${chipBtn(selected)} inline-flex items-center gap-1.5`}
                        >
                          {personalityLabel(personality)}
                          {proLocked ? <ProBadge /> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                      Custom Directives
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
                      placeholder={
                        isFree
                          ? "Pro unlocks custom host directives…"
                          : "Optional tone notes for this session…"
                      }
                      className={`w-full resize-y rounded-lg border bg-zinc-950/50 px-3 py-2.5 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent/70 ${
                        isFree
                          ? "cursor-pointer border-accent/25"
                          : "border-white/[0.08]"
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
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-accent">
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
                </section>

                <section>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    5 · Knowledge
                  </p>
                  <div
                    role="group"
                    aria-label="Host knowledge depth"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                  >
                    {DJ_KNOWLEDGE_OPTIONS.map((knowledge) => (
                      <button
                        key={knowledge}
                        type="button"
                        aria-pressed={value.knowledge === knowledge}
                        onClick={() => patch("knowledge", knowledge)}
                        className={segmentBtn(value.knowledge === knowledge)}
                      >
                        {DJ_KNOWLEDGE_LABELS[knowledge]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 font-sans text-[11px] leading-snug text-zinc-600">
                    {value.knowledge === "basic_facts"
                      ? "Title, artist, and light chart context — no deep trivia."
                      : value.knowledge === "genius"
                        ? "Studio lore, producer techniques, rare B-side trivia."
                        : "One solid verified fact without digging into deep cuts."}
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      <ProUpgradeModal open={upgradeModalOpen} onClose={closeUpgradeModal} />
    </>
  );
}
