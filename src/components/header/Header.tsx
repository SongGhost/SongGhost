"use client";

import { AudioLines, Link2 } from "lucide-react";
import { useState } from "react";
import MusicSourceModal from "@/components/player/MusicSourceModal";
import { useMusicSource } from "@/context/MusicSourceContext";

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
            : "border-zinc-700/80 bg-zinc-900/70 text-zinc-300 hover:border-amber-500/60 hover:text-amber-400",
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
