"use client";

import { useCallback, useEffect, useState } from "react";
import { useTier, type SubscriptionTier } from "@/context/TierContext";

/**
 * Floating Free/Pro switcher for local development and preview environments.
 * Visible when not production, or when enabled via env / localStorage / ?dev=true.
 */
export default function DevTierToggle() {
  const { tier, setTier } = useTier();
  const [toast, setToast] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const envEnabled = process.env.NEXT_PUBLIC_ENABLE_DEV_TOGGLE === "true";
    const storageEnabled =
      typeof window !== "undefined" &&
      window.localStorage.getItem("songhost_dev_mode") === "true";
    const queryEnabled =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("dev") === "true";

    setVisible(
      process.env.NODE_ENV !== "production" ||
        envEnabled ||
        storageEnabled ||
        queryEnabled,
    );
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
    <>
      {toast ? (
        <p
          role="status"
          className="fixed bottom-14 right-4 z-[100] rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-200 shadow-xl backdrop-blur-md"
        >
          {toast}
        </p>
      ) : null}
      <div className="fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-xs font-mono text-zinc-200 shadow-xl backdrop-blur-md">
        <button
          type="button"
          onClick={toggle}
          className={`inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest transition-colors ${
            tier === "pro"
              ? "text-accent hover:text-accent/80"
              : "text-emerald-300 hover:text-emerald-200"
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
    </>
  );
}
