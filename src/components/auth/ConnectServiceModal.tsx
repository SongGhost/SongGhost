"use client";

import { Loader2, Radio } from "lucide-react";
import type { ReactNode } from "react";

export type ConnectServiceModalProps = {
  /** Station headline shown above the connect prompt. */
  heroTitle: string;
  /** Optional cover art URL for the shared station. */
  albumArt?: string | null;
  /** True while a provider connect request is in flight. */
  isConnecting: boolean;
  onConnectSpotify: () => void;
  onConnectApple: () => void;
  /** Optional “Save to My Radio” / sign-in control. */
  saveAction?: ReactNode;
  /** Shown when the visitor indicates they have no paid streaming account. */
  onNoAccount?: () => void;
};

/**
 * Guest connect gate for shared `/s/[id]` links without an active
 * Spotify Premium or Apple Music session.
 */
export default function ConnectServiceModal({
  heroTitle,
  albumArt = null,
  isConnecting,
  onConnectSpotify,
  onConnectApple,
  saveAction,
  onNoAccount,
}: ConnectServiceModalProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#09090b] px-4 text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-90"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(41, 146, 207,0.22), transparent 55%), radial-gradient(ellipse 50% 35% at 15% 90%, rgba(39,39,42,0.85), transparent 50%)",
        }}
      />
      <main className="relative mx-auto w-full max-w-lg rounded-2xl border border-accent/25 bg-[#121214]/95 px-6 py-10 text-center shadow-[0_0_48px_rgba(41, 146, 207,0.12)] sm:px-8">
        <div className="mb-6 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-950/20 px-3 py-1 text-xs text-amber-300">
            <span>
              Requires active Spotify Premium or Apple Music account for full
              playback
            </span>
          </div>
        </div>

        {albumArt ? (
          <div
            className="mx-auto mb-8 h-40 w-40 overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900 shadow-[0_0_56px_rgba(41, 146, 207,0.18)]"
            style={{
              backgroundImage: `url(${albumArt})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            aria-hidden="true"
          />
        ) : (
          <div className="mx-auto mb-8 flex h-40 w-40 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10">
            <Radio className="h-10 w-10 text-accent" aria-hidden="true" />
          </div>
        )}

        <h1 className="font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl sm:leading-snug">
          {heroTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-md font-sans text-base leading-relaxed text-zinc-400">
          SongHost streams audio directly through your preferred provider. A
          Spotify Premium or Apple Music subscription is required for full-length
          playback.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            disabled={isConnecting}
            onClick={onConnectSpotify}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#1DB954] px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-[#1ed760] disabled:opacity-60"
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">🟢</span>
            )}
            Connect Spotify Premium
          </button>
          <button
            type="button"
            disabled={isConnecting}
            onClick={onConnectApple}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/15 bg-zinc-100 px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-white disabled:opacity-60"
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">🍎</span>
            )}
            Connect Apple Music
          </button>
        </div>

        <div className="mt-6 flex flex-col items-center gap-4">
          {saveAction}
          {onNoAccount ? (
            <button
              type="button"
              onClick={onNoAccount}
              className="font-mono text-[11px] text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline"
            >
              I don&apos;t have a paid streaming account
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
