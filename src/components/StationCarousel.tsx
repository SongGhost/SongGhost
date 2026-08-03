"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Mic2, Radio, Trash2 } from "lucide-react";
import type { Station } from "@/data/stations";
import { getPersonaById } from "@/data/personas";

const SCROLL_AMOUNT_PX = 320;

const fmBadgeClass =
  "bg-amber-500/15 text-amber-400 border border-amber-500/30 font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md tracking-wider inline-flex items-center gap-1 tabular-nums";

const arrowBtnClass =
  "h-8 w-8 shrink-0 flex items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:text-amber-400 hover:border-amber-500/50 disabled:opacity-30 disabled:pointer-events-none";

type StationCarouselProps = {
  title: string;
  /** Optional supporting text/count rendered next to the title, e.g. "12 / 40 decades" */
  headerRight?: React.ReactNode;
  stations: Station[];
  activeStationId: string;
  onSelect: (station: Station) => void;
  onDelete?: (stationId: string) => void;
  /** Saved stations surface their chosen dial accent next to the frequency */
  showAccent?: boolean;
};

function CarouselCard({
  station,
  isActive,
  onSelect,
  onDelete,
  showAccent,
}: {
  station: Station;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  showAccent?: boolean;
}) {
  const persona = getPersonaById(station.defaultPersonaId);

  return (
    <div className="relative w-[200px] sm:w-[240px] flex-shrink-0 snap-start">
      <button
        type="button"
        onClick={onSelect}
        className={`group text-left rounded-xl p-4 cursor-pointer transition-all duration-200 w-full h-full ${
          isActive
            ? "bg-zinc-900 border border-amber-500/60 ring-2 ring-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.35)] scale-105"
            : "bg-zinc-900/60 border border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700"
        }`}
      >
        <div className={`flex items-center gap-2 mb-2 ${onDelete ? "pr-6" : ""}`}>
          <span className={fmBadgeClass}>
            <Radio className="h-3 w-3 opacity-70" />
            {station.frequency.toFixed(1)} FM
          </span>
          {showAccent && (
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/20"
              style={{ backgroundColor: station.accentColor }}
            />
          )}
        </div>
        <h3 className="text-zinc-100 font-sans font-semibold text-sm group-hover:text-amber-400 transition-colors leading-snug line-clamp-2">
          {station.name}
        </h3>
        <p className="text-zinc-400 font-sans text-xs line-clamp-2 mt-1.5 leading-relaxed">
          {station.description}
        </p>
        <span className="font-mono text-[10px] text-zinc-500 group-hover:text-zinc-400 flex items-center gap-1 mt-3">
          <Mic2 className="h-3 w-3" />
          {persona?.name ?? "DJ"}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-3 right-3 p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          aria-label={`Delete ${station.name}`}
          title="Delete station"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export default function StationCarousel({
  title,
  headerRight,
  stations,
  activeStationId,
  onSelect,
  onDelete,
  showAccent,
}: StationCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollByAmount = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -SCROLL_AMOUNT_PX : SCROLL_AMOUNT_PX,
      behavior: "smooth",
    });
  };

  const handleSelect = (station: Station) => {
    onSelect(station);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (stations.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="chassis-badge mb-0">{title}</span>
          {headerRight}
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollByAmount("left")}
            aria-label={`Scroll ${title} left`}
            className={arrowBtnClass}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount("right")}
            aria-label={`Scroll ${title} right`}
            className={arrowBtnClass}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="overflow-x-auto snap-x snap-mandatory scrollbar-none flex gap-4 pb-2"
      >
        {stations.map((station) => (
          <CarouselCard
            key={station.id}
            station={station}
            isActive={activeStationId === station.id}
            onSelect={() => handleSelect(station)}
            onDelete={onDelete ? () => onDelete(station.id) : undefined}
            showAccent={showAccent}
          />
        ))}
      </div>
    </div>
  );
}
