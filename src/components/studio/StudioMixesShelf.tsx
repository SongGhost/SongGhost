"use client";

import Link from "next/link";
import { Radio, Trash2 } from "lucide-react";
import type { StudioMixShelfItem } from "@/lib/studio/manifest";
import { MEMORY_PRESET_COUNT } from "@/types/station";

export type StudioMixesShelfProps = {
  mixes: StudioMixShelfItem[];
  activeStationId?: string;
  onPlay: (mix: StudioMixShelfItem) => void;
  onRemove: (id: string) => void;
  onAssignPreset?: (mix: StudioMixShelfItem, slot: number) => void;
};

/**
 * Dashboard shelf for SongHost Studio mixes saved in localStorage.
 */
export default function StudioMixesShelf({
  mixes,
  activeStationId,
  onPlay,
  onRemove,
  onAssignPreset,
}: StudioMixesShelfProps) {
  if (mixes.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-amber-500/90">
            My Studio Mixes
          </h2>
          <p className="mt-1 font-sans text-xs text-zinc-500">
            Replay authored SongHost Studio mixes or park them on Memory Presets 1–
            {MEMORY_PRESET_COUNT}.
          </p>
        </div>
        <Link
          href="/studio"
          className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-amber-400"
        >
          Open Studio →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mixes.map((mix) => {
          const stationId = `studio-${mix.id}`;
          const isActive = activeStationId === stationId;
          return (
            <div
              key={mix.id}
              className={`group relative flex flex-col rounded-xl border p-4 transition-colors ${
                isActive
                  ? "border-amber-500/60 bg-[#121215] shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                  : "border-white/[0.08] bg-[#121215]/70 hover:border-white/[0.14]"
              }`}
            >
              <button
                type="button"
                onClick={() => onPlay(mix)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-500/80">
                  <Radio className="h-3 w-3" aria-hidden="true" />
                  Studio Mix
                </p>
                <p className="mt-2 truncate font-sans text-sm font-semibold text-zinc-100">
                  {mix.name}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  {mix.trackCount} track{mix.trackCount === 1 ? "" : "s"}
                </p>
              </button>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-3">
                {onAssignPreset &&
                  Array.from({ length: MEMORY_PRESET_COUNT }, (_, i) => i + 1).map(
                    (slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => onAssignPreset(mix, slot)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-zinc-950/60 font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-400"
                        title={`Assign to Memory Preset ${slot}`}
                        aria-label={`Assign ${mix.name} to memory preset ${slot}`}
                      >
                        {slot}
                      </button>
                    ),
                  )}
                <Link
                  href={`/s/${encodeURIComponent(mix.id)}`}
                  className="ml-auto font-mono text-[10px] uppercase tracking-widest text-zinc-500 hover:text-amber-400"
                >
                  Share
                </Link>
                <button
                  type="button"
                  onClick={() => onRemove(mix.id)}
                  className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-red-400"
                  aria-label={`Remove ${mix.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
