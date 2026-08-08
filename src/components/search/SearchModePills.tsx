"use client";

import type { ArtistRadioMode } from "@/lib/artist-radio";

export type MusicSearchMode = ArtistRadioMode | "song-radio" | "curator" | "full-album";

export type SearchModeOption = {
  value: MusicSearchMode;
  label: string;
  emoji: string;
};

export const SEARCH_MODE_OPTIONS: SearchModeOption[] = [
  { value: "song-radio", label: "Song Radio", emoji: "🎵" },
  { value: "artist-only", label: "Artist Only", emoji: "👤" },
  { value: "mixed", label: "Radio Mix", emoji: "📻" },
  { value: "full-album", label: "Full Album", emoji: "💿" },
  { value: "curator", label: "AI Curator", emoji: "🔮" },
];

type SearchModePillsProps = {
  mode: MusicSearchMode;
  onChange: (mode: MusicSearchMode) => void;
  disabled?: boolean;
};

/**
 * Compact interactive mode selector for Smart Search.
 * Active pill uses amber accent border (`#f59e0b`) and a soft glow.
 */
export default function SearchModePills({
  mode,
  onChange,
  disabled,
}: SearchModePillsProps) {
  return (
    <div
      className="mb-2 flex flex-wrap gap-1.5"
      role="radiogroup"
      aria-label="Music search mode"
    >
      {SEARCH_MODE_OPTIONS.map((option) => {
        const selected = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 ${
              selected
                ? "border-[#f59e0b] bg-amber-500/15 text-amber-200 shadow-[0_0_14px_rgba(245,158,11,0.35)]"
                : "border-white/[0.08] bg-[#121215] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200"
            }`}
          >
            <span aria-hidden="true">{option.emoji}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
