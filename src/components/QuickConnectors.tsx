"use client";

import { Music2, Youtube } from "lucide-react";

type QuickConnectorsProps = {
  customUrl: string;
  onCustomUrlChange: (url: string) => void;
  onTuneYouTube: () => void;
  onSpotifyConnect?: () => void;
};

export const consoleInputClass =
  "bg-white border border-[#C8BFA0] focus:border-amber-600 text-stone-900 font-mono text-xs placeholder:text-stone-400 rounded-lg px-4 py-2.5 shadow-inner outline-none transition-all w-full";

export const consoleActionBtnClass =
  "bg-stone-900 hover:bg-stone-800 text-amber-400 font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm transition-all active:scale-95";

export default function QuickConnectors({
  customUrl,
  onCustomUrlChange,
  onTuneYouTube,
  onSpotifyConnect,
}: QuickConnectorsProps) {
  return (
    <div>
      <span className="text-stone-900 font-mono text-xs font-bold uppercase tracking-widest mb-2 block">
        Quick Connect
      </span>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Youtube className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-stone-400 pointer-events-none" />
          <input
            type="text"
            value={customUrl}
            onChange={(e) => onCustomUrlChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onTuneYouTube()}
            placeholder="Paste YouTube URL..."
            className={`${consoleInputClass} pl-9 sm:pl-10`}
          />
        </div>
        <button type="button" onClick={onTuneYouTube} className={`${consoleActionBtnClass} shrink-0`}>
          Tune
        </button>
        <button
          type="button"
          onClick={onSpotifyConnect}
          className={`${consoleActionBtnClass} flex items-center justify-center gap-1.5 shrink-0`}
          title="Spotify connection coming soon"
        >
          <Music2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden xs:inline">Spotify</span>
        </button>
      </div>
    </div>
  );
}
