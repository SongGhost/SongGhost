"use client";

import { Check, Lock, Mic2, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useTier } from "@/context/TierContext";
import { BreaksUsageLabel } from "@/components/player/HostBar";
import { HostLiveActions } from "@/components/player/WebPlayer";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import {
  AllowExplicitContentToggle,
  BreakPaceSelector,
  CommentaryFormatSelector,
  HostMoodSelector,
  HostPersonalitySelector,
  HostVoicePersonaSelector,
  ProBadge,
  PRO_HOST_PERSONA_IDS,
} from "@/components/player/HostBar";
import type { PersonaId } from "@/data/personas";
import { lockHost } from "@/lib/store/sessionStore";
import type { OrchestratorStatus } from "@/lib/player/webOrchestrator";
import {
  DEFAULT_COMMENTARY_FORMAT,
  type DjKnowledge,
  type DjPace,
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
  /** Active station — mood/personality writes land on `stationConfigs[stationId]`. */
  stationId?: string;
  /** Optional custom host directives (Pro). Falls back to local draft when omitted. */
  customDirectives?: string;
  onCustomDirectivesChange?: (value: string) => void;
  /** Live DJ overrides — same handlers as ControlDeck / useWebOrchestrator. */
  onBreakNow?: () => void;
  onSkipDj?: () => void;
  orchestratorStatus?: OrchestratorStatus;
  canTriggerBreak?: boolean;
  isHostLocked?: boolean;
  companionActive?: boolean;
  hasCurrentTrack?: boolean;
};

/** Free-tier default / enforced knowledge depth. */
const FREE_TIER_KNOWLEDGE: DjKnowledge = "basic_facts";

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
  stationId,
  customDirectives,
  onCustomDirectivesChange,
  onBreakNow,
  onSkipDj,
  orchestratorStatus = "STANDBY",
  canTriggerBreak = false,
  isHostLocked = false,
  companionActive = false,
  hasCurrentTrack = false,
}: HostSettingsModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const { djVolume, setDjVolume } = useMusicSource();
  const {
    isPro,
    isFree,
    tier,
    openUpgradeModal,
    closeUpgradeModal,
    upgradeModalOpen,
  } = useTier();
  const {
    preferredVoice,
    setPreferredVoice,
    commentaryFormat,
    setCommentaryFormat,
  } = useUserPreferences();
  const djVolumePercent = Math.round(djVolume * 100);

  const [hasChanges, setHasChanges] = useState(false);
  const [localDirectives, setLocalDirectives] = useState("");
  const directivesControlled = onCustomDirectivesChange != null;
  const directivesValue = directivesControlled
    ? (customDirectives ?? "")
    : localDirectives;

  const markChanged = useCallback(() => setHasChanges(true), []);

  /** Explicit Host Studio edits lock the active host across station changes and
   * persist `songhost_is_host_locked` (+ current persona under
   * `songhost_active_host_id`) so refresh hydration retains the pick.
   */
  const markHostLocked = useCallback(() => {
    lockHost(personaId);
    markChanged();
  }, [markChanged, personaId]);

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
      // generate-script work so the next break uses this host (e.g. "jasper-reed").
      // Persist before React re-renders so a refresh mid-session restores Jasper.
      lockHost(nextPersonaId);
      onPersonaChange(nextPersonaId);
      markChanged();
    },
    [markChanged, onPersonaChange],
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

  /** Free tier: snap Pro-only knowledge depth back to the allowed default. */
  useEffect(() => {
    if (!isFree) return;
    if (value.knowledge === FREE_TIER_KNOWLEDGE) return;
    onChange({ ...value, knowledge: FREE_TIER_KNOWLEDGE });
  }, [isFree, onChange, value]);

  /** Free tier: snap Pro-only lore formats back to Standard, matching mood / personality. */
  useEffect(() => {
    if (tier !== "free") return;
    if (commentaryFormat === DEFAULT_COMMENTARY_FORMAT) return;
    setCommentaryFormat(DEFAULT_COMMENTARY_FORMAT);
  }, [tier, commentaryFormat, setCommentaryFormat]);

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
            {onBreakNow && onSkipDj ? (
              <section>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  Live Actions
                </p>
                <HostLiveActions
                  status={orchestratorStatus}
                  onBreakNow={onBreakNow}
                  onSkipDj={onSkipDj}
                  canTriggerBreak={canTriggerBreak}
                  companionActive={companionActive}
                  hasCurrentTrack={hasCurrentTrack}
                  silentPace={value.pace === "silent"}
                  isHostLocked={isHostLocked}
                />
              </section>
            ) : null}

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
              <HostMoodSelector
                stationId={stationId}
                onInteract={markHostLocked}
                onChange={(mood) => patch("mood", mood)}
              />
            </section>

            {/* 6 · Personality & Tone */}
            <section>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                6 · Personality &amp; Tone
              </p>
              <HostPersonalitySelector
                stationId={stationId}
                onInteract={markHostLocked}
                onChange={(personality) => patch("personality", personality)}
              />
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
