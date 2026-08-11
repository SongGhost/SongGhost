"use client";

import { AudioLines, Link2 } from "lucide-react";
import { useCallback, useState } from "react";
import MusicSourceModal from "@/components/player/MusicSourceModal";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useTier, type SubscriptionTier } from "@/context/TierContext";

/**
 * High-visibility Free / Pro testing badge for the top header chrome.
 * Click toggles local `isPro` via TierContext for instant Free vs Pro checks.
 */
export function DevTierBadge({ className = "" }: { className?: string }) {
  const { isPro, setTier } = useTier();

  const toggle = useCallback(() => {
    const next: SubscriptionTier = isPro ? "free" : "pro";
    setTier(next);
  }, [isPro, setTier]);

  return (
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
  );
}

/**
 * Header music-source control — opens the Music Source manager modal.
 * Mounted inside ControlDeck's sticky chrome (the app's header surface).
 */
export default function Header() {
  const { activeProvider, isConnected, isConnecting } = useMusicSource();
  const [modalOpen, setModalOpen] = useState(false);

  const label = !isConnected
    ? "Connect Music"
    : activeProvider === "spotify"
      ? "Spotify Active"
      : "Apple Music Active";

  const title = isConnected
    ? `${label} — manage music sources`
    : "Connect Music — choose Spotify or Apple Music";

  return (
    <>
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

      <MusicSourceModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
