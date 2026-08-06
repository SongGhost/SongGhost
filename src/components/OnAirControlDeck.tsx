"use client";

import type { OrchestratorStatus } from "@/lib/player/webOrchestrator";

type OnAirControlDeckProps = {
  status: OrchestratorStatus;
  onBreakNow: () => void;
  onSkipDj: () => void;
  /** When false, Break Now is disabled (e.g. companion not connected). */
  canTriggerBreak?: boolean;
  className?: string;
};

type StatusBadge = {
  label: string;
  className: string;
};

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
      className={`flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 ${className}`}
      role="group"
      aria-label="On-air DJ controls"
    >
      <span
        className={`inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${badge.className}`}
        role="status"
        aria-live="polite"
      >
        {badge.label}
      </span>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onBreakNow}
          disabled={!canTriggerBreak || breakBusy}
          className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-all hover:border-amber-500/70 hover:bg-amber-500/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title="Force a DJ break on the current track"
        >
          🎙️ Break Now
        </button>
        <button
          type="button"
          onClick={onSkipDj}
          disabled={!skipEnabled}
          className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300 transition-all hover:border-amber-500/40 hover:text-amber-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          title="Abort the active or prefetching DJ break"
        >
          🔇 Skip DJ
        </button>
      </div>
    </div>
  );
}
