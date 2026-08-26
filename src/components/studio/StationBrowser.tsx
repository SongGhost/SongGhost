"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Share2, Star, Trash2 } from "lucide-react";
import StationCard from "@/components/cards/StationCard";
import type { Station } from "@/data/stations";
import type { StudioMixShelfItem } from "@/lib/studio/manifest";
import { formatStationMetaTag } from "@/lib/station-meta";
import { isPinnedStation, sortStationsWithPinsFirst } from "@/lib/user/preferences";
import type { StationDefinition } from "@/types/user";
import { type EraLock } from "@/types/station";
import { stationArtworkUrl } from "@/components/studio/stationArtwork";

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

type TopFilter = "all" | "decades" | "genres" | "mixes" | "stations";

const TOP_PILLS: { id: TopFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "decades", label: "Decades" },
  { id: "genres", label: "Genres" },
  { id: "mixes", label: "My Mixes" },
  { id: "stations", label: "My Stations" },
];

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
  onRemoveMix: (id: string) => void;
  resolveEraLockFor?: (station: Station) => EraLock;
  isGuest?: boolean;
  /** Live now-playing artwork for the active station card; empty/null while idle. */
  activeStationNowPlayingArtwork?: string | null;
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
  onRemoveMix,
  resolveEraLockFor,
  isGuest = false,
  activeStationNowPlayingArtwork,
}: StationBrowserProps) {
  const router = useRouter();
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<TopFilter>("all");
  const [decadeSub, setDecadeSub] = useState<string | null>(null);
  const [genreSub, setGenreSub] = useState<string | null>(null);

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
    setFilter(next);
    setDecadeSub(null);
    setGenreSub(null);
  };

  const emptyMessage = (() => {
    if (items.length > 0) return null;
    if (filter === "stations") return "No saved stations yet.";
    if (filter === "mixes") return "No mixes yet.";
    if (filter === "decades" && decadeSub) return `No stations for ${decadeSub}.`;
    if (filter === "genres" && genreSub) return `No stations for ${genreSub}.`;
    return "No stations in this filter.";
  })();

  const showDecadeSubs = filter === "decades";
  const showGenreSubs = filter === "genres";
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
          {TOP_PILLS.map((pill) => {
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
            disabled={items.length === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount("right")}
            aria-label={`Scroll ${rowTitle} right`}
            className={arrowBtnClass}
            disabled={items.length === 0}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showDecadeSubs && (
        <div
          className="flex gap-1.5 overflow-x-auto scrollbar-none flex-nowrap"
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
      )}

      {showGenreSubs && (
        <div
          className="flex gap-1.5 overflow-x-auto scrollbar-none flex-nowrap"
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
      )}

      {emptyMessage ? (
        <p className="rounded-xl border border-dashed border-white/[0.12] bg-[#121215]/60 px-4 py-5 text-center font-sans text-sm text-zinc-400">
          {emptyMessage}
        </p>
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
                  onClick={() => onPlayMix(mix)}
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
                onClick={(e) => handleSelectStation(station, e)}
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
