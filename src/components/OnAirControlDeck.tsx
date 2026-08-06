"use client";

import type { ReactNode } from "react";
import { Mic2 } from "lucide-react";
import type { OrchestratorStatus } from "@/lib/player/webOrchestrator";
import {
  DJ_KNOWLEDGE_LABELS,
  DJ_MOOD_LABELS,
  DJ_PACE_LABELS,
  DJ_PERSONALITY_LABELS,
  type DjTuningSettings,
} from "@/types/dj";

type OnAirControlDeckProps = {
  status: OrchestratorStatus;
  onBreakNow: () => void;
  onSkipDj: () => void;
  /** When false, Break Now is disabled (e.g. companion not connected). */
  canTriggerBreak?: boolean;
  /** Left-side slot — typically Active Host & Setting Tags. */
  leading?: ReactNode;
  className?: string;
};

type StatusBadge = {
  label: string;
  className: string;
};

const tagClass =
  "inline-flex rounded-md border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300";

const secondaryTagClass =
  "hidden rounded-md border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400 xs:inline-flex";

export type DjActiveSettingTagsProps = {
  personaName: string;
  tuning: DjTuningSettings;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
};

/**
 * Active Host + Tuning Console badges for the On-Air Studio Deck.
 * Silent pace collapses to a single SILENT STREAM badge.
 */
export function DjActiveSettingTags({
  personaName,
  tuning,
  onOpenSettings,
  settingsOpen = false,
}: DjActiveSettingTagsProps) {
  const silent = tuning.pace === "silent";

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-left transition-colors hover:border-amber-500/70 hover:bg-amber-500/20"
      aria-haspopup="dialog"
      aria-expanded={settingsOpen}
      aria-label="Open DJ studio settings"
      title="DJ Studio Settings"
    >
      <Mic2
        className="h-3.5 w-3.5 shrink-0 text-amber-300"
        aria-hidden="true"
      />
      <span className="inline-flex max-w-[10rem] truncate rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-200 sm:max-w-[14rem]">
        {personaName}
      </span>
      {silent ? (
        <span className={tagClass}>SILENT STREAM</span>
      ) : (
        <>
          <span className={tagClass}>{DJ_PACE_LABELS[tuning.pace]}</span>
          <span className={secondaryTagClass}>{DJ_MOOD_LABELS[tuning.mood]}</span>
          <span className={secondaryTagClass}>
            {DJ_PERSONALITY_LABELS[tuning.personality]}
          </span>
          <span className={secondaryTagClass}>
            {DJ_KNOWLEDGE_LABELS[tuning.knowledge]}
          </span>
        </>
      )}
    </button>
  );
}

function statusBadge(status: OrchestratorStatus): StatusBadge {
  switch (status) {
    case "PREFETCHING":
      return {
        label: "[ ⏳ Fetching Lore... ]",
        className:
          "border-amber-500/40 bg-amber-500/10 text-amber-300",
      };
    case "DUCKING":
    case "ON_AIR":
    case "RAMPING_UP":
      return {
        label: "[ 🔴 LIVE ON AIR ]",
        className:
          "border-red-500/60 bg-red-500/15 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.45)] animate-pulse",
      };
    case "STANDBY":
    default:
      return {
        label: "[ 🎙️ DJ Standby ]",
        className: "border-zinc-700 bg-zinc-900/80 text-zinc-400",
      };
  }
}

/**
 * Studio on-air strip: Duck–Talk–Swell status plus manual Break Now / Skip DJ.
 */
export default function OnAirControlDeck({
  status,
  onBreakNow,
  onSkipDj,
  canTriggerBreak = true,
  leading,
  className = "",
}: OnAirControlDeckProps) {
  const badge = statusBadge(status);
  const skipEnabled = status === "ON_AIR" || status === "PREFETCHING";
  const breakBusy =
    status === "ON_AIR" ||
    status === "DUCKING" ||
    status === "RAMPING_UP" ||
    status === "PREFETCHING";

  return (
    <div
      className={`flex flex-col items-stretch justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 sm:flex-row sm:items-center ${className}`}
      role="group"
      aria-label="On-air DJ controls"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {leading}
        <span
          className={`inline-flex w-fit shrink-0 items-center rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${badge.className}`}
          role="status"
          aria-live="polite"
        >
          {badge.label}
        </span>
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-1.5">
        <button
          type="button"
          onClick={onBreakNow}
          disabled={!canTriggerBreak || breakBusy}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-all hover:border-amber-500/70 hover:bg-amber-500/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          title="Force a DJ break on the current track"
        >
          🎙️ Break Now
        </button>
        <button
          type="button"
          onClick={onSkipDj}
          disabled={!skipEnabled}
          className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300 transition-all hover:border-amber-500/40 hover:text-amber-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          title="Abort the active or prefetching DJ break"
        >
          🔇 Skip DJ
        </button>
      </div>
    </div>
  );
}
