"use client";

import { useRef, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Share2, Star, Trash2 } from "lucide-react";
import StationCard from "@/components/cards/StationCard";
import type { Station } from "@/data/stations";
import { formatStationMetaTag } from "@/lib/station-meta";
import { isPinnedStation, sortStationsWithPinsFirst } from "@/lib/user/preferences";
import { getYouTubeThumbnail } from "@/lib/youtube";
import { type EraLock } from "@/types/station";

const SCROLL_AMOUNT_PX = 320;
const EMPTY_PINNED_IDS: readonly string[] = [];

const arrowBtnClass =
  "h-8 w-8 shrink-0 flex items-center justify-center rounded-full border border-white/[0.08] bg-[#121215] text-zinc-300 transition-colors hover:text-accent hover:border-accent/50 disabled:opacity-30 disabled:pointer-events-none";

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

function stationArtworkUrl(station: Station): string | null {
  const cover = station.coverUrl?.trim();
  if (cover) return cover;
  const lead =
    station.tracks.find((t) => t.youtubeId?.trim())?.youtubeId ??
    station.youtubeVideoId;
  return lead?.trim() ? getYouTubeThumbnail(lead.trim(), "hq") : null;
}

function metaTags(metaTag: string, isPinned: boolean): string[] {
  const tags = metaTag
    .split("•")
    .map((part) => part.trim())
    .filter(Boolean);
  if (isPinned) tags.push("Pinned");
  return tags;
}

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
  const leadTrack = station.tracks[0];
  const subtitle = leadTrack
    ? `${leadTrack.artist} — ${leadTrack.title}`
    : station.description;

  const actions = (
    <>
      {onTogglePin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className={`rounded-md p-1.5 transition-colors ${
            isPinned
              ? "text-accent hover:bg-accent/15 hover:text-accent"
              : "text-zinc-500 hover:bg-accent/10 hover:text-accent"
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
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-accent/10 hover:text-accent"
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
    </>
  );

  return (
    <StationCard
      artworkUrl={stationArtworkUrl(station)}
      title={station.name}
      subtitle={subtitle}
      tags={metaTags(metaTag, Boolean(isPinned))}
      isActive={isActive}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(e);
      }}
      accentColor={showAccent ? station.accentColor : undefined}
      actions={actions}
    />
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
