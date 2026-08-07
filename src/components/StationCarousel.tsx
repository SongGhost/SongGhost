"use client";

import { useRef, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Share2, Star, Trash2 } from "lucide-react";
import type { Station } from "@/data/stations";
import { formatStationMetaTag } from "@/lib/station-meta";
import { isPinnedStation, sortStationsWithPinsFirst } from "@/lib/user/preferences";
import { type EraLock } from "@/types/station";

const SCROLL_AMOUNT_PX = 320;
const EMPTY_PINNED_IDS: readonly string[] = [];

const metaBadgeClass =
  "bg-amber-500/10 text-amber-400/90 border border-white/[0.08] font-mono text-[10px] font-semibold px-2 py-0.5 rounded-md tracking-wider inline-flex items-center tabular-nums uppercase";

const arrowBtnClass =
  "h-8 w-8 shrink-0 flex items-center justify-center rounded-full border border-white/[0.08] bg-[#121215] text-zinc-300 transition-colors hover:text-amber-400 hover:border-amber-500/50 disabled:opacity-30 disabled:pointer-events-none";

type StationCarouselProps = {
  title: string;
  /** Optional supporting text/count rendered next to the title, e.g. "12 / 40 decades" */
  headerRight?: React.ReactNode;
  stations: Station[];
  activeStationId: string;
  onSelect: (
    station: Station,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => void;
  onDelete?: (stationId: string) => void;
  /** Saved stations surface their chosen dial accent next to the meta tag */
  showAccent?: boolean;
  /** Era the station is locked to — folded into the `[GENRE • ERA]` tag */
  resolveEraLockFor?: (station: Station) => EraLock;
  /** Opens the share modal for a station card */
  onShareStation?: (station: Station) => void;
  /** Pinned preset IDs — pinned cards sort to the front with a star accent */
  pinnedStationIds?: readonly string[];
  /** Toggle pin/favorite for a preset card */
  onTogglePin?: (stationId: string) => void;
};

function CarouselCard({
  station,
  isActive,
  onSelect,
  onDelete,
  showAccent,
  eraLock,
  onShare,
  isPinned,
  onTogglePin,
}: {
  station: Station;
  isActive: boolean;
  onSelect: (e: MouseEvent) => void;
  onDelete?: () => void;
  showAccent?: boolean;
  eraLock: EraLock;
  onShare?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const metaTag = formatStationMetaTag(station, eraLock);
  const cornerButtonCount =
    (onDelete ? 1 : 0) + (onShare ? 1 : 0) + (onTogglePin ? 1 : 0);

  return (
    <div className="relative w-[200px] sm:w-[240px] flex-shrink-0 snap-start">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(e);
        }}
        className={`group h-full w-full cursor-pointer rounded-xl border p-4 text-left transition-all duration-200 ${
          isActive
            ? "scale-105 border-amber-500/60 bg-[#121215] shadow-[0_0_20px_rgba(245,158,11,0.28)] ring-2 ring-amber-500/80"
            : isPinned
              ? "border-amber-500/30 bg-[#121215]/90 shadow-[0_0_12px_rgba(245,158,11,0.1)] hover:border-amber-500/50"
              : "border-white/[0.08] bg-[#121215]/70 hover:border-white/[0.14] hover:bg-[#121215]"
        }`}
      >
        <div
          className="mb-2 flex items-center gap-2"
          style={{ paddingRight: cornerButtonCount * 26 }}
        >
          <span className={metaBadgeClass}>{metaTag}</span>
          {isPinned && (
            <span
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-400"
              title="Pinned preset"
            >
              Pinned
            </span>
          )}
          {showAccent && (
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/20"
              style={{ backgroundColor: station.accentColor }}
            />
          )}
        </div>
        <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug text-zinc-100 transition-colors group-hover:text-amber-400">
          {station.name}
        </h3>
        <p className="mt-1.5 line-clamp-2 font-sans text-xs leading-relaxed text-zinc-500">
          {station.description}
        </p>
      </button>

      <div className="absolute top-3 right-3 flex items-center gap-0.5">
        {onTogglePin && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className={`rounded-md p-1.5 transition-colors ${
              isPinned
                ? "text-amber-400 hover:bg-amber-500/15 hover:text-amber-300"
                : "text-zinc-500 hover:bg-amber-500/10 hover:text-amber-400"
            }`}
            aria-label={isPinned ? `Unpin ${station.name}` : `Pin ${station.name}`}
            aria-pressed={isPinned}
            title={isPinned ? "Unpin preset" : "Pin preset"}
          >
            <Star className={`h-3.5 w-3.5 ${isPinned ? "fill-current" : ""}`} />
          </button>
        )}
        {onShare && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-amber-500/10 hover:text-amber-400"
            aria-label={`Share ${station.name}`}
            title="Share station link"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
            aria-label={`Delete ${station.name}`}
            title="Delete station"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
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
  resolveEraLockFor,
  onShareStation,
  pinnedStationIds,
  onTogglePin,
}: StationCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedIds = pinnedStationIds ?? EMPTY_PINNED_IDS;
  const orderedStations = onTogglePin
    ? sortStationsWithPinsFirst(stations, pinnedIds)
    : stations;

  const scrollByAmount = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -SCROLL_AMOUNT_PX : SCROLL_AMOUNT_PX,
      behavior: "smooth",
    });
  };

  const handleSelect = (
    station: Station,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => {
    e?.preventDefault();
    e?.stopPropagation();
    onSelect(station, e);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (orderedStations.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="chassis-badge mb-0">{title}</span>
          {headerRight}
        </div>
        <div className="hidden items-center gap-2 sm:flex">
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
        className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
      >
        {orderedStations.map((station) => {
          const pinned = isPinnedStation(station.id, pinnedIds);
          return (
            <CarouselCard
              key={station.id}
              station={station}
              isActive={activeStationId === station.id}
              onSelect={(e) => handleSelect(station, e)}
              onDelete={onDelete ? () => onDelete(station.id) : undefined}
              showAccent={showAccent}
              eraLock={resolveEraLockFor?.(station) ?? "all"}
              onShare={onShareStation ? () => onShareStation(station) : undefined}
              isPinned={pinned}
              onTogglePin={onTogglePin ? () => onTogglePin(station.id) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
