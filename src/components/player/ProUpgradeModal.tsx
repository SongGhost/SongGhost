"use client";

import {
  BookOpen,
  Headphones,
  Mic2,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createCheckoutSession } from "@/app/actions/stripe";
import { useTier } from "@/context/TierContext";

export type ProUpgradeModalProps = {
  /** Overrides TierContext when provided. */
  open?: boolean;
  onClose?: () => void;
};

const PRO_FEATURES = [
  {
    icon: Mic2,
    title: "Warm Radio Personalities",
    detail:
      "Unlock ElevenLabs & Cartesia natural voice hosts — Miles, Henry, Devon, Sloane, Kira, and Jasper.",
  },
  {
    icon: BookOpen,
    title: "Extended Director's Cut",
    detail:
      "Album liner notes, sample lineages (Roots & Branches), and historical scene intros (Sonic Time Capsule).",
  },
  {
    icon: Headphones,
    title: "Unlimited Lore Commentary",
    detail:
      "Unrestricted track trivia and station customization — host talk when the set needs it.",
  },
] as const;

/**
 * Paywall / upgrade pitch for SongGhost Pro ($9.99/mo).
 * Visibility is driven by TierContext (`upgradeModalOpen`) unless props override.
 */
export default function ProUpgradeModal({
  open: openProp,
  onClose: onCloseProp,
}: ProUpgradeModalProps = {}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const { upgradeModalOpen, closeUpgradeModal, setTier, isPro } = useTier();
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const open = openProp ?? upgradeModalOpen;
  const close = useCallback(() => {
    onCloseProp?.();
    closeUpgradeModal();
  }, [onCloseProp, closeUpgradeModal]);

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
    setError(null);
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (open && isPro) close();
  }, [open, isPro, close]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleUpgrade = () => {
    setError(null);
    startTransition(async () => {
      const result = await createCheckoutSession();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.mode === "dev") {
        setTier("pro");
        setToast("Dev mode — upgraded to Pro");
        close();
        return;
      }
      window.location.assign(result.url);
    });
  };

  if (!open) {
    return toast ? (
      <p
        role="status"
        className="pointer-events-none fixed bottom-20 right-4 z-[100] rounded-md border border-white/10 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-200 shadow-lg backdrop-blur-sm"
      >
        {toast}
      </p>
    ) : null;
  }

  return (
    <>
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
          className="relative z-[81] flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-accent/25 bg-surface/98 shadow-2xl outline-none backdrop-blur-md sm:rounded-2xl"
        >
          <header className="relative overflow-hidden border-b border-white/[0.08] px-5 py-5 sm:px-6">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(41,146,207,0.18),_transparent_65%)]"
              aria-hidden="true"
            />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent">
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
                  Warm hosts, Director&apos;s Cut lore, and unlimited commentary.
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
                  <p className="font-sans text-sm font-medium text-zinc-100">
                    {title}
                  </p>
                  <p className="mt-0.5 font-sans text-xs leading-snug text-zinc-500">
                    {detail}
                  </p>
                </div>
              </div>
            ))}
            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-sans text-xs text-red-300"
              >
                {error}
              </p>
            ) : null}
          </div>

          <footer className="space-y-2 border-t border-white/[0.08] px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-mono text-xs font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {isPending ? "Starting checkout…" : "Upgrade for $9.99/month"}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={isPending}
              className="w-full py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
            >
              Continue with Free Mode
            </button>
          </footer>
        </div>
      </div>

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
