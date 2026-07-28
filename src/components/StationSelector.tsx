"use client";

import { useState } from "react";
import { DECADE_STATIONS, GENRE_STATIONS, type Station } from "@/data/stations";
import { getPersonaById } from "@/data/personas";
import { ChevronDown, Mic2, Radio } from "lucide-react";

const INITIAL_GENRE_COUNT = 10;

type StationSelectorProps = {
  activeStationId: string;
  onSelect: (station: Station) => void;
};

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
      className={`station-card group text-left rounded-xl p-3 sm:p-4 transition-all duration-200 ${
        isActive ? "station-card-active" : ""
      }`}
      style={
        isActive
          ? ({
              "--card-accent": station.accentColor,
              "--card-accent-soft": `${station.accentColor}22`,
            } as React.CSSProperties)
          : ({
              "--card-accent": station.accentColor,
            } as React.CSSProperties)
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className="station-freq-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-xs font-bold tabular-nums"
          style={{ color: station.accentColor, borderColor: `${station.accentColor}55` }}
        >
          <Radio className="h-3 w-3 opacity-70" />
          {station.frequency.toFixed(1)} FM
        </span>
        <span className="flex items-center gap-1 text-[10px] text-label-muted shrink-0">
          <Mic2 className="h-3 w-3" style={{ color: station.accentColor }} />
          <span className="hidden sm:inline">{persona?.name ?? "DJ"}</span>
        </span>
      </div>
      <h3 className="text-sm sm:text-base font-semibold text-display leading-snug line-clamp-2 group-hover:text-white transition-colors">
        {station.name}
      </h3>
      <p className="mt-1 text-[10px] sm:text-xs text-label-muted line-clamp-2">
        {station.description}
      </p>
    </button>
  );
}

function StationGrid({
  title,
  stations,
  activeStationId,
  onSelect,
  showLoadMore,
  onLoadMore,
  totalHidden,
}: {
  title: string;
  stations: Station[];
  activeStationId: string;
  onSelect: (station: Station) => void;
  showLoadMore?: boolean;
  onLoadMore?: () => void;
  totalHidden?: number;
}) {
  return (
    <div>
      <p className="mb-3 text-xs tracking-widest text-label uppercase">{title}</p>
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
          <button
            type="button"
            onClick={onLoadMore}
            className="load-more-btn flex items-center gap-2 rounded-lg px-5 py-2.5 text-xs sm:text-sm font-medium tracking-wide"
          >
            <ChevronDown className="h-4 w-4" />
            Load More Genres
            {totalHidden !== undefined && totalHidden > 0 && (
              <span className="text-[10px] opacity-70">({totalHidden} more)</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default function StationSelector({ activeStationId, onSelect }: StationSelectorProps) {
  const [showAllGenres, setShowAllGenres] = useState(false);

  const visibleGenres = showAllGenres
    ? GENRE_STATIONS
    : GENRE_STATIONS.slice(0, INITIAL_GENRE_COUNT);
  const hiddenCount = GENRE_STATIONS.length - INITIAL_GENRE_COUNT;

  return (
    <div className="station-grid-container space-y-6 sm:space-y-8">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-accent-gold" />
        <p className="text-xs sm:text-sm tracking-widest text-label uppercase">
          Tune Your Station
        </p>
      </div>
      <StationGrid
        title="Decades"
        stations={DECADE_STATIONS}
        activeStationId={activeStationId}
        onSelect={onSelect}
      />
      <StationGrid
        title="Genres"
        stations={visibleGenres}
        activeStationId={activeStationId}
        onSelect={onSelect}
        showLoadMore={!showAllGenres && hiddenCount > 0}
        onLoadMore={() => setShowAllGenres(true)}
        totalHidden={hiddenCount}
      />
    </div>
  );
}
