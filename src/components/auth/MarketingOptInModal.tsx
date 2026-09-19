"use client";

import { Loader2, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type MarketingOptInModalProps = {
  open: boolean;
  /** Called after the ask is recorded (opt-in or skip) and the screen should close. */
  onDismissed: () => void;
};

async function persistMarketingAsk(optIn: boolean): Promise<boolean> {
  const askedAt = new Date().toISOString();
  const body: { marketingOptInAskedAt: string; marketingOptIn?: boolean } = {
    marketingOptInAskedAt: askedAt,
  };
  if (optIn) body.marketingOptIn = true;

  const res = await fetch("/api/user/sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/**
 * One-time post-sign-in marketing opt-in. Shown only when the server gate
 * (`marketingOptInAskedAt`) is still null. Visually distinct from guest onboarding.
 */
export default function MarketingOptInModal({
  open,
  onDismissed,
}: MarketingOptInModalProps) {
  const [optIn, setOptIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setOptIn(false);
    setPending(false);
    setError(null);
  }, [open]);

  if (!open || !mounted) return null;

  const submit = async (grant: boolean) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const ok = await persistMarketingAsk(grant);
      if (!ok) {
        setError("Could not save your choice. Please try again.");
        return;
      }
      onDismissed();
    } catch {
      setError("Could not save your choice. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#09090b]/92 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="marketing-optin-title"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(196,136,42,0.22), transparent 55%), radial-gradient(ellipse 50% 35% at 15% 90%, rgba(41,146,207,0.10), transparent 50%)",
        }}
      />

      <div className="relative w-full max-w-lg rounded-2xl border border-amber-500/30 bg-[#121214]/95 px-6 py-9 shadow-[0_0_48px_rgba(196,136,42,0.16)] sm:px-8">
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/35 bg-amber-950/30">
            <Mail className="h-7 w-7 text-amber-300" aria-hidden="true" />
          </div>
        </div>

        <h2
          id="marketing-optin-title"
          className="text-center font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl"
        >
          First dibs on new stations
        </h2>
        <p className="mx-auto mt-3 max-w-md text-center font-sans text-sm leading-relaxed text-zinc-400">
          Be the first to hear about new stations, drops, and listening features.
          We email rarely — never spam, never sell your address.
        </p>

        <label
          htmlFor="marketing-opt-in"
          className="mt-8 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-950/15 p-4 text-left font-sans text-sm leading-relaxed text-zinc-200"
        >
          <input
            id="marketing-opt-in"
            type="checkbox"
            checked={optIn}
            aria-checked={optIn}
            disabled={pending}
            onChange={(event) => setOptIn(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-zinc-900 accent-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          />
          <span>Yes — email me when there&apos;s something worth hearing.</span>
        </label>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => void submit(optIn)}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Continue
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void submit(false)}
            className="font-sans text-sm font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-zinc-200 hover:decoration-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skip for now
          </button>
        </div>

        {error ? (
          <p className="mt-4 text-center font-sans text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
