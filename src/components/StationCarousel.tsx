"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Mic2, Radio, Share2, Sliders, Star, Trash2 } from "lucide-react";
import type { Station } from "@/data/stations";
import { getPersonaById, PERSONAS, type PersonaId } from "@/data/personas";
import { isPinnedStation, sortStationsWithPinsFirst } from "@/lib/user/preferences";
import { getEraDefinition, isEraLocked, type EraLock } from "@/types/station";

const SCROLL_AMOUNT_PX = 320;
const EMPTY_PINNED_IDS: readonly string[] = [];

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
  onSelect: (
    station: Station,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => void;
  onDelete?: (stationId: string) => void;
  /** Saved stations surface their chosen dial accent next to the frequency */
  showAccent?: boolean;
  /** Host actually on air for a station, once any override is folded in */
  resolveHostId?: (station: Station) => PersonaId;
  /** Assign a host from the card's badge popover. `null` clears the override. */
  onHostOverride?: (stationId: string, personaId: PersonaId | null) => void;
  /** Era the station is locked to, surfaced as a card badge */
  resolveEraLockFor?: (station: Station) => EraLock;
  /** Opens the full settings drawer for this station */
  onEditStation?: (station: Station) => void;
  /** Opens the share modal for a station card */
  onShareStation?: (station: Station) => void;
  /** Pinned preset IDs — pinned cards sort to the front with a star accent */
  pinnedStationIds?: readonly string[];
  /** Toggle pin/favorite for a preset card */
  onTogglePin?: (stationId: string) => void;
};

/**
 * Host picker hung off the card's DJ badge. Kept on the card rather than behind
 * the settings drawer because reassigning a host is the one override listeners
 * reach for while browsing.
 */
function HostBadgePopover({
  station,
  personaId,
  isOverridden,
  onSelect,
}: {
  station: Station;
  personaId: PersonaId;
  isOverridden: boolean;
  onSelect: (personaId: PersonaId | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const persona = getPersonaById(personaId);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Host for ${station.name}: ${persona?.name ?? "DJ"}. Activate to change.`}
        className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
          isOverridden
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
            : "border-transparent text-zinc-500 hover:border-zinc-700 hover:text-amber-400"
        }`}
      >
        <Mic2 className="h-3 w-3" aria-hidden="true" />
        {persona?.name ?? "DJ"}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={`Assign host for ${station.name}`}
          className="absolute bottom-full left-0 z-50 mb-1.5 w-48 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
        >
          <button
            type="button"
            role="option"
            aria-selected={!isOverridden}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(null);
              setOpen(false);
            }}
            className={`block w-full border-b border-zinc-800 px-3 py-2 text-left font-sans text-[11px] transition-colors hover:bg-zinc-900 ${
              isOverridden ? "text-zinc-400" : "text-amber-400"
            }`}
          >
            Station Default
          </button>
          {PERSONAS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={isOverridden && option.id === personaId}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(option.id);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left transition-colors hover:bg-zinc-900 ${
                isOverridden && option.id === personaId ? "bg-amber-500/10" : ""
              }`}
            >
              <span
                className={`block font-sans text-[11px] ${
                  isOverridden && option.id === personaId ? "text-amber-400" : "text-zinc-200"
                }`}
              >
                {option.name}
              </span>
              <span className="block font-mono text-[9px] text-zinc-500">
                {option.defaultGenre}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CarouselCard({
  station,
  isActive,
  onSelect,
  onDelete,
  showAccent,
  hostPersonaId,
  onHostOverride,
  eraLock,
  onEdit,
  onShare,
  isPinned,
  onTogglePin,
}: {
  station: Station;
  isActive: boolean;
  onSelect: (e: MouseEvent) => void;
  onDelete?: () => void;
  showAccent?: boolean;
  hostPersonaId: PersonaId;
  onHostOverride?: (personaId: PersonaId | null) => void;
  eraLock: EraLock;
  onEdit?: () => void;
  onShare?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const persona = getPersonaById(hostPersonaId);
  const hostIsOverridden = hostPersonaId !== station.defaultPersonaId;
  const eraBadge = isEraLocked(eraLock) ? getEraDefinition(eraLock).shortLabel : null;
  const cornerButtonCount =
    (onDelete ? 1 : 0) + (onEdit ? 1 : 0) + (onShare ? 1 : 0) + (onTogglePin ? 1 : 0);

  return (
    <div className="relative w-[200px] sm:w-[240px] flex-shrink-0 snap-start">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(e);
        }}
        className={`group text-left rounded-xl p-4 pb-10 cursor-pointer transition-all duration-200 w-full h-full ${
          isActive
            ? "bg-zinc-900 border border-amber-500/60 ring-2 ring-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.35)] scale-105"
            : isPinned
              ? "bg-zinc-900/70 border border-amber-500/35 shadow-[0_0_12px_rgba(245,158,11,0.12)] hover:bg-zinc-900 hover:border-amber-500/50"
              : "bg-zinc-900/60 border border-zinc-800 hover:bg-zinc-900 hover:border-zinc-700"
        }`}
      >
        <div
          className="flex items-center gap-2 mb-2"
          style={{ paddingRight: cornerButtonCount * 26 }}
        >
          <span className={fmBadgeClass}>
            <Radio className="h-3 w-3 opacity-70" />
            {station.frequency.toFixed(1)} FM
          </span>
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
        <h3 className="text-zinc-100 font-sans font-semibold text-sm group-hover:text-amber-400 transition-colors leading-snug line-clamp-2">
          {station.name}
        </h3>
        <p className="text-zinc-400 font-sans text-xs line-clamp-2 mt-1.5 leading-relaxed">
          {station.description}
        </p>
      </button>

      {/*
        Host picker and era badge sit outside the card button: a popover trigger
        nested inside a button is invalid markup and swallows its own clicks.
      */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center gap-1.5">
        {onHostOverride ? (
          <HostBadgePopover
            station={station}
            personaId={hostPersonaId}
            isOverridden={hostIsOverridden}
            onSelect={onHostOverride}
          />
        ) : (
          <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
            <Mic2 className="h-3 w-3" aria-hidden="true" />
            {persona?.name ?? "DJ"}
          </span>
        )}
        {eraBadge && (
          <span
            className="ml-auto shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums text-amber-400"
            title={`Era locked to the ${eraBadge}`}
          >
            {eraBadge}
          </span>
        )}
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-0.5">
        {onTogglePin && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className={`p-1.5 rounded-md transition-colors ${
              isPinned
                ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/15"
                : "text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10"
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
            className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            aria-label={`Share ${station.name}`}
            title="Share station link"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1.5 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            aria-label={`Edit ${station.name} settings`}
            title="Station settings"
          >
            <Sliders className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
  resolveHostId,
  onHostOverride,
  resolveEraLockFor,
  onEditStation,
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
              hostPersonaId={resolveHostId?.(station) ?? station.defaultPersonaId}
              onHostOverride={
                onHostOverride
                  ? (personaId) => onHostOverride(station.id, personaId)
                  : undefined
              }
              eraLock={resolveEraLockFor?.(station) ?? "all"}
              onEdit={onEditStation ? () => onEditStation(station) : undefined}
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
