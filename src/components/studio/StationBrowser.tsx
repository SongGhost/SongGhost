"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, ChevronLeft, ChevronRight, Share2, Star, Trash2 } from "lucide-react";
import StationCard from "@/components/cards/StationCard";
import type { Station } from "@/data/stations";
import type { StudioMixShelfItem } from "@/lib/studio/manifest";
import { formatStationMetaTag } from "@/lib/station-meta";
import { isPinnedStation, sortStationsWithPinsFirst } from "@/lib/user/preferences";
import type { StationDefinition } from "@/types/user";
import { type EraLock } from "@/types/station";
import { stationArtworkUrl } from "@/components/studio/stationArtwork";
import {
  inspiredRowMode,
  TOP_PILLS,
  visibleTopPills,
  type TopFilter,
} from "@/components/studio/stationBrowserFilters";
import { INSPIRED_CARD_STAGGER_MS, isInspiredStationId } from "@/lib/inspired-stations";

export type { TopFilter };
export { TOP_PILLS, visibleTopPills, inspiredRowMode };

const SCROLL_AMOUNT_PX = 320;
const EMPTY_PINNED_IDS: readonly string[] = [];

const DECADE_SLUG = /^(50s|60s|70s|80s|90s|2000s|2010s|2020s)$/i;
const DECADE_ORDER = ["50s", "60s", "70s", "80s", "90s", "Y2K", "2000s", "2010s", "2020s"];

const arrowBtnClass =
  "h-8 w-8 shrink-0 flex items-center justify-center rounded-full border border-white/[0.08] bg-[#121215] text-zinc-300 transition-colors hover:text-accent hover:border-accent/50 disabled:opacity-30 disabled:pointer-events-none";

const pillClass = (active: boolean) =>
  `rounded-full border px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider transition-all ${
    active
      ? "border-accent bg-accent/15 text-accent shadow-[0_0_14px_var(--brand-accent-glow)]"
      : "border-white/[0.08] bg-[#121215] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200"
  }`;

export type StationBrowserProps = {
  decades: readonly Station[];
  genres: readonly Station[];
  savedStations: readonly StationDefinition[];
  studioMixes: readonly StudioMixShelfItem[];
  activeStationId: string;
  onSelect: (
    station: Station,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => void;
  onShareStation?: (station: Station) => void;
  pinnedStationIds?: readonly string[];
  onTogglePin?: (stationId: string) => void;
  onDeleteStation: (stationId: string) => void;
  onPlayMix: (mix: StudioMixShelfItem) => void;
  onPreviewMix?: (mix: StudioMixShelfItem) => void;
  onRemoveMix: (id: string) => void;
  resolveEraLockFor?: (station: Station) => EraLock;
  isGuest?: boolean;
  /** Live now-playing artwork for the active station card; empty/null while idle. */
  activeStationNowPlayingArtwork?: string | null;
  /** Session-ephemeral AI-curated set from the last searchbar launch. */
  inspiredStations?: readonly Station[];
  inspiredLoading?: boolean;
  /** Controlled top-pill so a search launch can auto-select Inspired. */
  filter?: TopFilter;
  onFilterChange?: (filter: TopFilter) => void;
  onPlayInspired?: (station: Station) => void;
  onSaveInspired?: (station: Station) => void;
  inspiredResolvingId?: string | null;
  onPreviewStation?: (station: Station) => void;
};

type BrowserItem =
  | { kind: "station"; station: Station; catalog: boolean; saved: boolean }
  | { kind: "mix"; mix: StudioMixShelfItem };

function formatDecadeLabel(value: string): string {
  const lower = value.toLowerCase();
  if (DECADE_SLUG.test(lower)) return lower;
  if (lower === "y2k") return "Y2K";
  return value;
}

function decadeLabelFor(station: Station): string {
  const head = station.id.split("-")[0] ?? "";
  if (DECADE_SLUG.test(head) || /^y2k$/i.test(head)) {
    return formatDecadeLabel(head);
  }
  const fromName = station.name.match(/\b(50s|60s|70s|80s|90s|2000s|2010s|2020s|Y2K)\b/i);
  if (fromName?.[1]) return formatDecadeLabel(fromName[1]);
  return "Other";
}

function uniqueSortedDecades(stations: readonly Station[]): string[] {
  const present = new Set(stations.map(decadeLabelFor));
  const ordered = DECADE_ORDER.filter((label) => present.has(label));
  for (const label of present) {
    if (!ordered.includes(label)) ordered.push(label);
  }
  return ordered;
}

function uniqueSortedGenres(stations: readonly Station[]): string[] {
  return [...new Set(stations.map((station) => station.name))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function metaTags(metaTag: string, isPinned: boolean): string[] {
  const tags = metaTag
    .split("•")
    .map((part) => part.trim())
    .filter(Boolean);
  if (isPinned) tags.push("Pinned");
  return tags;
}

function mixArtworkUrl(mix: StudioMixShelfItem): string | null {
  return mix.coverImageUrl?.trim() || mix.manifest?.coverImageUrl?.trim() || null;
}

export default function StationBrowser({
  decades,
  genres,
  savedStations,
  studioMixes,
  activeStationId,
  onSelect,
  onShareStation,
  pinnedStationIds,
  onTogglePin,
  onDeleteStation,
  onPlayMix,
  onPreviewMix,
  onRemoveMix,
  resolveEraLockFor,
  isGuest = false,
  activeStationNowPlayingArtwork,
  inspiredStations = [],
  inspiredLoading = false,
  filter: controlledFilter,
  onFilterChange,
  onPlayInspired,
  onSaveInspired,
  inspiredResolvingId = null,
  onPreviewStation,
}: StationBrowserProps) {
  const router = useRouter();
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const decadeSubRef = useRef<HTMLDivElement>(null);
  const genreSubRef = useRef<HTMLDivElement>(null);
  const [internalFilter, setInternalFilter] = useState<TopFilter>("all");
  const filter = controlledFilter ?? internalFilter;
  const [decadeSub, setDecadeSub] = useState<string | null>(null);
  const [genreSub, setGenreSub] = useState<string | null>(null);
  const [inspiredStreamIn, setInspiredStreamIn] = useState(false);
  const inspiredSetKey = inspiredStations.map((station) => station.id).join("|");

  useEffect(() => {
    if (inspiredLoading) {
      setInspiredStreamIn(false);
      return;
    }
    if (!inspiredStations.length) {
      setInspiredStreamIn(false);
      return;
    }
    setInspiredStreamIn(false);
    const frame = window.requestAnimationFrame(() => setInspiredStreamIn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [inspiredLoading, inspiredSetKey, inspiredStations.length]);

  const pinnedIds = pinnedStationIds ?? EMPTY_PINNED_IDS;
  const decadeIds = useMemo(() => new Set(decades.map((s) => s.id)), [decades]);
  const genreIds = useMemo(() => new Set(genres.map((s) => s.id)), [genres]);

  const decadeSubs = useMemo(() => uniqueSortedDecades(decades), [decades]);
  const genreSubs = useMemo(() => uniqueSortedGenres(genres), [genres]);

  const items = useMemo((): BrowserItem[] => {
    const asCatalog = (station: Station): BrowserItem => ({
      kind: "station",
      station,
      catalog: decadeIds.has(station.id) || genreIds.has(station.id),
      saved: false,
    });
    const asSaved = (station: Station): BrowserItem => ({
      kind: "station",
      station,
      catalog: false,
      saved: true,
    });
    const asMix = (mix: StudioMixShelfItem): BrowserItem => ({ kind: "mix", mix });

    if (filter === "decades") {
      const set = decadeSub
        ? decades.filter((station) => decadeLabelFor(station) === decadeSub)
        : decades;
      const ordered = onTogglePin ? sortStationsWithPinsFirst(set, pinnedIds) : [...set];
      return ordered.map(asCatalog);
    }

    if (filter === "genres") {
      const set = genreSub ? genres.filter((station) => station.name === genreSub) : genres;
      const ordered = onTogglePin ? sortStationsWithPinsFirst(set, pinnedIds) : [...set];
      return ordered.map(asCatalog);
    }

    if (filter === "mixes") {
      return studioMixes.map(asMix);
    }

    if (filter === "stations") {
      return savedStations.map(asSaved);
    }

    if (filter === "inspired") {
      return [];
    }

    const catalog = onTogglePin
      ? sortStationsWithPinsFirst([...decades, ...genres], pinnedIds)
      : [...decades, ...genres];
    return [
      ...catalog.map(asCatalog),
      ...savedStations.map(asSaved),
      ...studioMixes.map(asMix),
    ];
  }, [
    filter,
    decadeSub,
    genreSub,
    decades,
    genres,
    savedStations,
    studioMixes,
    onTogglePin,
    pinnedIds,
    decadeIds,
    genreIds,
  ]);

  const scrollByAmount = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -SCROLL_AMOUNT_PX : SCROLL_AMOUNT_PX,
      behavior: "smooth",
    });
  };

  const scrollSubByAmount = (ref: React.RefObject<HTMLDivElement | null>, direction: "left" | "right") => {
    ref.current?.scrollBy({
      left: direction === "left" ? -SCROLL_AMOUNT_PX : SCROLL_AMOUNT_PX,
      behavior: "smooth",
    });
  };

  const handleSelectStation = (
    station: Station,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => {
    e?.preventDefault();
    e?.stopPropagation();
    onSelect(station, e);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const applyTopFilter = (next: TopFilter) => {
    if (onFilterChange) onFilterChange(next);
    else setInternalFilter(next);
    setDecadeSub(null);
    setGenreSub(null);
  };

  const emptyMessage = (() => {
    if (filter === "inspired") return null;
    if (items.length > 0) return null;
    if (filter === "stations") return "No saved stations yet.";
    if (filter === "mixes") return "No mixes yet.";
    if (filter === "decades" && decadeSub) return `No stations for ${decadeSub}.`;
    if (filter === "genres" && genreSub) return `No stations for ${genreSub}.`;
    return "No stations in this filter.";
  })();

  const showDecadeSubs = filter === "decades";
  const showGenreSubs = filter === "genres";
  const showingInspired = filter === "inspired";
  const inspiredMode = inspiredRowMode(inspiredStations, inspiredLoading);
  const pills = visibleTopPills(inspiredStations, inspiredLoading);
  const savedInspiredIds = useMemo(
    () => new Set(savedStations.map((station) => station.id)),
    [savedStations],
  );
  const rowHasCards =
    showingInspired
      ? inspiredMode === "skeleton" || inspiredStations.length > 0
      : items.length > 0;
  const rowTitle =
    filter === "all"
      ? "Stations"
      : TOP_PILLS.find((pill) => pill.id === filter)?.label ?? "Stations";

  return (
    <section className="space-y-3" data-guest={isGuest ? "true" : "false"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label="Station filters"
        >
          {pills.map((pill) => {
            const active = filter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => applyTopFilter(pill.id)}
                className={pillClass(active)}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollByAmount("left")}
            aria-label={`Scroll ${rowTitle} left`}
            className={arrowBtnClass}
            disabled={!rowHasCards}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount("right")}
            aria-label={`Scroll ${rowTitle} right`}
            className={arrowBtnClass}
            disabled={!rowHasCards}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showDecadeSubs && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollSubByAmount(decadeSubRef, "left")}
            aria-label="Scroll decade filters left"
            className={`${arrowBtnClass} hidden sm:flex`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div
            ref={decadeSubRef}
            className="flex flex-1 gap-1.5 overflow-x-auto scrollbar-none flex-nowrap"
            role="tablist"
            aria-label="Decade filters"
          >
            <button
              type="button"
              role="tab"
              aria-selected={decadeSub === null}
              onClick={() => setDecadeSub(null)}
              className={`${pillClass(decadeSub === null)} shrink-0 whitespace-nowrap`}
            >
              All Decades
            </button>
            {decadeSubs.map((label) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={decadeSub === label}
                onClick={() => setDecadeSub(label)}
                className={`${pillClass(decadeSub === label)} shrink-0 whitespace-nowrap`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => scrollSubByAmount(decadeSubRef, "right")}
            aria-label="Scroll decade filters right"
            className={`${arrowBtnClass} hidden sm:flex`}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {showGenreSubs && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollSubByAmount(genreSubRef, "left")}
            aria-label="Scroll genre filters left"
            className={`${arrowBtnClass} hidden sm:flex`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div
            ref={genreSubRef}
            className="flex flex-1 gap-1.5 overflow-x-auto scrollbar-none flex-nowrap"
            role="tablist"
            aria-label="Genre filters"
          >
            <button
              type="button"
              role="tab"
              aria-selected={genreSub === null}
              onClick={() => setGenreSub(null)}
              className={`${pillClass(genreSub === null)} shrink-0 whitespace-nowrap`}
            >
              All Genres
            </button>
            {genreSubs.map((label) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={genreSub === label}
                onClick={() => setGenreSub(label)}
                className={`${pillClass(genreSub === label)} shrink-0 whitespace-nowrap`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => scrollSubByAmount(genreSubRef, "right")}
            aria-label="Scroll genre filters right"
            className={`${arrowBtnClass} hidden sm:flex`}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {emptyMessage ? (
        <p className="rounded-xl border border-dashed border-white/[0.12] bg-[#121215]/60 px-4 py-5 text-center font-sans text-sm text-zinc-400">
          {emptyMessage}
        </p>
      ) : showingInspired ? (
        <div className="space-y-2">
          {inspiredLoading ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Curating…
            </p>
          ) : null}
          <div
          ref={scrollRef}
          className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
          aria-busy={inspiredLoading || undefined}
          aria-label="Inspired stations"
        >
          {inspiredMode === "skeleton"
            ? [0, 1, 2, 3, 4].map((slot) => (
                <div
                  key={`inspired-skel-${slot}`}
                  className="h-[260px] w-[200px] flex-shrink-0 animate-pulse rounded-xl border border-white/[0.08] bg-[#121215] sm:w-[240px]"
                  aria-hidden="true"
                >
                  <div className="m-3.5 aspect-square rounded-lg bg-white/[0.06]" />
                  <div className="mx-3.5 mt-2 h-3 w-2/3 rounded bg-white/[0.08]" />
                  <div className="mx-3.5 mt-2 h-2.5 w-full rounded bg-white/[0.05]" />
                  <p className="sr-only">Curating inspired stations</p>
                </div>
              ))
            : inspiredStations.map((station, index) => {
                const liveArt = activeStationNowPlayingArtwork?.trim();
                const artworkUrl =
                  station.id === activeStationId && liveArt
                    ? liveArt
                    : stationArtworkUrl(station, daySeed);
                const saved = savedInspiredIds.has(station.id);
                const tags = [
                  ...(station.seedGenres ?? []),
                  ...(station.eras ?? []),
                ].slice(0, 3);
                return (
                  <div
                    key={`inspired:${station.id}`}
                    className="transition-[opacity,transform] duration-500 ease-out"
                    style={{
                      opacity: inspiredStreamIn ? 1 : 0,
                      transform: inspiredStreamIn ? "translateY(0)" : "translateY(10px)",
                      transitionDelay: `${index * INSPIRED_CARD_STAGGER_MS}ms`,
                    }}
                  >
                    <StationCard
                      artworkUrl={artworkUrl}
                      title={station.name}
                      subtitle={station.description}
                      tags={tags.length ? tags : ["Inspired"]}
                      isActive={activeStationId === station.id}
                      accentColor={station.accentColor}
                      useAccentArt
                      busy={inspiredResolvingId === station.id}
                      onClick={() => {
                        onPlayInspired?.(station);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      actions={
                        onSaveInspired ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!saved) onSaveInspired(station);
                            }}
                            className={`rounded-md p-1.5 transition-colors ${
                              saved
                                ? "text-accent"
                                : "text-zinc-500 hover:bg-accent/10 hover:text-accent"
                            }`}
                            aria-label={
                              saved ? `${station.name} saved` : `Save ${station.name}`
                            }
                            aria-pressed={saved}
                            title={saved ? "Saved" : "Save to My Stations"}
                          >
                            <Bookmark
                              className={`h-3.5 w-3.5 ${saved ? "fill-current" : ""}`}
                            />
                          </button>
                        ) : null
                      }
                    />
                  </div>
                );
              })}
          {inspiredLoading && inspiredMode === "skeleton" ? (
            <p className="sr-only">Curating inspired stations</p>
          ) : null}
        </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
        >
          {items.map((item) => {
            if (item.kind === "mix") {
              const mix = item.mix;
              const stationId = `studio-${mix.id}`;
              const lead = mix.manifest?.tracks?.[0];
              return (
                <StationCard
                  key={`mix:${mix.id}`}
                  artworkUrl={mixArtworkUrl(mix)}
                  title={mix.name}
                  subtitle={
                    lead
                      ? `${lead.artist} — ${lead.title}`
                      : `${mix.trackCount} track${mix.trackCount === 1 ? "" : "s"}`
                  }
                  tags={["Studio Mix", `${mix.trackCount} tracks`]}
                  isActive={activeStationId === stationId}
                  accentColor={mix.accentColor}
                  onClick={(e) => {
                    e?.preventDefault();
                    e?.stopPropagation();
                    if (onPreviewMix) onPreviewMix(mix);
                    else onPlayMix(mix);
                  }}
                  onEdit={() => router.push("/studio?edit=" + mix.id)}
                  actions={
                    <>
                      <Link
                        href={`/s/${encodeURIComponent(mix.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-accent/10 hover:text-accent"
                        aria-label={`Share ${mix.name}`}
                        title="Share mix link"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveMix(mix.id);
                        }}
                        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        aria-label={`Delete ${mix.name}`}
                        title="Delete mix"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  }
                />
              );
            }

            const { station, catalog, saved } = item;
            const pinned = isPinnedStation(station.id, pinnedIds);
            const eraLock = resolveEraLockFor?.(station) ?? "all";
            const metaTag = formatStationMetaTag(station, eraLock);
            const leadTrack = station.tracks[0];
            const subtitle = leadTrack
              ? `${leadTrack.artist} — ${leadTrack.title}`
              : station.description;
            const liveArt = activeStationNowPlayingArtwork?.trim();
            const artworkUrl =
              station.id === activeStationId && liveArt
                ? liveArt
                : stationArtworkUrl(station, daySeed);

            return (
              <StationCard
                key={`${saved ? "saved" : "catalog"}:${station.id}`}
                artworkUrl={artworkUrl}
                title={station.name}
                subtitle={subtitle}
                tags={metaTags(metaTag, catalog && pinned)}
                isActive={activeStationId === station.id}
                accentColor={saved ? station.accentColor : undefined}
                useAccentArt={saved && isInspiredStationId(station.id)}
                onClick={(e) => {
                  e?.preventDefault();
                  e?.stopPropagation();
                  if (onPreviewStation) onPreviewStation(station);
                  else handleSelectStation(station, e);
                }}
                actions={
                  <>
                    {catalog && onTogglePin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePin(station.id);
                        }}
                        className={`rounded-md p-1.5 transition-colors ${
                          pinned
                            ? "text-accent hover:bg-accent/15 hover:text-accent"
                            : "text-zinc-500 hover:bg-accent/10 hover:text-accent"
                        }`}
                        aria-label={pinned ? `Unpin ${station.name}` : `Pin ${station.name}`}
                        aria-pressed={pinned}
                        title={pinned ? "Unpin preset" : "Pin preset"}
                      >
                        <Star className={`h-3.5 w-3.5 ${pinned ? "fill-current" : ""}`} />
                      </button>
                    )}
                    {onShareStation && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onShareStation(station);
                        }}
                        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-accent/10 hover:text-accent"
                        aria-label={`Share ${station.name}`}
                        title="Share station link"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {saved && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteStation(station.id);
                        }}
                        className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        aria-label={`Delete ${station.name}`}
                        title="Delete station"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
