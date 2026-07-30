"use client";

import { PRESET_TRACKS, type PresetTrack } from "@/data/presets";

type PresetListProps = {
  activeIndex: number;
  onSelect: (index: number) => void;
};

export default function PresetList({ activeIndex, onSelect }: PresetListProps) {
  return (
    <div className="bg-[#ECE8DF]/80 border border-[#D8CFC2] rounded-xl p-3 shadow-sm">
      <p className="mb-2 font-mono text-xs tracking-widest text-zinc-500 uppercase">
        Preset Stations
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
        {PRESET_TRACKS.map((track: PresetTrack, index: number) => (
          <button
            key={track.id}
            type="button"
            onClick={() => onSelect(index)}
            className={`text-left rounded-lg px-3 py-2 transition-all border cursor-pointer ${
              activeIndex === index
                ? "bg-white border-[#C5B49D] shadow-sm ring-1 ring-[#C5B49D]/50"
                : "bg-[#FAF8F5]/90 border-[#E2D9CC] hover:bg-white hover:border-[#D2C5B4]"
            }`}
          >
            <span className="block font-mono text-xs text-amber-700 tabular-nums">
              {track.frequency.toFixed(1)} FM
            </span>
            <span className="block font-sans text-sm font-medium text-zinc-900 truncate">
              {track.title}
            </span>
            <span className="block font-sans text-xs text-zinc-500 truncate">{track.artist}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
