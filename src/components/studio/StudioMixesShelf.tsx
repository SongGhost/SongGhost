"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import StationCard from "@/components/cards/StationCard";
import type { StudioMixShelfItem } from "@/lib/studio/manifest";
import { getYouTubeThumbnail } from "@/lib/youtube";
import { MEMORY_PRESET_COUNT } from "@/types/station";

export type StudioMixesShelfProps = {
  mixes: StudioMixShelfItem[];
  activeStationId?: string;
  onPlay: (mix: StudioMixShelfItem) => void;
  onRemove: (id: string) => void;
  onAssignPreset?: (mix: StudioMixShelfItem, slot: number) => void;
};

function mixArtworkUrl(mix: StudioMixShelfItem): string | null {
  const lead = mix.manifest?.tracks?.find((t) => t.youtubeId?.trim())?.youtubeId;
  return lead?.trim() ? getYouTubeThumbnail(lead.trim(), "hq") : null;
}

/**
 * Dashboard shelf for SongHost Studio mixes saved in localStorage.
 * Renders at the top of the home station grid as "MY STUDIO MIXES".
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

      <div className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
        {mixes.map((mix) => {
          const stationId = `studio-${mix.id}`;
          const isActive = activeStationId === stationId;
          const lead = mix.manifest?.tracks?.[0];
          return (
            <div key={mix.id} className="flex flex-col">
              <StationCard
                artworkUrl={mixArtworkUrl(mix)}
                title={mix.name}
                subtitle={
                  lead
                    ? `${lead.artist} — ${lead.title}`
                    : `${mix.trackCount} track${mix.trackCount === 1 ? "" : "s"}`
                }
                tags={["Studio Mix", `${mix.trackCount} tracks`]}
                isActive={isActive}
                onClick={() => onPlay(mix)}
                actions={
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(mix.id);
                    }}
                    className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    aria-label={`Remove ${mix.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                }
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
                {onAssignPreset &&
                  Array.from({ length: MEMORY_PRESET_COUNT }, (_, i) => i + 1).map(
                    (slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => onAssignPreset(mix, slot)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-[#121215] font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-400"
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
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
