"use client";

import { ChevronDown, Mic2, Radio } from "lucide-react";
import { DECADE_STATIONS, GENRE_STATIONS, type Station } from "@/data/stations";
import { getPersonaById } from "@/data/personas";
import { consoleActionBtnClass } from "@/components/QuickConnectors";

type StationSelectorProps = {
  activeStationId: string;
  onSelect: (station: Station) => void;
  visibleGenreCount: number;
  onLoadMoreGenres: () => void;
};

const fmBadgeClass =
  "bg-amber-500/15 text-amber-800 border border-amber-500/30 font-mono text-xs font-semibold px-2.5 py-1 rounded-md tracking-wider inline-flex items-center gap-1 tabular-nums";

const genreCountClass =
  "text-stone-800 font-mono text-xs font-medium tabular-nums tracking-wide";

function StationCard({
  station,
  isActive,
  onSelect,
}: {
  station: Station;
  isActive: boolean;
  onSelect: () => void;
}) {
  const persona = getPersonaById(station.defaultPersonaId);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group text-left rounded-xl p-5 cursor-pointer transition-all ${
        isActive
          ? "bg-white border-[#C5B49D] shadow-[0_4_20px_rgba(197,180,157,0.3)] ring-1 ring-[#C5B49D]/60"
          : "bg-white/95 hover:bg-white border border-[#D2C5B4] shadow-sm hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={fmBadgeClass}>
          <Radio className="h-3 w-3 opacity-70" />
          {station.frequency.toFixed(1)} FM
        </span>
      </div>
      <h3 className="text-stone-900 font-sans font-semibold text-base group-hover:text-amber-800 transition-colors leading-snug line-clamp-2">
        {station.name}
      </h3>
      <p className="text-stone-600 font-sans text-xs line-clamp-2 mt-1.5 leading-relaxed">
        {station.description}
      </p>
      <span className="font-mono text-[11px] text-stone-500 group-hover:text-stone-600 flex items-center gap-1 mt-3">
        <Mic2 className="h-3 w-3" />
        {persona?.name ?? "DJ"}
      </span>
    </button>
  );
}

function StationGrid({
  title,
  headerRight,
  stations,
  activeStationId,
  onSelect,
  showLoadMore,
  onLoadMore,
  totalHidden,
  loadMoreLabel = "Load More Genres",
}: {
  title: string;
  headerRight?: React.ReactNode;
  stations: Station[];
  activeStationId: string;
  onSelect: (station: Station) => void;
  showLoadMore?: boolean;
  onLoadMore?: () => void;
  totalHidden?: number;
  loadMoreLabel?: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <span className="chassis-badge mb-0">{title}</span>
        {headerRight}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {stations.map((station) => (
          <StationCard
            key={station.id}
            station={station}
            isActive={activeStationId === station.id}
            onSelect={() => onSelect(station)}
          />
        ))}
      </div>
      {showLoadMore && onLoadMore && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={onLoadMore} className={`${consoleActionBtnClass} flex items-center gap-2`}>
            <ChevronDown className="h-4 w-4" />
            {loadMoreLabel}
            {totalHidden !== undefined && totalHidden > 0 && (
              <span className="text-[10px] opacity-70 normal-case tracking-normal font-normal">
                ({totalHidden} more)
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default function StationSelector({
  activeStationId,
  onSelect,
  visibleGenreCount,
  onLoadMoreGenres,
}: StationSelectorProps) {
  const visibleGenres = GENRE_STATIONS.slice(0, visibleGenreCount);
  const hiddenCount = Math.max(0, GENRE_STATIONS.length - visibleGenreCount);

  return (
    <div className="space-y-6 sm:space-y-8">
      <StationGrid
        title="Decades"
        headerRight={
          <span className={genreCountClass}>
            {visibleGenres.length} / {GENRE_STATIONS.length} genres
          </span>
        }
        stations={DECADE_STATIONS}
        activeStationId={activeStationId}
        onSelect={onSelect}
      />
      <StationGrid
        title="Genres"
        stations={visibleGenres}
        activeStationId={activeStationId}
        onSelect={onSelect}
        showLoadMore={hiddenCount > 0}
        onLoadMore={onLoadMoreGenres}
        totalHidden={hiddenCount}
      />
    </div>
  );
}

export const INITIAL_GENRE_VISIBLE = 12;
export const GENRE_LOAD_MORE_STEP = 10;
