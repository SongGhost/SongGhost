"use client";

import type { ReactNode } from "react";
import { Mic2 } from "lucide-react";
import type { OrchestratorStatus } from "@/lib/player/webOrchestrator";
import {
  DJ_KNOWLEDGE_LABELS,
  DJ_PACE_LABELS,
  type DjTuningSettings,
} from "@/types/dj";

export type HostBarProps = {
  personaName: string;
  tuning: DjTuningSettings;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  status: OrchestratorStatus;
  onBreakNow: () => void;
  onSkipDj: () => void;
  canTriggerBreak?: boolean;
  /** Extra controls on the right (e.g. Drive Mode). */
  trailing?: ReactNode;
  className?: string;
};

function statusLabel(status: OrchestratorStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "PREFETCHING":
      return {
        label: "Fetching",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
      };
    case "DUCKING":
    case "ON_AIR":
    case "RAMPING_UP":
      return {
        label: "Live",
        className:
          "border-red-500/50 bg-red-500/15 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.35)]",
      };
    case "STANDBY":
    default:
      return {
        label: "Standby",
        className: "border-white/10 bg-zinc-950/60 text-zinc-500",
      };
  }
}

/**
 * Persistent Host Studio strip inside the player — the single entry point for
 * host / pace / lore settings. Opens {@link HostSettingsModal}.
 */
export default function HostBar({
  personaName,
  tuning,
  onOpenSettings,
  settingsOpen = false,
  status,
  onBreakNow,
  onSkipDj,
  canTriggerBreak = true,
  trailing,
  className = "",
}: HostBarProps) {
  const silent = tuning.pace === "silent";
  const badge = statusLabel(status);
  const skipEnabled = status === "ON_AIR" || status === "PREFETCHING";
  const breakBusy =
    status === "ON_AIR" ||
    status === "DUCKING" ||
    status === "RAMPING_UP" ||
    status === "PREFETCHING";

  const summary = silent
    ? `${personaName.toUpperCase()} • SILENT`
    : `${personaName.toUpperCase()} • ${DJ_PACE_LABELS[tuning.pace]} • ${DJ_KNOWLEDGE_LABELS[tuning.knowledge]}`;

  return (
    <div
      className={[
        "flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-[#121215]/90 px-3 py-2.5 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:gap-3",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label="Host Studio"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600 sm:inline">
          Host Studio
        </span>

        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-left transition-colors hover:border-amber-500/60 hover:bg-amber-500/15"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-label="Open Host Studio settings"
          title="Host Studio settings"
        >
          <Mic2 className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
          <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-200">
            [ {summary} ]
          </span>
        </button>

        <span
          className={`inline-flex shrink-0 items-center rounded-md border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider ${badge.className}`}
          role="status"
          aria-live="polite"
        >
          {badge.label}
        </span>
      </div>

      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <button
          type="button"
          onClick={onBreakNow}
          disabled={!canTriggerBreak || breakBusy}
          className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-amber-500/45 bg-amber-500/15 px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-all hover:border-amber-500/70 hover:bg-amber-500/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          title="Force a host break on the current track"
        >
          Break Now
        </button>
        <button
          type="button"
          onClick={onSkipDj}
          disabled={!skipEnabled}
          className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-white/[0.08] bg-zinc-950/80 px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition-all hover:border-amber-500/35 hover:text-amber-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          title="Abort the active or prefetching host break"
        >
          Skip Host
        </button>
        {trailing}
      </div>
    </div>
  );
}
