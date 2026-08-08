"use client";

import { Mic2 } from "lucide-react";
import { consoleInputClass } from "@/components/QuickConnectors";
import type { DjMode } from "@/types/dj";

const DJ_MODE_OPTIONS: readonly {
  id: DjMode;
  label: string;
}[] = [
  { id: "no_dj", label: "No DJ — Music Only" },
  { id: "active", label: "Active — Quick Liners & Teases" },
  { id: "balanced", label: "Balanced — Standard Radio DJ" },
  { id: "in_depth", label: "In-Depth — Deep Lore & Stories" },
] as const;

type DjCadenceSelectorProps = {
  value: DjMode;
  onChange: (mode: DjMode) => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Companion-stream DJ mode — parked beside the persona selector so listeners
 * can choose music-only, quick liners, standard radio, or deep lore.
 */
export default function DjCadenceSelector({
  value,
  onChange,
  compact,
  disabled,
  className = "",
}: DjCadenceSelectorProps) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <Mic2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <label htmlFor="dj-mode-select" className="sr-only">
        DJ Mode
      </label>
      <select
        id="dj-mode-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as DjMode)}
        className={`${consoleInputClass} min-w-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? "py-2" : "py-2.5"
        }`}
        aria-label="DJ Mode"
      >
        {DJ_MODE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export { DJ_MODE_OPTIONS };
