"use client";

import { useCallback, useEffect, useState } from "react";
import { useTier, type SubscriptionTier } from "@/context/TierContext";

/**
 * Floating Free/Pro switcher for local development.
 * Hidden in production builds unless `NEXT_PUBLIC_SHOW_DEV_TIER_TOGGLE=1`.
 */
export default function DevTierToggle() {
  const { tier, setTier } = useTier();
  const [toast, setToast] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showInProd = process.env.NEXT_PUBLIC_SHOW_DEV_TIER_TOGGLE === "1";
    setVisible(process.env.NODE_ENV !== "production" || showInProd);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const toggle = useCallback(() => {
    const next: SubscriptionTier = tier === "pro" ? "free" : "pro";
    setTier(next);
    setToast(`Switched to ${next === "pro" ? "PRO" : "FREE"} tier`);
  }, [setTier, tier]);

  if (!visible) return null;

  const label = tier === "pro" ? "PRO" : "FREE";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
      {toast ? (
        <p
          role="status"
          className="pointer-events-none rounded-md border border-white/10 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-200 shadow-lg backdrop-blur-sm"
        >
          {toast}
        </p>
      ) : null}
      <button
        type="button"
        onClick={toggle}
        className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest shadow-lg backdrop-blur-md transition-colors ${
          tier === "pro"
            ? "border-accent/50 bg-accent/15 text-accent hover:bg-accent/25"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
        }`}
        title="Developer tier override (toggles Free ↔ Pro)"
        aria-label={`Current tier ${label}. Tap to toggle.`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            tier === "pro" ? "bg-accent" : "bg-emerald-400"
          }`}
          aria-hidden="true"
        />
        {label}
      </button>
    </div>
  );
}
