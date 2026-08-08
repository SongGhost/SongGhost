"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Share2, Trash2 } from "lucide-react";
import StationCard from "@/components/cards/StationCard";
import type { StudioMixShelfItem } from "@/lib/studio/manifest";

export type StudioMixesShelfProps = {
  mixes: StudioMixShelfItem[];
  activeStationId?: string;
  onPlay: (mix: StudioMixShelfItem) => void;
  onRemove: (id: string) => void;
};

/**
 * Dashboard shelf for SongHost Studio mixes saved in localStorage / account index.
 * Renders at the top of the home station grid as "MY STUDIO MIXES".
 */
export default function StudioMixesShelf({
  mixes,
  activeStationId,
  onPlay,
  onRemove,
}: StudioMixesShelfProps) {
  const router = useRouter();

  if (mixes.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-accent/90">
            My Studio Mixes
          </h2>
          <p className="mt-1 font-sans text-xs text-zinc-500">
            Replay and share authored SongHost Studio mixes.
          </p>
        </div>
        <Link
          href="/studio"
          className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent"
        >
          Open Studio →
        </Link>
      </div>

      <div className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
        {mixes.map((mix) => {
          const stationId = `studio-${mix.id}`;
          const isActive = activeStationId === stationId;
          const lead = mix.manifest?.tracks?.[0];
          const coverImageUrl =
            mix.coverImageUrl?.trim() ||
            mix.manifest?.coverImageUrl?.trim() ||
            null;

          return (
            <div key={mix.id} className="flex flex-col">
              <StationCard
                artworkUrl={coverImageUrl}
                title={mix.name}
                subtitle={
                  lead
                    ? `${lead.artist} — ${lead.title}`
                    : `${mix.trackCount} track${mix.trackCount === 1 ? "" : "s"}`
                }
                tags={["Studio Mix", `${mix.trackCount} tracks`]}
                isActive={isActive}
                accentColor={mix.accentColor}
                onEdit={() => router.push("/studio?edit=" + mix.id)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
                <button
                  type="button"
                  onClick={() => onPlay(mix)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover"
                >
                  <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                  Play
                </button>
                <Link
                  href={`/s/${encodeURIComponent(mix.id)}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#121215] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <Share2 className="h-3 w-3" aria-hidden="true" />
                  Share
                </Link>
                <button
                  type="button"
                  onClick={() => onRemove(mix.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#121215] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:border-red-500/40 hover:text-red-400"
                  aria-label={`Delete ${mix.name}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
