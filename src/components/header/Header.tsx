"use client";

import { AudioLines, Link2, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import MusicSourceModal from "@/components/player/MusicSourceModal";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useTier, type SubscriptionTier } from "@/context/TierContext";

/** localStorage flag for the development-only YouTube full-song transport override. */
export const STORAGE_YOUTUBE_FALLBACK = "songhost_youtube_fallback";

const DEV_TRANSPORT_TOGGLE_ENABLED =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_TOGGLE === "true";

/** True when the Full Songs (Dev) chrome may render and honor `youtubeFallback`. */
export function isDevTransportToggleEnabled(): boolean {
  return DEV_TRANSPORT_TOGGLE_ENABLED;
}

/** Read the client Dev Mode YouTube fallback flag. Always false in production builds. */
export function readYoutubeFallbackEnabled(): boolean {
  if (!DEV_TRANSPORT_TOGGLE_ENABLED) return false;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_YOUTUBE_FALLBACK) === "true";
  } catch {
    return false;
  }
}

/**
 * High-visibility Free / Pro testing badge for the top header chrome.
 * Click toggles local `isPro` via TierContext for instant Free vs Pro checks.
 * In development, a sibling "Full Songs (Dev)" toggle stamps `youtubeFallback`
 * onto Song Radio launches for iframe DJ-timing tests.
 */
export function DevTierBadge({ className = "" }: { className?: string }) {
  const { isPro, setTier } = useTier();
  const [youtubeFallback, setYoutubeFallback] = useState(false);

  useEffect(() => {
    setYoutubeFallback(readYoutubeFallbackEnabled());
  }, []);

  const toggle = useCallback(() => {
    const next: SubscriptionTier = isPro ? "free" : "pro";
    setTier(next);
  }, [isPro, setTier]);

  const toggleYoutubeFallback = useCallback(() => {
    setYoutubeFallback((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_YOUTUBE_FALLBACK, next ? "true" : "false");
      } catch {
        /* private mode / quota */
      }
      return next;
    });
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        className={[
          "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest transition-all",
          isPro
            ? "border-cyan-400/70 bg-cyan-950/40 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.45),0_0_4px_rgba(74,222,128,0.35)] hover:border-cyan-300 hover:text-cyan-100"
            : "border-slate-600/80 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:text-slate-100",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        title="Developer tier override — tap to toggle Free ↔ Pro"
        aria-label={
          isPro
            ? "Pro Active. Tap to switch to Free Mode."
            : "Free Mode. Tap to switch to Pro Active."
        }
      >
        {isPro ? (
          <>
            <span aria-hidden="true">⚡</span>
            <span>PRO ACTIVE</span>
          </>
        ) : (
          <>
            <span aria-hidden="true">⚪</span>
            <span>FREE MODE</span>
          </>
        )}
      </button>
      {DEV_TRANSPORT_TOGGLE_ENABLED ? (
        <button
          type="button"
          onClick={toggleYoutubeFallback}
          className={[
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest transition-all",
            youtubeFallback
              ? "border-amber-400/70 bg-amber-950/40 text-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.4)] hover:border-amber-300 hover:text-amber-100"
              : "border-slate-600/80 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:text-slate-100",
          ].join(" ")}
          title="Development only — YouTube iframe full-length tracks for DJ lookahead timing. Off keeps Pocket Mode DirectStream (preview HTML5)."
          aria-pressed={youtubeFallback}
          aria-label={
            youtubeFallback
              ? "Full Songs Dev Mode on. Tap to return to Pocket Mode DirectStream."
              : "Full Songs Dev Mode off. Tap to resolve full-length YouTube tracks."
          }
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              youtubeFallback ? "bg-amber-400" : "bg-slate-500"
            }`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Full Songs (Dev)</span>
          <span className="sm:hidden">YT Dev</span>
        </button>
      ) : null}
    </div>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

/**
 * Header music-source control — opens the Music Source manager modal.
 * Mounted inside ControlDeck's sticky chrome (the app's header surface).
 */
export default function Header() {
  const { activeProvider, isConnected, isConnecting } = useMusicSource();
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const label = !isConnected
    ? "Connect Music"
    : activeProvider === "spotify"
      ? "Spotify Active"
      : "Apple Music Active";

  const title = isConnected
    ? `${label} — manage music sources`
    : "Connect Music — choose Spotify or Apple Music";

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: document.title || "SongHost",
          url,
        });
        return;
      }
      await copyTextToClipboard(url);
      setToast("Station link copied to clipboard");
    } catch (error) {
      // User dismissed the system share sheet — not an error.
      if ((error as Error)?.name === "AbortError") return;
      try {
        await copyTextToClipboard(url);
        setToast("Station link copied to clipboard");
      } catch {
        setToast("Couldn't copy station link");
      }
    }
  }, []);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            void handleShare();
          }}
          className="p-2 rounded-lg border border-slate-800 bg-slate-900/80 hover:bg-slate-800 hover:border-slate-700 text-slate-300 hover:text-cyan-400 transition"
          title="Share Station Link"
          aria-label="Share Station Link"
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={isConnecting}
          className={[
            "flex items-center gap-1.5 rounded-md border px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors disabled:cursor-wait disabled:opacity-60",
            isConnected
              ? activeProvider === "spotify"
                ? "border-[#1DB954]/50 bg-[#1DB954]/10 text-[#1DB954] hover:border-[#1DB954] hover:bg-[#1DB954]/15"
                : "border-[#FC3C44]/50 bg-[#FC3C44]/10 text-[#FC3C44] hover:border-[#FC3C44] hover:bg-[#FC3C44]/15"
              : "border-white/[0.08] bg-[#121215]/70 text-zinc-300 hover:border-accent/60 hover:text-accent",
          ].join(" ")}
          title={title}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={modalOpen}
        >
          {isConnected ? (
            <span
              className={[
                "h-1.5 w-1.5 shrink-0 rounded-full",
                activeProvider === "spotify" ? "bg-[#1DB954]" : "bg-[#FC3C44]",
              ].join(" ")}
              aria-hidden="true"
            />
          ) : (
            <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
              <Link2
                className="absolute -bottom-0.5 -right-0.5 h-2 w-2 text-zinc-400"
                aria-hidden="true"
              />
            </span>
          )}
          <span className="hidden lg:inline">{label}</span>
        </button>
      </div>

      <MusicSourceModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {toast ? (
        <p
          role="status"
          className="pointer-events-none fixed bottom-20 right-4 z-[100] rounded-md border border-slate-800 bg-slate-950/90 px-3 py-1.5 font-sans text-xs text-slate-200 shadow-lg backdrop-blur-sm"
        >
          {toast}
        </p>
      ) : null}
    </>
  );
}
