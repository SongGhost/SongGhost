"use client";

import { PRESET_TRACKS, type PresetTrack } from "@/data/presets";

type PresetListProps = {
  activeIndex: number;
  onSelect: (index: number) => void;
};

export default function PresetList({ activeIndex, onSelect }: PresetListProps) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#121215]/80 p-3 shadow-sm">
      <p className="mb-2 font-mono text-xs uppercase tracking-widest text-zinc-500">
        Preset Stations
      </p>
      <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        {PRESET_TRACKS.map((track: PresetTrack, index: number) => (
          <button
            key={track.id}
            type="button"
            onClick={() => onSelect(index)}
            className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition-all ${
              activeIndex === index
                ? "border-amber-500/50 bg-amber-500/10 shadow-sm ring-1 ring-amber-500/40"
                : "border-white/[0.08] bg-[#09090b]/90 hover:border-white/[0.14] hover:bg-[#121215]"
            }`}
          >
            <span className="block truncate font-sans text-sm font-medium text-zinc-100">
              {track.title}
            </span>
            <span className="block truncate font-sans text-xs text-zinc-500">{track.artist}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
