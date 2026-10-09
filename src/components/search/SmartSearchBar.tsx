"use client";

import { Disc3, Loader2, Mic, MicOff, Radio, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useVoiceSearch } from "@/hooks/useVoiceSearch";
import StationCard from "@/components/cards/StationCard";
import {
  SEARCH_MODE_OPTIONS,
  type MusicSearchMode,
} from "@/components/search/SearchModePills";
import type { CuratedPlaylistResult } from "@/types/curator";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import type { AlbumRadioResult } from "@/lib/album-radio";
import type { ArtistRadioMode, ArtistRadioResult } from "@/lib/artist-radio";
import {
  formatMixNeighborParam,
  formatStoredPoolParam,
  mergeMixNeighbors,
  neighborNamesFromTracks,
  readStoredMixNeighbors,
  readStoredMixPool,
  recallMixNeighbors,
  rememberMixNeighbors,
  storeMixNeighbors,
  storeMixPool,
} from "@/lib/artist-mix";
import {
  performArtistRadioClick,
  type ArtistRadioFailureNotice,
} from "@/lib/artist-radio-handoff";
import { performCuratorClick, type CuratorFailureNotice } from "@/lib/curator-handoff";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import { getFailedYoutubeIds } from "@/lib/failed-youtube-ids";
import { itunesArtistsMatch, itunesTrackMatchesQuery } from "@/lib/itunes";
import { recordingDedupeKey, type SongCatalogCursor } from "@/lib/song-search-catalog";
import { curatorPromptTarget } from "@/lib/curate-playlist";
import {
  readStoredCuratedTitles,
  storeCuratedTitles,
} from "@/lib/curated-prompt-memory";
import { getRecentTrackIds } from "@/lib/queue/recent-tracks";
import { SEARCH_PROMPTS, type SearchPrompt } from "@/data/search-prompts";
import type {
  SearchAlbumResult,
  SearchArtistResult,
  SearchTrackResult,
  SmartSearchResponse,
} from "@/types/studio-search";

export type { MusicSearchMode };

export type AlbumSuggestItem = {
  collectionId: number;
  albumTitle: string;
  artist: string;
  releaseYear: number | null;
  coverArtUrl: string | null;
  trackCount: number | null;
};

type SmartSearchBarProps = {
  onLaunch: (result: ArtistRadioResult) => void;
  /** Beat 2 songs. Appended after the station has started. Index 0 stays. */
  onArtistRadioTail?: (tracks: ArtistRadioResult["tracks"]) => void;
  /** Take the current station off the air before /api/artist-radio returns. */
  onArtistRadioYield: (artistName: string, stationLabel?: string) => void;
  /** Lookup failed. The previous station stays off. */
  onArtistRadioFailed: (notice: ArtistRadioFailureNotice) => void;
  /** Take the current station off the air before /api/curate-playlist returns. */
  onCuratorYield: (prompt: string) => void;
  /** Prompt failed. The previous station stays off. */
  onCuratorFailed: (notice: CuratorFailureNotice) => void;
  onLoadCurated: (station: Station, tracks: StationTrack[], personaId: PersonaId) => void;
  onLaunchAlbum: (result: AlbumRadioResult) => void;
  disabled?: boolean;
  /** Advanced Tuning drawer open state — expanded under SearchSection */
  tunerOpen?: boolean;
  /** Expands / collapses TuneStationPanel under the search bar */
  onToggleTuner?: () => void;
  /** High-contrast accent border on the search input (dashboard SearchSection). */
  accentBorder?: boolean;
  /** Hide the built-in label when the parent section already renders the title. */
  hideLabel?: boolean;
  /**
   * Mobile full-screen search: render results in-flow (no absolute overlay).
   * Desktop keeps the dropdown. SearchSection sets this below 768px.
   */
  inlineResults?: boolean;
  /** Called when a result is chosen or launch starts — closes the mobile full-screen view. */
  onClose?: () => void;
};

function pillLaunchMode(current: MusicSearchMode): ArtistRadioMode {
  if (current === "artist-only") return "artist-only";
  return "mixed";
}

function formatDuration(sec?: number): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return "";
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type SongListTrack = SearchTrackResult & { section: "artist" | "similar" };

type SongCatalogResponse = {
  artistName?: string | null;
  tracks?: SongListTrack[];
  cursor?: SongCatalogCursor | null;
  exhausted?: boolean;
  similarOpen?: boolean;
  error?: string;
};

function emptySearch(): SmartSearchResponse {
  return { tracks: [], artists: [], albums: [] };
}

const IDLE_PLACEHOLDER_MS = 5000;

type CatalogFilter = "all" | "albums" | "songs" | "artists" | "ai";

const CATALOG_FILTERS: { id: CatalogFilter; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "albums", label: "ALBUMS" },
  { id: "songs", label: "SONGS" },
  { id: "artists", label: "ARTISTS" },
  { id: "ai", label: "AI" },
];

function typeParamForFilter(filter: CatalogFilter): string | null {
  if (filter === "albums") return "album";
  if (filter === "songs") return "track";
  if (filter === "artists") return "artist";
  if (filter === "ai") return null;
  return "track,artist,album";
}

function itunesTrackIdFromSearchId(id: string): number | undefined {
  if (!id.startsWith("itunes:")) return undefined;
  const value = Number(id.slice("itunes:".length));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function ActionBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-accent/90">
      {label}
    </span>
  );
}

function SongResultRow({
  track,
  index,
  activeIndex,
  onSongMix,
  onSongRadio,
}: {
  track: SearchTrackResult;
  index: number;
  activeIndex: number;
  onSongMix: (track: SearchTrackResult) => void;
  onSongRadio: (track: SearchTrackResult) => void;
}) {
  const duration = formatDuration(track.durationSec);
  const tags = [duration || null, track.album?.trim() || null].filter(
    (tag): tag is string => Boolean(tag),
  );
  return (
    <li
      role="option"
      aria-selected={index === activeIndex}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="relative">
        <StationCard
          variant="compact"
          artworkUrl={track.artworkUrl}
          title={track.title}
          subtitle={track.artist}
          tags={tags}
          isActive={index === activeIndex}
          reserveEnd
          onClick={() => onSongMix(track)}
        />
        <div className="absolute right-1.5 top-1.5 z-20">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSongRadio(track)}
            className="whitespace-nowrap rounded border border-accent/30 bg-[#121215]/95 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-accent/90 hover:border-accent hover:bg-accent/15"
            aria-label={`Artist only for ${track.artist}, starting with ${track.title}`}
          >
            Artist only
          </button>
        </div>
      </div>
    </li>
  );
}

function SearchResultsBody({
  resultFilter,
  visibleAlbums,
  visibleTracks,
  similarTracks,
  visibleArtists,
  hasDropdownResults,
  activeIndex,
  onFilter,
  onSelectAlbum,
  onSongMix,
  onSongRadio,
  onSelectArtist,
  songsEndless,
  songsPaging,
  songsExhausted,
  similarOpen,
  onNeedMoreSongs,
}: {
  resultFilter: CatalogFilter;
  visibleAlbums: SearchAlbumResult[];
  visibleTracks: SearchTrackResult[];
  similarTracks: SearchTrackResult[];
  visibleArtists: SearchArtistResult[];
  hasDropdownResults: boolean;
  activeIndex: number;
  onFilter: (filter: CatalogFilter) => void;
  onSelectAlbum: (album: SearchAlbumResult) => void;
  onSongMix: (track: SearchTrackResult) => void;
  onSongRadio: (track: SearchTrackResult) => void;
  onSelectArtist: (artist: SearchArtistResult, launchMode: ArtistRadioMode) => void;
  songsEndless: boolean;
  songsPaging: boolean;
  songsExhausted: boolean;
  similarOpen: boolean;
  onNeedMoreSongs: () => void;
}) {
  let flatCursor = -1;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onNeedMoreRef = useRef(onNeedMoreSongs);
  onNeedMoreRef.current = onNeedMoreSongs;
  const songCount = visibleTracks.length + similarTracks.length;

  useEffect(() => {
    if (!songsEndless || songsExhausted || songsPaging) return;
    const root = scrollerRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onNeedMoreRef.current();
      },
      { root, rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [songsEndless, songsExhausted, songsPaging, songCount]);

  return (
    <>
      <div className="sticky top-0 z-10 shrink-0 border-b border-zinc-700/80 bg-[#121215]/95 px-2 py-1.5">
        <div
          className="flex flex-wrap gap-1"
          role="tablist"
          aria-label="Search result filters"
        >
          {CATALOG_FILTERS.map((chip) => {
            const selected = resultFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onFilter(chip.id)}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${
                  selected
                    ? "border-accent bg-accent/15 text-accent shadow-[0_0_10px_var(--brand-accent-glow)]"
                    : "border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-region p-1">
        {resultFilter === "ai" && (
          <p className="px-2 py-3 font-mono text-[11px] leading-relaxed text-zinc-400">
            AI Curator will build a station from your prompt. Press Generate Station to continue.
          </p>
        )}

        {visibleAlbums.length > 0 && (
          <section className="mb-1.5">
            <h3 className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-accent/80">
              Albums
            </h3>
            <ul className="space-y-0.5">
              {visibleAlbums.map((album) => {
                flatCursor += 1;
                const index = flatCursor;
                const tags = [
                  album.releaseYear ? String(album.releaseYear) : null,
                  album.trackCount ? `${album.trackCount} tracks` : null,
                ].filter((tag): tag is string => Boolean(tag));
                return (
                  <li
                    key={album.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className="relative">
                      <StationCard
                        variant="compact"
                        artworkUrl={album.artworkUrl}
                        title={album.title}
                        subtitle={album.artist}
                        tags={tags}
                        isActive={index === activeIndex}
                        onClick={() => onSelectAlbum(album)}
                      />
                      <div className="pointer-events-none absolute right-2 top-2">
                        <ActionBadge label="Album" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {visibleTracks.length > 0 && (
          <section className="mb-1.5">
            <h3 className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-accent/80">
              Songs
            </h3>
            <ul className="space-y-0.5">
              {visibleTracks.map((track) => {
                flatCursor += 1;
                return (
                  <SongResultRow
                    key={track.id}
                    track={track}
                    index={flatCursor}
                    activeIndex={activeIndex}
                    onSongMix={onSongMix}
                    onSongRadio={onSongRadio}
                  />
                );
              })}
            </ul>
          </section>
        )}

        {similarOpen && (
          <section className="mb-1.5">
            <h3 className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-accent/80">
              Similar artists
            </h3>
            {similarTracks.length > 0 && (
              <ul className="space-y-0.5">
                {similarTracks.map((track) => {
                  flatCursor += 1;
                  return (
                    <SongResultRow
                      key={track.id}
                      track={track}
                      index={flatCursor}
                      activeIndex={activeIndex}
                      onSongMix={onSongMix}
                      onSongRadio={onSongRadio}
                    />
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {visibleArtists.length > 0 && (
          <section className="mb-1.5">
            <h3 className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-accent/80">
              Artists
            </h3>
            <ul className="space-y-0.5">
              {visibleArtists.map((artist) => {
                flatCursor += 1;
                const index = flatCursor;
                return (
                  <li
                    key={artist.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className="relative">
                      <StationCard
                        variant="compact"
                        artworkUrl={artist.imageUrl}
                        title={artist.name}
                        subtitle={
                          artist.genres?.length ? artist.genres.join(" · ") : "Artist Radio"
                        }
                        isActive={index === activeIndex}
                        onClick={() => onSelectArtist(artist, "mixed")}
                      />
                      <div className="absolute right-1.5 top-1.5 z-20">
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onSelectArtist(artist, "artist-only")}
                          className="whitespace-nowrap rounded border border-accent/30 bg-[#121215]/95 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-accent/90 hover:border-accent hover:bg-accent/15"
                          aria-label={`Artist only for ${artist.name}`}
                        >
                          Artist only
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {resultFilter !== "ai" && !hasDropdownResults && !songsPaging && (
          <p className="px-2 py-3 font-mono text-[11px] text-zinc-500">
            No matching {resultFilter === "all" ? "results" : resultFilter} yet.
          </p>
        )}
        {songsEndless && (
          <div ref={sentinelRef} className="px-2 py-2">
            {songsPaging && (
              <p className="flex items-center gap-2 font-mono text-[11px] text-zinc-400" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Loading songs...
              </p>
            )}
            {songsExhausted && hasDropdownResults && (
              <p className="font-mono text-[11px] text-zinc-500" role="status">
                That&apos;s everything
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Idle rotating prompt overlay for mobile inline search — marquee when overflow. */
function IdleSearchHint({ text }: { text: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const sizerRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const sizer = sizerRef.current;
    if (!wrap || !sizer) return;

    const measure = () => {
      const overflow = sizer.scrollWidth - wrap.clientWidth;
      setOverflowPx(overflow > 1 ? overflow : 0);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(sizer);
    return () => ro.disconnect();
  }, [text]);

  const shouldScroll = overflowPx > 0 && !reducedMotion;
  const durationSec = Math.min(16, Math.max(8, overflowPx / 24));

  return (
    <span
      ref={wrapRef}
      aria-label={text}
      className="pointer-events-none absolute left-9 right-3 top-1/2 -translate-y-1/2 truncate font-mono text-sm text-zinc-500"
    >
      <span
        ref={sizerRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute whitespace-nowrap"
      >
        {text}
      </span>
      <span
        aria-hidden="true"
        className={
          shouldScroll
            ? "songhost-marquee-run inline-block will-change-transform"
            : "block truncate"
        }
        style={
          shouldScroll
            ? ({
                "--marquee-shift": `-${overflowPx}px`,
                animation: `songhost-marquee ${durationSec}s ease-in-out infinite`,
              } as CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}

export default function SmartSearchBar({
  onLaunch,
  onArtistRadioTail,
  onArtistRadioYield,
  onArtistRadioFailed,
  onCuratorYield,
  onCuratorFailed,
  onLoadCurated,
  onLaunchAlbum,
  disabled,
  tunerOpen = false,
  onToggleTuner,
  accentBorder = false,
  hideLabel = false,
  inlineResults = false,
  onClose,
}: SmartSearchBarProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<MusicSearchMode>("song-radio");
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SmartSearchResponse>(emptySearch);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resultFilter, setResultFilter] = useState<CatalogFilter>("all");
  const [songRows, setSongRows] = useState<SongListTrack[]>([]);
  const [songPaging, setSongPaging] = useState(false);
  const [songExhausted, setSongExhausted] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [rollingPromptText, setRollingPromptText] = useState<string | null>(null);
  const [rollingPaused, setRollingPaused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Blocks debounced/in-flight suggest calls once a result is chosen or launch starts. */
  const isSelectingRef = useRef(false);
  const lastCatalogModeRef = useRef<MusicSearchMode>("song-radio");
  const promptOrderRef = useRef<SearchPrompt[]>([]);
  const promptCursorRef = useRef(0);
  const songCursorRef = useRef<SongCatalogCursor | null>(null);
  const songSeenRef = useRef<string[]>([]);
  const songGenerationRef = useRef(0);
  const songLockRef = useRef(false);
  const songPendingQueryRef = useRef<string | null>(null);
  const queryRef = useRef("");
  const songExhaustedRef = useRef(false);
  queryRef.current = query;
  songExhaustedRef.current = songExhausted;

  const isCurator = mode === "curator";
  const isFullAlbum = mode === "full-album";
  const isSongRadio = mode === "song-radio";
  const isArtistRadio = mode === "artist-only";
  const isArtistMix = mode === "mixed";

  const dismissDropdown = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setShowDropdown(false);
    setResults(emptySearch());
    setActiveIndex(-1);
  }, []);

  const fetchSmartSearch = useCallback(async (q: string, filter: CatalogFilter) => {
    if (isSelectingRef.current) return;
    if (q.length < 2) {
      setResults(emptySearch());
      setShowDropdown(false);
      return;
    }

    const typeParam = typeParamForFilter(filter);
    if (!typeParam) {
      setResults(emptySearch());
      setShowDropdown(true);
      setActiveIndex(-1);
      return;
    }

    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(typeParam)}&limit=25`,
      );
      if (isSelectingRef.current) return;
      const data = (await res.json()) as SmartSearchResponse & { error?: string };
      if (isSelectingRef.current) return;
      if (!res.ok) {
        setResults(emptySearch());
        setShowDropdown(true);
        return;
      }
      setResults({
        tracks: data.tracks ?? [],
        artists: data.artists ?? [],
        albums: data.albums ?? [],
      });
      setShowDropdown(true);
      setActiveIndex(-1);
    } catch {
      if (isSelectingRef.current) return;
      setResults(emptySearch());
      setShowDropdown(true);
    }
  }, []);

  const loadSongCatalog = useCallback(async (q: string, reset: boolean) => {
    if (isSelectingRef.current) return;
    if (q.length < 2) {
      songGenerationRef.current += 1;
      songCursorRef.current = null;
      songSeenRef.current = [];
      songPendingQueryRef.current = null;
      setSongRows([]);
      setSongExhausted(false);
      setSimilarOpen(false);
      setSongPaging(false);
      setShowDropdown(false);
      return;
    }

    if (reset) {
      songGenerationRef.current += 1;
      songCursorRef.current = null;
      songSeenRef.current = [];
      songExhaustedRef.current = false;
      setSongRows([]);
      setSongExhausted(false);
      setSimilarOpen(false);
    }

    if (songLockRef.current) {
      if (reset) songPendingQueryRef.current = q;
      return;
    }
    if (!reset && songExhaustedRef.current) return;

    const generation = songGenerationRef.current;
    songLockRef.current = true;
    setSongPaging(true);
    setShowDropdown(true);

    try {
      const res = await fetch("/api/search/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q,
          cursor: reset ? null : songCursorRef.current,
          seen: reset ? [] : songSeenRef.current,
          pool: readStoredMixPool(q)?.pool ?? [],
        }),
      });
      if (generation !== songGenerationRef.current || isSelectingRef.current) return;
      const data = (await res.json()) as SongCatalogResponse;
      if (generation !== songGenerationRef.current || isSelectingRef.current) return;
      if (!res.ok) {
        setSongExhausted(true);
        return;
      }

      const tracks = (data.tracks ?? []).filter(
        (track) => track?.id && track.title && track.artist,
      );
      const fresh = tracks.filter((track) => {
        const key = recordingDedupeKey(track);
        return key && !songSeenRef.current.includes(key);
      });
      for (const track of fresh) {
        const key = recordingDedupeKey(track);
        if (key) songSeenRef.current.push(key);
      }

      const cursorUnchanged =
        !reset &&
        fresh.length === 0 &&
        JSON.stringify(data.cursor ?? null) === JSON.stringify(songCursorRef.current);
      songCursorRef.current = data.cursor ?? null;
      setSongRows((prev) => (reset ? fresh : [...prev, ...fresh]));
      setSimilarOpen(Boolean(data.similarOpen) || fresh.some((track) => track.section === "similar"));
      setSongExhausted(Boolean(data.exhausted) || cursorUnchanged);
      setActiveIndex(-1);
      setShowDropdown(true);
    } catch {
      if (generation !== songGenerationRef.current || isSelectingRef.current) return;
      if (reset) setSongRows([]);
      setSongExhausted(true);
      setShowDropdown(true);
    } finally {
      if (generation === songGenerationRef.current) setSongPaging(false);
      songLockRef.current = false;
      const pending = songPendingQueryRef.current;
      songPendingQueryRef.current = null;
      if (pending) {
        void loadSongCatalog(pending, true);
      }
    }
  }, []);

  const loadMoreSongs = useCallback(() => {
    const q = queryRef.current.trim();
    if (q.length < 2 || songExhaustedRef.current || songLockRef.current || isSelectingRef.current) {
      return;
    }
    void loadSongCatalog(q, false);
  }, [loadSongCatalog]);

  useEffect(() => {
    if (isSelectingRef.current || loading) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (isSelectingRef.current) return;
      const q = query.trim();
      if (resultFilter === "songs") {
        void loadSongCatalog(q, true);
        return;
      }
      void fetchSmartSearch(q, resultFilter);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSmartSearch, loadSongCatalog, resultFilter, loading]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (mode !== "curator") lastCatalogModeRef.current = mode;
    setError(null);
  }, [mode]);

  useEffect(() => {
    const order = SEARCH_PROMPTS.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
    promptOrderRef.current = order;
    promptCursorRef.current = 0;
    const first = order[0];
    if (first) {
      setRollingPromptText(first.text);
      setMode(first.mode);
      promptCursorRef.current = 1 % order.length;
    }
  }, []);

  useEffect(() => {
    if (query.trim() || loading || disabled || inputFocused || rollingPaused) return;
    const timer = window.setInterval(() => {
      const order = promptOrderRef.current;
      if (order.length === 0) return;
      const prompt = order[promptCursorRef.current];
      if (!prompt) return;
      setRollingPromptText(prompt.text);
      setMode(prompt.mode);
      promptCursorRef.current = (promptCursorRef.current + 1) % order.length;
    }, IDLE_PLACEHOLDER_MS);
    return () => window.clearInterval(timer);
  }, [query, loading, disabled, inputFocused, rollingPaused]);

  const applyCatalogFilter = (filter: CatalogFilter) => {
    setResultFilter(filter);
    setActiveIndex(-1);
    setShowDropdown(true);
    setError(null);
    if (filter === "ai") {
      setMode("curator");
    } else if (mode === "curator") {
      setMode(lastCatalogModeRef.current);
    }
  };

  const launchCurator = async (prompt: string) => {
    const previousTitles = readStoredCuratedTitles(prompt);
    const target = curatorPromptTarget(prompt);
    const stored = readStoredMixPool(target.kind === "artist" ? target.artist : prompt);
    const outcome = await performCuratorClick({
      prompt,
      body: {
        prompt,
        previousTitles,
        ...(stored
          ? {
              pool: stored.pool,
              poolAt: stored.at,
              lastClose: stored.close,
              lastPeer: stored.peer,
              lastDeep: stored.deep,
            }
          : {}),
      },
      onYield: onCuratorYield,
      onLaunch: (payload) => {
        const result = payload as CuratedPlaylistResult | null;
        if (!result?.tracks?.length || !result.tracks[0]) {
          const notice = {
            title: `Couldn't start ${prompt.trim() || "that prompt"}`,
            detail: "That station didn't start. Nothing is playing.",
          };
          setError(notice.detail);
          onCuratorFailed(notice);
          return;
        }
        storeCuratedTitles(
          prompt,
          result.tracks.map((track) => ({ title: track.title, artist: track.artist })),
        );
        const memoryKey = target.kind === "artist" ? target.artist : prompt;
        if (result.pool?.length && result.cast) {
          storeMixPool(memoryKey, {
            pool: result.pool,
            at: Date.now(),
            close: result.cast.close,
            peer: result.cast.peer,
            deep: result.cast.deep,
          });
        }
        const station: Station = {
          id: `ai-curator-${Date.now()}`,
          name: result.name,
          frequency: 99.9,
          category: "genres",
          defaultPersonaId: result.personaId,
          accentColor: result.accentColor,
          youtubeVideoId: result.tracks[0].youtubeId,
          tracks: result.tracks,
          description: result.description,
        };
        onLoadCurated(station, result.tracks, result.personaId);
        if (result.tailPlan?.length && onArtistRadioTail) {
          const tailPlan = result.tailPlan;
          void fetch("/api/curate-playlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, beat: 2, plan: tailPlan }),
          })
            .then(async (res) => {
              if (!res.ok) return;
              const data = (await res.json()) as { tracks?: StationTrack[] };
              if (data.tracks?.length) onArtistRadioTail(data.tracks);
            })
            .catch(() => {
              // Beat 1 keeps playing.
            });
        }
        setQuery("");
        dismissDropdown();
      },
    });
    if (!outcome.ok) {
      setError(outcome.notice.detail);
      onCuratorFailed(outcome.notice);
    }
  };

  const launchAlbum = async (opts: {
    collectionId?: number;
    query?: string;
  }) => {
    try {
      const params = new URLSearchParams();
      if (opts.collectionId && Number.isFinite(opts.collectionId) && opts.collectionId > 0) {
        params.set("collectionId", String(opts.collectionId));
      } else if (opts.query?.trim()) {
        params.set("q", opts.query.trim());
      } else {
        console.error("[SongHost ABORT] Missing album collectionId and query");
        return;
      }

      const excludeYoutubeIds = [...getFailedYoutubeIds()];
      if (excludeYoutubeIds.length) {
        params.set("excludeYoutubeIds", excludeYoutubeIds.join(","));
      }

      const res = await fetch(`/api/album-radio?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Could not launch Full Album");
        return;
      }

      onLaunchAlbum(data as AlbumRadioResult);
      setQuery("");
      dismissDropdown();
    } catch (err) {
      console.error("[SongHost TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const artistRadioUrl = (
    name: string,
    artistMode: ArtistRadioMode,
    seed?: { title: string; itunesTrackId?: number },
  ) => {
    const params = new URLSearchParams({
      artist: name,
      mode: artistMode,
    });
    if (seed?.title.trim()) params.set("seedTitle", seed.title.trim());
    if (seed?.itunesTrackId) params.set("itunesTrackId", String(seed.itunesTrackId));
    if (artistMode === "mixed") {
      const stored = readStoredMixPool(name);
      const previousNeighbors = mergeMixNeighbors(
        recallMixNeighbors(name),
        stored
          ? [...stored.close, ...stored.peer, ...stored.deep]
          : readStoredMixNeighbors(name),
      );
      const encoded = formatMixNeighborParam(previousNeighbors);
      if (encoded) params.set("excludeNeighbors", encoded);
      if (stored && stored.pool.length) {
        params.set("pool", formatStoredPoolParam(stored.pool));
        params.set("poolAt", String(stored.at));
        if (stored.close.length) params.set("lastClose", formatMixNeighborParam(stored.close));
        if (stored.peer.length) params.set("lastPeer", formatMixNeighborParam(stored.peer));
        if (stored.deep.length) params.set("lastDeep", formatMixNeighborParam(stored.deep));
      }
    }
    const excludeYoutubeIds = [...getFailedYoutubeIds()];
    if (excludeYoutubeIds.length) {
      params.set("excludeYoutubeIds", excludeYoutubeIds.join(","));
    }
    const recent = getRecentTrackIds();
    if (recent.length) params.set("exclude", recent.join(","));
    return `/api/artist-radio?${params.toString()}`;
  };

  const finishArtistRadio = (
    result: ArtistRadioResult,
  ) => {
    if (result.mode === "mixed") {
      const castNames = [
        ...(result.cast?.close ?? []),
        ...(result.cast?.peer ?? []),
        ...(result.cast?.deep ?? []),
      ];
      const neighbors = castNames.length
        ? castNames
        : neighborNamesFromTracks(result.artistName, result.tracks);
      rememberMixNeighbors(result.artistName, neighbors);
      storeMixNeighbors(result.artistName, neighbors);
      if (result.pool?.length) {
        storeMixPool(result.artistName, {
          pool: result.pool,
          at: Date.now(),
          close: result.cast?.close ?? [],
          peer: result.cast?.peer ?? [],
          deep: result.cast?.deep ?? [],
        });
      }
    }
    onLaunch(result);
    setQuery("");
    dismissDropdown();
  };

  const launchArtistRadio = async (artist?: string, launchMode?: ArtistRadioMode) => {
    const name = (artist ?? query).trim();
    if (!name) {
      console.error("[SongHost ABORT] Missing artist name");
      return;
    }

    const artistMode = launchMode ?? pillLaunchMode(mode);
    const stationLabel = artistMode === "mixed" ? "Artist Radio" : "Artist only";
    try {
      const outcome = await performArtistRadioClick({
        artistName: name,
        stationLabel,
        requestUrl: artistRadioUrl(name, artistMode),
        onYield: onArtistRadioYield,
        onLaunch: finishArtistRadio,
        onAppendTail: onArtistRadioTail,
      });
      if (!outcome.ok) {
        setError(outcome.notice.detail);
        onArtistRadioFailed(outcome.notice);
      }
    } catch (err) {
      console.error("[SongHost TRACE ERROR]", err);
      const notice = {
        title: `Couldn't start ${name}`,
        detail: `${artistMode === "artist-only" ? "Artist only" : "Artist Radio"} didn't start. Check the connection and try again.`,
      };
      setError(notice.detail);
      onArtistRadioFailed(notice);
    }
  };

  const launchSeededSong = async (track: SearchTrackResult, launchMode: ArtistRadioMode) => {
    const stationLabel =
      launchMode === "mixed" ? `${track.title} Radio` : `${track.artist} only`;
    const itunesTrackId = itunesTrackIdFromSearchId(track.id);
    try {
      const outcome = await performArtistRadioClick({
        artistName: track.title,
        stationLabel,
        requestUrl: artistRadioUrl(track.artist, launchMode, {
          title: track.title,
          itunesTrackId,
        }),
        onYield: onArtistRadioYield,
        onLaunch: finishArtistRadio,
        onAppendTail: onArtistRadioTail,
      });
      if (!outcome.ok) {
        setError(outcome.notice.detail);
        onArtistRadioFailed(outcome.notice);
      }
    } catch (err) {
      console.error("[SongHost TRACE ERROR]", err);
      const notice = {
        title: `Couldn't start ${track.title}`,
        detail: `${stationLabel} didn't start. Check the connection and try again.`,
      };
      setError(notice.detail);
      onArtistRadioFailed(notice);
    }
  };

  const runStationLaunch = async (value: string) => {
    try {
      if (mode === "curator") {
        await launchCurator(value);
        return;
      }
      if (mode === "full-album") {
        await launchAlbum({ query: value });
        return;
      }

      const res = await fetch(
        `/api/search?q=${encodeURIComponent(value)}&type=track,artist&limit=8`,
      );
      const data = (await res.json()) as SmartSearchResponse;
      const trackHit = (data.tracks ?? []).find((track) =>
        itunesTrackMatchesQuery(track, value),
      );
      if (mode === "song-radio" && trackHit) {
        setResults({
          tracks: data.tracks ?? [],
          artists: data.artists ?? [],
          albums: data.albums ?? [],
        });
        setShowDropdown(true);
        setError("Tap a song to start it.");
        return;
      }

      const artistHit = (data.artists ?? []).find((artist) =>
        itunesArtistsMatch(artist.name, value),
      );
      if (artistHit) {
        await launchArtistRadio(artistHit.name);
        return;
      }

      await launchCurator(value);
    } finally {
      isSelectingRef.current = false;
      setLoading(false);
      onClose?.();
    }
  };

  const beginSelecting = (nextQuery?: string) => {
    isSelectingRef.current = true;
    dismissDropdown();
    onClose?.();
    if (nextQuery !== undefined) setQuery(nextQuery);
    setLoading(true);
    setError(null);
    primeAudioOnGesture();
  };

  const launch = async (queryOverride?: string, e?: React.SyntheticEvent) => {
    console.log("[SongHost TRACE 1] Launch Radio button explicitly clicked!");
    e?.preventDefault();

    const value = (queryOverride ?? query).trim();
    if (!value) {
      console.error("[SongHost ABORT] Missing query value");
      return;
    }
    if (loading || isSelectingRef.current) {
      console.error("[SongHost ABORT] Already loading / selecting");
      return;
    }

    beginSelecting();
    try {
      await runStationLaunch(value);
    } catch (err) {
      console.error("[SongHost TRACE ERROR]", err);
      throw err;
    }
  };

  const handleLaunchClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    void launch(undefined, e);
  };

  const {
    supported: voiceSupported,
    listening: voiceListening,
    start: startVoice,
    stop: stopVoice,
    error: voiceError,
  } = useVoiceSearch({
    onTranscript: (text) => {
      setQuery(text);
      void launch(text);
    },
  });

  const selectSong = (track: SearchTrackResult, launchMode: ArtistRadioMode) => {
    if (loading || isSelectingRef.current) return;
    setBusyLabel(
      launchMode === "mixed" ? "Building the neighborhood…" : `${track.artist} only`,
    );
    beginSelecting(`${track.title} - ${track.artist}`);
    void (async () => {
      try {
        await launchSeededSong(track, launchMode);
      } finally {
        isSelectingRef.current = false;
        setLoading(false);
        setBusyLabel(null);
      }
    })();
  };

  const selectArtist = (artist: SearchArtistResult, launchMode: ArtistRadioMode) => {
    if (loading || isSelectingRef.current) return;
    setBusyLabel(launchMode === "mixed" ? "Building the neighborhood…" : "Building Artist only…");
    beginSelecting(artist.name);
    void (async () => {
      try {
        await launchArtistRadio(artist.name, launchMode);
      } finally {
        isSelectingRef.current = false;
        setLoading(false);
        setBusyLabel(null);
      }
    })();
  };

  const selectAlbum = (album: SearchAlbumResult) => {
    if (loading || isSelectingRef.current) return;
    beginSelecting(`${album.title} - ${album.artist}`);
    void (async () => {
      try {
        const collectionId = album.id.startsWith("itunes-album:")
          ? Number(album.id.slice("itunes-album:".length))
          : undefined;
        await launchAlbum({
          collectionId:
            collectionId && Number.isFinite(collectionId) && collectionId > 0
              ? collectionId
              : undefined,
          query: `${album.title} ${album.artist}`,
        });
      } finally {
        isSelectingRef.current = false;
        setLoading(false);
      }
    })();
  };

  type FlatItem =
    | { kind: "track"; item: SearchTrackResult }
    | { kind: "artist"; item: SearchArtistResult }
    | { kind: "album"; item: SearchAlbumResult };

  const visibleAlbums =
    resultFilter === "all" || resultFilter === "albums" ? results.albums : [];
  const catalogTracks =
    resultFilter === "all" ? results.tracks : [];
  const visibleTracks =
    resultFilter === "songs"
      ? songRows.filter((track) => track.section !== "similar")
      : catalogTracks;
  const similarTracks =
    resultFilter === "songs"
      ? songRows.filter((track) => track.section === "similar")
      : [];
  const visibleArtists =
    resultFilter === "all" || resultFilter === "artists" ? results.artists : [];

  const flatItems: FlatItem[] = [
    ...visibleAlbums.map((item) => ({ kind: "album" as const, item })),
    ...visibleTracks.map((item) => ({ kind: "track" as const, item })),
    ...similarTracks.map((item) => ({ kind: "track" as const, item })),
    ...visibleArtists.map((item) => ({ kind: "artist" as const, item })),
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (loading || isSelectingRef.current) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
      setShowDropdown(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = activeIndex >= 0 ? flatItems[activeIndex] : undefined;
      if (active?.kind === "track") selectSong(active.item, "mixed");
      else if (active?.kind === "artist") selectArtist(active.item, "mixed");
      else if (active?.kind === "album") selectAlbum(active.item);
      else void launch();
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  };

  const cycleSearchMode = () => {
    setRollingPaused(true);
    setMode((current) => {
      const index = SEARCH_MODE_OPTIONS.findIndex((option) => option.value === current);
      return SEARCH_MODE_OPTIONS[(index + 1) % SEARCH_MODE_OPTIONS.length].value;
    });
  };
  const activeModeLabel =
    SEARCH_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Song Radio";

  const launchLabel = isCurator
    ? "GENERATE STATION"
    : isFullAlbum
      ? "PLAY FULL ALBUM"
      : isSongRadio
        ? "PLAY SONG RADIO"
        : isArtistMix
          ? "PLAY ARTIST RADIO"
          : "PLAY ARTIST ONLY";
  const loadingLabel = busyLabel
    ? busyLabel
    : isCurator
      ? "Curating Playlist..."
      : isFullAlbum
        ? "Loading Album..."
        : isSongRadio
          ? "Tap a song"
          : isArtistMix
            ? "Building the neighborhood…"
            : isArtistRadio
              ? "Building Artist only…"
              : "Tuning Station...";
  const isLaunching = loading;

  const modeDefaultPlaceholder = isCurator
    ? "Describe a vibe, genre, or mood for a custom playlist..."
    : isFullAlbum
      ? "Enter an artist or album for a full album listen with liner notes..."
      : isSongRadio
        ? "Enter a song to create a mix of this track, artist & similar music..."
        : isArtistMix
          ? "Enter an artist for Artist Radio. Opens with them, then the neighborhood."
          : "Enter an artist to play only that artist.";
  const showIdleHint =
    inlineResults &&
    !query.trim() &&
    !isLaunching &&
    !inputFocused &&
    Boolean(rollingPromptText);
  const placeholder = isLaunching
    ? loadingLabel
    : showIdleHint
      ? ""
      : inputFocused || query.trim() || rollingPaused
        ? modeDefaultPlaceholder
        : (rollingPromptText ?? modeDefaultPlaceholder);
  const pulseGlow = accentBorder && !inputFocused && !isLaunching;

  const queryReady = query.trim().length >= 2;
  const hasDropdownResults = flatItems.length > 0;
  const showOverlay = !isLaunching && showDropdown && queryReady;

  const resultsBody = (
    <SearchResultsBody
      resultFilter={resultFilter}
      visibleAlbums={visibleAlbums}
      visibleTracks={visibleTracks}
      similarTracks={similarTracks}
      visibleArtists={visibleArtists}
      hasDropdownResults={hasDropdownResults}
      activeIndex={activeIndex}
      onFilter={applyCatalogFilter}
      onSelectAlbum={selectAlbum}
      onSongMix={(track) => selectSong(track, "mixed")}
      onSongRadio={(track) => selectSong(track, "artist-only")}
      onSelectArtist={selectArtist}
      songsEndless={resultFilter === "songs" && queryReady}
      songsPaging={songPaging}
      songsExhausted={songExhausted}
      similarOpen={resultFilter === "songs" && similarOpen}
      onNeedMoreSongs={loadMoreSongs}
    />
  );

  return (
    <div
      ref={containerRef}
      className={inlineResults ? "relative z-50 flex min-h-0 flex-1 flex-col" : "relative z-50"}
    >
      <style>{`
        @keyframes songhost-search-glow {
          0%, 100% { box-shadow: 0 0 28px rgba(6,182,212,0.12), 0 0 14px rgba(6,182,212,0.20); }
          50% { box-shadow: 0 0 28px rgba(6,182,212,0.12), 0 0 14px rgba(6,182,212,0.26); }
        }
        .songhost-search-glow {
          animation: songhost-search-glow 4s ease-in-out infinite;
        }
      `}</style>
      {!hideLabel && (
        <label
          htmlFor="smart-search-input"
          className="mb-2 block font-mono text-xs font-bold uppercase tracking-widest text-accent"
        >
          Find the music you love
        </label>
      )}

      {(() => {
        const inputBlock = (
          <div className="relative flex-1 min-w-0">
            <button
              type="button"
              onClick={cycleSearchMode}
              disabled={disabled || isLaunching}
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded p-0.5 text-accent transition-colors hover:text-accent-hover disabled:opacity-50"
              aria-label={`Search mode: ${activeModeLabel}. Activate to cycle.`}
            >
              {isCurator ? (
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
              ) : isFullAlbum ? (
                <Disc3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
              ) : (
                <Radio className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
              )}
            </button>
            <input
              id="smart-search-input"
              type="text"
              role="combobox"
              value={query}
              onChange={(e) => {
                if (isLaunching || isSelectingRef.current) return;
                setQuery(e.target.value);
                setError(null);
              }}
              onFocus={() => {
                setInputFocused(true);
                if (isLaunching || isSelectingRef.current) return;
                if (query.trim().length >= 2) setShowDropdown(true);
              }}
              onBlur={() => {
                setInputFocused(false);
                if (!query.trim()) setRollingPaused(false);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled || isLaunching}
              aria-busy={isLaunching}
              aria-expanded={showOverlay}
              aria-controls="smart-search-dropdown"
              aria-autocomplete="list"
              autoComplete="off"
              className={`w-full min-h-[46px] rounded-lg border bg-slate-950/90 px-4 py-3.5 pl-9 font-mono text-sm text-white caret-cyan-400 shadow-inner outline-none transition-all placeholder-zinc-500 sm:pl-10 ${
                accentBorder
                  ? "border-cyan-500/65 shadow-[0_0_28px_rgba(6,182,212,0.12)] focus:border-cyan-400 focus:shadow-[0_0_0_2px_rgba(6,182,212,0.35),0_0_22px_rgba(6,182,212,0.2)]"
                  : "border-zinc-700 focus:border-accent/50"
              } ${isLaunching ? "opacity-70" : ""} ${pulseGlow ? "songhost-search-glow" : ""}`}
            />
            {showIdleHint && rollingPromptText && (
              <IdleSearchHint key={rollingPromptText} text={rollingPromptText} />
            )}
            {showOverlay && !inlineResults && (
              <div
                id="smart-search-dropdown"
                className="absolute top-full left-0 right-0 z-[100] mt-2 flex max-h-[calc(100svh-21rem-220px)] flex-col overflow-hidden shadow-2xl bg-[#121215]/95 backdrop-blur-xl border border-zinc-700/80 rounded-xl sm:max-h-80"
                role="listbox"
              >
                {resultsBody}
              </div>
            )}
          </div>
        );

        const micButton = (
          <button
            type="button"
            onClick={() => {
              if (voiceListening) stopVoice();
              else startVoice();
            }}
            disabled={!voiceSupported || disabled || isLaunching}
            aria-label={
              voiceSupported
                ? "Voice search"
                : "Voice search not supported in this browser"
            }
            title={
              voiceSupported
                ? "Voice search"
                : "Voice search not supported in this browser"
            }
            aria-pressed={voiceListening}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
              voiceListening
                ? "border-accent bg-accent/15 text-accent shadow-[0_0_14px_var(--brand-accent-glow)] animate-pulse"
                : "border-white/[0.08] bg-[#121215] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200"
            }`}
          >
            {voiceListening ? (
              <MicOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        );

        const tunerButton = onToggleTuner ? (
          <button
            type="button"
            onClick={onToggleTuner}
            disabled={disabled || isLaunching}
            aria-label="Advanced Tuning"
            aria-pressed={tunerOpen}
            aria-expanded={tunerOpen}
            aria-controls="station-tuner-drawer"
            title="Advanced Tuning"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
              tunerOpen
                ? "border-accent bg-accent/15 text-accent shadow-[0_0_14px_var(--brand-accent-glow)]"
                : "border-white/[0.08] bg-[#121215] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200"
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null;

        const launchButton = (
          <button
            type="button"
            onClick={handleLaunchClick}
            disabled={disabled}
            aria-disabled={disabled || isLaunching || !query.trim()}
            className={`${inlineResults ? "w-full" : "shrink-0"} flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-zinc-950 shadow-sm transition-all hover:bg-accent-hover active:scale-95 ${
              disabled || isLaunching || !query.trim() ? "opacity-50" : ""
            }`}
          >
            {isLaunching ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {loadingLabel}
              </>
            ) : (
              launchLabel
            )}
          </button>
        );

        if (inlineResults) {
          return (
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex flex-row gap-2">
                {inputBlock}
                {micButton}
                {tunerButton}
              </div>
              {launchButton}
            </div>
          );
        }

        return (
          <div className="flex flex-col xs:flex-row gap-2">
            {inputBlock}
            {micButton}
            {tunerButton}
            {launchButton}
          </div>
        );
      })()}
      {showOverlay && inlineResults && (
        <div
          id="smart-search-dropdown"
          className="mt-2 flex min-h-0 max-h-[min(24rem,calc(100svh-22rem))] flex-1 flex-col overflow-hidden bg-[#121215]/95 backdrop-blur-xl border border-zinc-700/80 rounded-xl"
          role="listbox"
        >
          {resultsBody}
        </div>
      )}
      {error && <p className="font-mono text-[11px] text-red-600 mt-2">{error}</p>}
      {!error && voiceError && (
        <p className="font-mono text-[11px] text-red-600 mt-2">{voiceError}</p>
      )}
    </div>
  );
}
