"use client";

import { ListMusic, Radio } from "lucide-react";
import StationCarousel from "@/components/StationCarousel";
import StudioMixesShelf from "@/components/studio/StudioMixesShelf";
import type { Station } from "@/data/stations";
import type { StudioMixShelfItem } from "@/lib/studio/manifest";
import type { StationDefinition } from "@/types/user";
import type { EraLock } from "@/types/station";

const EMPTY_LIBRARY_COPY =
  "No saved stations yet. Click the star icon on any station to save it to your library.";

export type SavedStationsSectionProps = {
  /** Account-bound library — always `[]` for unauthenticated guests. */
  savedStations: readonly StationDefinition[];
  studioMixes: readonly StudioMixShelfItem[];
  activeStationId: string;
  /** When true and the library is empty, hide the whole section. */
  isGuest?: boolean;
  onSelectStation: (
    station: Station,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => void;
  onDeleteStation: (stationId: string) => void;
  onPlayMix: (mix: StudioMixShelfItem) => void;
  onRemoveMix: (id: string) => void;
  resolveEraLockFor?: (station: Station) => EraLock;
  onShareStation?: (station: Station) => void;
};

/**
 * "My Saved Stations & Custom Mixes" shelf.
 * Guests / empty libraries never render populated station cards — only an empty
 * placeholder (or the section is omitted when guest + no studio mixes).
 */
export default function SavedStationsSection({
  savedStations,
  studioMixes,
  activeStationId,
  isGuest = false,
  onSelectStation,
  onDeleteStation,
  onPlayMix,
  onRemoveMix,
  resolveEraLockFor,
  onShareStation,
}: SavedStationsSectionProps) {
  const hasSaved = savedStations.length > 0;
  const hasMixes = studioMixes.length > 0;

  // Guests with nothing parked: omit the shelf entirely (no faux library cards).
  if (isGuest && !hasSaved && !hasMixes) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-accent/90">
          My Saved Stations &amp; Custom Mixes
        </h2>
        <p className="mt-1 font-sans text-xs text-zinc-500">
          Parked stations and Studio mixes ready to retune.
        </p>
      </div>

      {!hasSaved && !hasMixes ? (
        <div className="rounded-xl border border-dashed border-white/[0.12] bg-[#121215]/60 px-4 py-6 text-center">
          <Radio className="mx-auto h-7 w-7 text-zinc-600" aria-hidden="true" />
          <p className="mt-2 font-sans text-sm text-zinc-400">{EMPTY_LIBRARY_COPY}</p>
        </div>
      ) : (
        <>
          {hasMixes && (
            <StudioMixesShelf
              mixes={[...studioMixes]}
              activeStationId={activeStationId}
              onPlay={onPlayMix}
              onRemove={onRemoveMix}
            />
          )}
          {hasSaved ? (
            <StationCarousel
              title="My Stations"
              headerRight={
                <span className="font-mono text-xs text-zinc-500 flex items-center gap-1">
                  <ListMusic className="h-3 w-3" />
                  {savedStations.length} saved
                </span>
              }
              stations={[...savedStations]}
              activeStationId={activeStationId}
              onSelect={onSelectStation}
              onDelete={onDeleteStation}
              showAccent
              resolveEraLockFor={resolveEraLockFor}
              onShareStation={onShareStation}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.12] bg-[#121215]/60 px-4 py-5 text-center">
              <p className="font-sans text-sm text-zinc-400">{EMPTY_LIBRARY_COPY}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
