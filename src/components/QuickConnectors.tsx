"use client";

import { Music2, Youtube } from "lucide-react";

type QuickConnectorsProps = {
  customUrl: string;
  onCustomUrlChange: (url: string) => void;
  onTuneYouTube: () => void;
  onSpotifyConnect?: () => void;
};

export default function QuickConnectors({
  customUrl,
  onCustomUrlChange,
  onTuneYouTube,
  onSpotifyConnect,
}: QuickConnectorsProps) {
  return (
    <div className="quick-connectors space-y-2">
      <p className="text-[10px] sm:text-xs tracking-widest text-label uppercase">
        Quick Connect
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Youtube className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-400/70 pointer-events-none" />
          <input
            type="text"
            value={customUrl}
            onChange={(e) => onCustomUrlChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onTuneYouTube()}
            placeholder="Paste YouTube URL..."
            className="tune-input w-full rounded-lg pl-8 sm:pl-10 pr-3 py-2 text-xs sm:text-sm"
          />
        </div>
        <button
          type="button"
          onClick={onTuneYouTube}
          className="analog-btn analog-btn-tune shrink-0 px-4 sm:px-5 py-2 text-[10px] sm:text-xs"
        >
          TUNE
        </button>
        <button
          type="button"
          onClick={onSpotifyConnect}
          className="connector-btn flex items-center justify-center gap-1.5 shrink-0 px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs"
          title="Spotify connection coming soon"
        >
          <Music2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden xs:inline">Spotify</span>
        </button>
      </div>
    </div>
  );
}
