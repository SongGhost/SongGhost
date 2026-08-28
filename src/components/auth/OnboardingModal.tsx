"use client";

import { SignInButton } from "@clerk/nextjs";
import { Loader2, Radio, Sparkles, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Guest-only staging key. Authoritative consent lives on the `users` row after sign-in. */
const MARKETING_OPTIN_STORAGE_KEY = "songhost:marketing-optin";

function readStagedMarketingOptIn(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MARKETING_OPTIN_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Private mode / blocked storage — keep in-memory state only.
  }
  return null;
}

function stageMarketingOptIn(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      MARKETING_OPTIN_STORAGE_KEY,
      value ? "true" : "false",
    );
  } catch {
    // Staging is best-effort; sign-in persist still uses component state.
  }
}

function clearStagedMarketingOptIn(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MARKETING_OPTIN_STORAGE_KEY);
  } catch {
    // Ignore storage write failures.
  }
}

/** Persist consent on first `/api/user/sync` after sign-in. No email is sent. */
async function persistMarketingOptIn(value: boolean): Promise<void> {
  try {
    const res = await fetch("/api/user/sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketingOptIn: value }),
    });
    if (res.ok) clearStagedMarketingOptIn();
  } catch {
    // Keep the staged localStorage value so a later sign-in can retry.
  }
}

export type OnboardingModalProps = {
  open: boolean;
  /** Clerk session is present. */
  isSignedIn: boolean;
  /** Spotify access token is available. */
  isSpotifyConnected: boolean;
  /** True while a Spotify OAuth redirect is starting. */
  isConnectingSpotify?: boolean;
  onConnectSpotify: () => void;
  /**
   * Highlight step 1 (account) or 2 (Spotify). Defaults to the next incomplete
   * step from auth state.
   */
  targetStep?: 1 | 2;
  /** Dismiss without completing onboarding — return to guest listening. */
  onContinueAsGuest?: () => void;
};

/**
 * Soft onboarding gate: SongHost account (Clerk) + Spotify Premium connection.
 * Opened from action-based prompts; guests can dismiss and keep listening.
 */
export default function OnboardingModal({
  open,
  isSignedIn,
  isSpotifyConnected,
  isConnectingSpotify = false,
  onConnectSpotify,
  targetStep,
  onContinueAsGuest,
}: OnboardingModalProps) {
  const [mounted, setMounted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const persistedConsentRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    if (readStagedMarketingOptIn() === true) setMarketingOptIn(true);
  }, []);

  const handleMarketingOptInChange = (next: boolean) => {
    setMarketingOptIn(next);
    stageMarketingOptIn(next);
  };

  // Auto-dismiss once the account step is complete. DirectStream hard-lock:
  // do not wait on Spotify Premium before closing the boot modal.
  // Persist the onboarding checkbox (or staged guest value) on first sign-in.
  useEffect(() => {
    if (!open || !isSignedIn) return;
    if (!persistedConsentRef.current) {
      persistedConsentRef.current = true;
      const staged = readStagedMarketingOptIn();
      const value = staged ?? marketingOptIn;
      stageMarketingOptIn(value);
      void persistMarketingOptIn(value);
    }
    onContinueAsGuest?.();
  }, [open, isSignedIn, marketingOptIn, onContinueAsGuest]);

  // Carry a guest opt-in forward if they skip and sign in later (banner, etc.).
  useEffect(() => {
    if (!isSignedIn || open) return;
    if (persistedConsentRef.current) return;
    if (readStagedMarketingOptIn() !== true) return;
    persistedConsentRef.current = true;
    void persistMarketingOptIn(true);
  }, [isSignedIn, open]);

  if (!open || !mounted) return null;

  const step = targetStep ?? 1;
  const showSpotifyStep = targetStep === 2;
  const showSpotifyConnect = showSpotifyStep && !isSpotifyConnected;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#09090b]/92 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(41,146,207,0.22), transparent 55%), radial-gradient(ellipse 50% 35% at 85% 90%, rgba(29,185,84,0.12), transparent 50%)",
        }}
      />

      <div className="relative w-full max-w-lg rounded-2xl border border-accent/30 bg-[#121214]/95 px-6 py-9 shadow-[0_0_48px_rgba(41,146,207,0.14)] sm:px-8">
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/35 bg-accent/10">
            <Radio className="h-7 w-7 text-accent" aria-hidden="true" />
          </div>
        </div>

        <h2
          id="onboarding-title"
          className="text-center font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl"
        >
          Tune in to SongHost
        </h2>
        <p className="mx-auto mt-3 max-w-md text-center font-sans text-sm leading-relaxed text-zinc-400">
          Create a SongHost account to sync memory presets, saved stations, and
          listening prefs across devices.
        </p>

        <ol className="mt-8 space-y-3">
          <li
            className={`rounded-xl border p-4 transition-colors ${
              step === 1
                ? "border-accent/45 bg-accent/10"
                : isSignedIn
                  ? "border-emerald-500/30 bg-emerald-950/20"
                  : "border-white/[0.08] bg-zinc-900/40"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                  isSignedIn
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-accent/20 text-accent"
                }`}
              >
                {isSignedIn ? "✓" : "1"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-sans text-sm font-semibold text-zinc-100">
                  <UserRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  Create your SongHost account
                </p>
                <p className="mt-1 font-sans text-xs leading-relaxed text-zinc-400">
                  Sync memory presets, saved stations, and listening prefs across
                  devices — your dials travel with you.
                </p>
                {!isSignedIn && (
                  <div className="mt-3">
                    <SignInButton mode="modal">
                      <button
                        type="button"
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-accent px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-accent-hover sm:w-auto"
                        onClick={() => stageMarketingOptIn(marketingOptIn)}
                      >
                        Sign in / Sign up
                      </button>
                    </SignInButton>
                  </div>
                )}
              </div>
            </div>
          </li>

          {showSpotifyStep && (
          <li
            className={`rounded-xl border p-4 transition-colors ${
              step === 2
                ? "border-[#1DB954]/50 bg-[#1DB954]/10"
                : isSpotifyConnected
                  ? "border-emerald-500/30 bg-emerald-950/20"
                  : "border-white/[0.08] bg-zinc-900/40 opacity-80"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                  isSpotifyConnected
                    ? "bg-emerald-500/20 text-emerald-400"
                    : step === 2
                      ? "bg-[#1DB954]/25 text-[#1DB954]"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {isSpotifyConnected ? "✓" : "2"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-sans text-sm font-semibold text-zinc-100">
                  <Sparkles className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                  Connect Spotify Premium
                </p>
                <p className="mt-1 font-sans text-xs leading-relaxed text-zinc-400">
                  Power Your Heavy Rotation from real listening history and stream
                  full tracks through Spotify Connect / Web Playback.
                </p>
                {showSpotifyConnect && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      disabled={isConnectingSpotify}
                      onClick={onConnectSpotify}
                      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1DB954] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-[#1ed760] disabled:opacity-60 sm:w-auto"
                    >
                      {isConnectingSpotify ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">🟢</span>
                      )}
                      Connect Spotify
                    </button>
                    <button
                      type="button"
                      disabled
                      className="inline-flex min-h-10 w-full cursor-not-allowed items-center justify-center rounded-lg border border-white/[0.1] bg-zinc-900/60 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 sm:w-auto"
                      title="Apple Music support is coming soon"
                    >
                      Apple Music — Coming Soon
                    </button>
                  </div>
                )}
              </div>
            </div>
          </li>
          )}
        </ol>

        <div className="mt-6">
          <label
            htmlFor="marketing-opt-in"
            className="flex cursor-pointer items-start gap-3 text-left font-sans text-sm leading-relaxed text-zinc-300"
          >
            <input
              id="marketing-opt-in"
              type="checkbox"
              checked={marketingOptIn}
              aria-checked={marketingOptIn}
              onChange={(event) => handleMarketingOptInChange(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-zinc-900 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <span>Email me about new stations and SongHost news.</span>
          </label>
        </div>

        {onContinueAsGuest && (
          <div className="mt-8 border-t border-white/[0.06] pt-5 text-center">
            <button
              type="button"
              onClick={() => {
                stageMarketingOptIn(marketingOptIn);
                onContinueAsGuest();
              }}
              className="font-sans text-base font-medium text-zinc-200 underline decoration-zinc-500 underline-offset-4 transition-colors hover:text-white hover:decoration-accent"
            >
              Skip &amp; Continue as Guest
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
