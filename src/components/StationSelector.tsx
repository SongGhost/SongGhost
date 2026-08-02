"use client";

import { ChevronDown, ListMusic, Mic2, Radio, Trash2 } from "lucide-react";
import { DECADE_STATIONS, GENRE_STATIONS, type Station } from "@/data/stations";
import { getPersonaById } from "@/data/personas";
import { consoleActionBtnClass } from "@/components/QuickConnectors";

type StationSelectorProps = {
  activeStationId: string;
  onSelect: (station: Station) => void;
  visibleGenreCount: number;
  onLoadMoreGenres: () => void;
  visibleDecadeCount: number;
  onLoadMoreDecades: () => void;
  savedStations?: Station[];
  onDeleteSavedStation?: (stationId: string) => void;
};

const fmBadgeClass =
  "bg-amber-500/15 text-amber-800 border border-amber-500/30 font-mono text-xs font-semibold px-2.5 py-1 rounded-md tracking-wider inline-flex items-center gap-1 tabular-nums";

const genreCountClass =
  "text-stone-800 font-mono text-xs font-medium tabular-nums tracking-wide";

function StationCard({
  station,
  isActive,
  onSelect,
  onDelete,
  showAccent = false,
}: {
  station: Station;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  /** Saved stations surface their chosen dial accent next to the frequency */
  showAccent?: boolean;
}) {
  const persona = getPersonaById(station.defaultPersonaId);

  return (
    <div className="relative h-full">
      <button
        type="button"
        onClick={onSelect}
        className={`group text-left rounded-xl p-5 cursor-pointer transition-all w-full h-full ${
          isActive
            ? "bg-white border-[#C5B49D] shadow-[0_4_20px_rgba(197,180,157,0.3)] ring-1 ring-[#C5B49D]/60"
            : "bg-white/95 hover:bg-white border border-[#D2C5B4] shadow-sm hover:shadow-md"
        }`}
      >
        <div className={`flex items-start gap-2 mb-2 ${onDelete ? "pr-8" : ""}`}>
          <span className={fmBadgeClass}>
            <Radio className="h-3 w-3 opacity-70" />
            {station.frequency.toFixed(1)} FM
          </span>
          {showAccent && (
            <span
              aria-hidden
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: station.accentColor }}
            />
          )}
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
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute top-3 right-3 p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          aria-label={`Delete ${station.name}`}
          title="Delete station"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
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
  onDelete,
  showAccent,
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
  onDelete?: (stationId: string) => void;
  showAccent?: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <span className="chassis-badge mb-0">{title}</span>
        {headerRight}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(17.5rem,1fr))] auto-rows-fr gap-4">
        {stations.map((station) => (
          <StationCard
            key={station.id}
            station={station}
            isActive={activeStationId === station.id}
            onSelect={() => onSelect(station)}
            onDelete={onDelete ? () => onDelete(station.id) : undefined}
            showAccent={showAccent}
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
  visibleDecadeCount,
  onLoadMoreDecades,
  savedStations = [],
  onDeleteSavedStation,
}: StationSelectorProps) {
  const visibleGenres = GENRE_STATIONS.slice(0, visibleGenreCount);
  const hiddenGenreCount = Math.max(0, GENRE_STATIONS.length - visibleGenreCount);
  const visibleDecades = DECADE_STATIONS.slice(0, visibleDecadeCount);
  const hiddenDecadeCount = Math.max(0, DECADE_STATIONS.length - visibleDecadeCount);

  return (
    <div className="space-y-6 sm:space-y-8">
      {savedStations.length > 0 && (
        <StationGrid
          title="My Stations"
          headerRight={
            <span className={`${genreCountClass} flex items-center gap-1`}>
              <ListMusic className="h-3 w-3" />
              {savedStations.length} saved
            </span>
          }
          stations={savedStations}
          activeStationId={activeStationId}
          onSelect={onSelect}
          onDelete={onDeleteSavedStation}
          showAccent
        />
      )}
      <StationGrid
        title="Decades"
        headerRight={
          <span className={genreCountClass}>
            {visibleDecades.length} / {DECADE_STATIONS.length} decades
          </span>
        }
        stations={visibleDecades}
        activeStationId={activeStationId}
        onSelect={onSelect}
        showLoadMore={hiddenDecadeCount > 0}
        onLoadMore={onLoadMoreDecades}
        totalHidden={hiddenDecadeCount}
        loadMoreLabel="Load More Decades"
      />
      <StationGrid
        title="Genres"
        stations={visibleGenres}
        activeStationId={activeStationId}
        onSelect={onSelect}
        showLoadMore={hiddenGenreCount > 0}
        onLoadMore={onLoadMoreGenres}
        totalHidden={hiddenGenreCount}
      />
    </div>
  );
}

export const INITIAL_GENRE_VISIBLE = 12;
export const GENRE_LOAD_MORE_STEP = 10;
export const INITIAL_DECADE_VISIBLE = 9;
export const DECADE_LOAD_MORE_STEP = 8;
