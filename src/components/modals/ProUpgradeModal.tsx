"use client";

import {
  CloudSun,
  Headphones,
  Mic2,
  Radio,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { PRO_MONTHLY_BREAKS, useTier } from "@/context/TierContext";

export type ProUpgradeModalProps = {
  open: boolean;
  onClose: () => void;
};

const PRO_FEATURES = [
  {
    icon: Mic2,
    title: "Personal DJ",
    detail: "Names, local weather, and your city woven into every break.",
  },
  {
    icon: Headphones,
    title: "HD Voice Quality",
    detail: "Broadcast-grade voice engine for every host on the roster.",
  },
  {
    icon: Radio,
    title: "Unlimited Studio Mixes",
    detail: "Build and publish as many studio mixes as you want.",
  },
  {
    icon: CloudSun,
    title: `${PRO_MONTHLY_BREAKS} Monthly Breaks`,
    detail: "Ten× the Free allowance — host talk when the set needs it.",
  },
] as const;

/**
 * Paywall / trial pitch for SongGhost Pro ($9.99/mo).
 * Opened from Free-tier locks (premium hosts, HD voice, advanced tuning).
 */
export default function ProUpgradeModal({ open, onClose }: ProUpgradeModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const { startFreeTrial, isPro } = useTier();

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (open && isPro) close();
  }, [open, isPro, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={close}
        aria-label="Close Pro upgrade"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-upgrade-title"
        tabIndex={-1}
        className="relative z-[81] flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-accent/25 bg-[#121215]/98 shadow-2xl outline-none backdrop-blur-md sm:rounded-2xl"
      >
        <header className="relative overflow-hidden border-b border-white/[0.08] px-5 py-5 sm:px-6">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(41, 146, 207,0.18),_transparent_65%)]"
            aria-hidden="true"
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent/90">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                SongGhost Pro
              </p>
              <h2
                id="pro-upgrade-title"
                className="mt-1 font-sans text-xl font-semibold text-zinc-100"
              >
                Upgrade your booth
              </h2>
              <p className="mt-1 font-sans text-sm text-zinc-400">
                <span className="font-mono text-accent">$9.99</span>
                <span className="text-zinc-500">/mo</span>
                {" — "}personal hosts, HD voice, and room to talk.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-zinc-950/80 font-mono text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="overscroll-region flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
          {PRO_FEATURES.map(({ icon: Icon, title, detail }) => (
            <div
              key={title}
              className="flex gap-3 rounded-xl border border-white/[0.06] bg-zinc-950/50 px-3 py-3"
            >
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-sans text-sm font-medium text-zinc-100">{title}</p>
                <p className="mt-0.5 font-sans text-xs leading-snug text-zinc-500">
                  {detail}
                </p>
              </div>
            </div>
          ))}
        </div>

        <footer className="space-y-2 border-t border-white/[0.08] px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={startFreeTrial}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-mono text-xs font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover active:scale-[0.99]"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Start 7-Day Free Trial
          </button>
          <button
            type="button"
            onClick={close}
            className="w-full py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Stay on Free
          </button>
        </footer>
      </div>
    </div>
  );
}
