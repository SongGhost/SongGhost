"use client";

import { useState } from "react";

type UnsubscribeControlsProps = {
  initialOptedIn: boolean;
};

/**
 * Signed-in marketing preference controls. Persists via existing
 * POST /api/user/sync `{ marketingOptIn }` — does not add a new endpoint.
 */
export default function UnsubscribeControls({
  initialOptedIn,
}: UnsubscribeControlsProps) {
  const [optedIn, setOptedIn] = useState(initialOptedIn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setMarketingOptIn(value: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/user/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketingOptIn: value }),
      });
      if (!res.ok) {
        throw new Error("Could not update email preference.");
      }
      setOptedIn(value);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update email preference.",
      );
    } finally {
      setPending(false);
    }
  }

  const statusLabel = optedIn
    ? "Marketing email is on for this account."
    : "Marketing email is off for this account.";

  return (
    <div className="mt-8 space-y-4">
      <p
        className="font-sans text-sm leading-relaxed text-zinc-300"
        aria-live="polite"
      >
        {statusLabel}
      </p>

      <div className="flex flex-wrap gap-3">
        {optedIn ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void setMarketingOptIn(false)}
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving…" : "Turn off marketing email"}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => void setMarketingOptIn(true)}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/[0.12] bg-zinc-900/60 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-100 transition hover:border-accent/40 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving…" : "Opt in to marketing email"}
          </button>
        )}
      </div>

      {error ? (
        <p className="font-sans text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
