"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  /** Bumped on soft reset so the session tree remounts without a full page reload. */
  resetKey: number;
};

/** Transient playback keys safe to drop on soft recovery (prefs / auth stay intact). */
const TRANSIENT_LOCAL_KEYS = ["songghost:session-queue"] as const;
const TRANSIENT_SESSION_KEYS = [
  "songghost:failed-youtube-ids",
  "songghost-listener-location",
] as const;

function clearNonFatalPlayerState(): void {
  if (typeof window === "undefined") return;

  try {
    for (const key of TRANSIENT_LOCAL_KEYS) {
      window.localStorage.removeItem(key);
    }
    // Starter-history buckets are variety hints, not user prefs — clear on re-tune.
    const localKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("songghost:starter-history:")) {
        localKeys.push(key);
      }
    }
    for (const key of localKeys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable (private mode / quota) — still remount.
  }

  try {
    for (const key of TRANSIENT_SESSION_KEYS) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Same as above.
  }
}

/**
 * Global client Error Boundary — catches uncaught render/state errors and offers
 * a soft "Station Recovering" re-tune without wiping the tab or auth session.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    resetKey: 0,
  };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught client error:", error, info.componentStack);
  }

  private handleReset = (): void => {
    clearNonFatalPlayerState();
    this.setState((prev) => ({
      hasError: false,
      resetKey: prev.resetKey + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-[40vh] items-center justify-center bg-[#09090b] px-4 py-10"
          role="alert"
        >
          <div className="w-full max-w-md border border-zinc-800/80 bg-[#0c0c0f] px-6 py-7 shadow-[0_0_40px_rgba(0,0,0,0.45)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-accent">
              Station Recovering
            </p>
            <h1 className="mt-3 font-sans text-xl font-semibold tracking-tight text-zinc-100">
              Signal dropped mid-broadcast
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              A client glitch interrupted the player. Clear transient queue state and
              re-tune without wiping your session.
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-6 w-full border border-accent/40 bg-accent/15 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-accent transition-colors hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Reset Player &amp; Re-tune
            </button>
          </div>
        </div>
      );
    }

    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
