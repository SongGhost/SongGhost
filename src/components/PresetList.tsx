"use client";

import { PRESET_TRACKS, type PresetTrack } from "@/data/presets";

type PresetListProps = {
  activeIndex: number;
  onSelect: (index: number) => void;
};

export default function PresetList({ activeIndex, onSelect }: PresetListProps) {
  return (
    <div className="preset-list rounded-lg p-3">
      <p className="mb-2 text-xs tracking-widest text-amber-200/60 uppercase">
        Preset Stations
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
        {PRESET_TRACKS.map((track: PresetTrack, index: number) => (
          <button
            key={track.id}
            type="button"
            onClick={() => onSelect(index)}
            className={`preset-btn text-left rounded-md px-3 py-2 transition-all ${
              activeIndex === index ? "preset-btn-active" : ""
            }`}
          >
            <span className="block text-xs text-green-400/70 tabular-nums">
              {track.frequency.toFixed(1)} FM
            </span>
            <span className="block text-sm font-medium text-amber-100 truncate">
              {track.title}
            </span>
            <span className="block text-xs text-amber-200/50 truncate">
              {track.artist}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
