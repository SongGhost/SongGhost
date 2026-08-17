"use client";

import { Disc3, Loader2, Radio, SlidersHorizontal, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import { getFailedYoutubeIds } from "@/lib/failed-youtube-ids";
import { getRecentTrackIds } from "@/lib/queue/recent-tracks";
import type { SongRadioResult } from "@/lib/song-radio";
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
  onLoadCurated: (station: Station, tracks: StationTrack[], personaId: PersonaId) => void;
  onLaunchAlbum: (result: AlbumRadioResult) => void;
  /** Launches a seeded Song Radio session (seed track + recommendations). */
  onLaunchSongRadio: (result: SongRadioResult) => void;
  disabled?: boolean;
  /** Advanced Tuning drawer open state — expanded under SearchSection */
  tunerOpen?: boolean;
  /** Expands / collapses TuneStationPanel under the search bar */
  onToggleTuner?: () => void;
  /** High-contrast accent border on the search input (dashboard SearchSection). */
  accentBorder?: boolean;
  /** Hide the built-in label when the parent section already renders the title. */
  hideLabel?: boolean;
};

function formatDuration(sec?: number): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return "";
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function emptySearch(): SmartSearchResponse {
  return { tracks: [], artists: [], albums: [] };
}

const IDLE_PLACEHOLDER_MS = 3800;

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

function ActionBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-accent/90">
      {label}
    </span>
  );
}

function ArtistActionButton({
  label,
  onSelect,
}: {
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
      className="shrink-0 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-accent/90 transition-colors hover:border-accent/60 hover:bg-accent/20 hover:text-accent"
    >
      {label}
    </button>
  );
}

export default function SmartSearchBar({
  onLaunch,
  onLoadCurated,
  onLaunchAlbum,
  onLaunchSongRadio,
  disabled,
  tunerOpen = false,
  onToggleTuner,
  accentBorder = false,
  hideLabel = false,
}: SmartSearchBarProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<MusicSearchMode>("song-radio");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SmartSearchResponse>(emptySearch);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resultFilter, setResultFilter] = useState<CatalogFilter>("all");
  const [inputFocused, setInputFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Blocks debounced/in-flight suggest calls once a result is chosen or launch starts. */
  const isSelectingRef = useRef(false);
  const lastCatalogModeRef = useRef<MusicSearchMode>("song-radio");

  const isCurator = mode === "curator";
  const isFullAlbum = mode === "full-album";
  const isSongRadio = mode === "song-radio";

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
        `/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(typeParam)}&limit=6`,
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

  useEffect(() => {
    if (isSelectingRef.current || loading) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (isSelectingRef.current) return;
      void fetchSmartSearch(query.trim(), resultFilter);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSmartSearch, resultFilter, loading]);

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
    if (query.trim() || loading || disabled || inputFocused) return;
    const timer = window.setInterval(() => {
      setMode((current) => {
        const index = SEARCH_MODE_OPTIONS.findIndex((option) => option.value === current);
        const next = (index + 1) % SEARCH_MODE_OPTIONS.length;
        return SEARCH_MODE_OPTIONS[next].value;
      });
    }, IDLE_PLACEHOLDER_MS);
    return () => window.clearInterval(timer);
  }, [query, loading, disabled, inputFocused]);

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
    try {
      const res = await fetch("/api/curate-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Could not curate playlist");
        return;
      }

      const result = data as CuratedPlaylistResult;
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
      setQuery("");
      dismissDropdown();
    } catch (err) {
      console.error("[SongHost TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const launchArtistRadio = async (artist?: string, launchMode?: ArtistRadioMode) => {
    const name = (artist ?? query).trim();
    if (!name) {
      console.error("[SongHost ABORT] Missing artist name");
      return;
    }

    try {
      const artistMode = launchMode ?? (mode === "mixed" ? "mixed" : "artist-only");
      const params = new URLSearchParams({
        artist: name,
        mode: artistMode,
      });
      const excludeYoutubeIds = [...getFailedYoutubeIds()];
      if (excludeYoutubeIds.length) {
        params.set("excludeYoutubeIds", excludeYoutubeIds.join(","));
      }
      const recent = getRecentTrackIds();
      if (recent.length) {
        params.set("exclude", recent.join(","));
      }
      const res = await fetch(`/api/artist-radio?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ??
            (artistMode === "mixed"
              ? "Could not launch Artist Radio"
              : "Could not launch Artist Mix"),
        );
        return;
      }

      onLaunch(data as ArtistRadioResult);
      setQuery("");
      dismissDropdown();
    } catch (err) {
      console.error("[SongHost TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const launchAlbum = async (opts: {
    collectionId?: number;
    query?: string;
    albumTitle?: string;
    artist?: string;
  }) => {
    try {
      const params = new URLSearchParams();
      if (opts.collectionId) {
        params.set("collectionId", String(opts.collectionId));
      } else if (opts.albumTitle && opts.artist) {
        params.set("q", `${opts.albumTitle} ${opts.artist}`);
      } else if (opts.query) {
        params.set("q", opts.query);
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
        setError(data.error ?? "Could not launch album station");
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

  const launchSongRadio = async (track: Pick<SearchTrackResult, "title" | "artist" | "spotifyId">) => {
    try {
      const params = new URLSearchParams({
        title: track.title,
        artist: track.artist,
      });
      if (track.spotifyId) params.set("spotifyTrackId", track.spotifyId);

      const excludeYoutubeIds = [...getFailedYoutubeIds()];
      if (excludeYoutubeIds.length) {
        params.set("excludeYoutubeIds", excludeYoutubeIds.join(","));
      }
      const recent = getRecentTrackIds();
      if (recent.length) {
        params.set("exclude", recent.join(","));
      }

      const res = await fetch(`/api/song-radio?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Could not launch Song Radio");
        return;
      }

      onLaunchSongRadio(data as SongRadioResult);
      setQuery("");
      dismissDropdown();
    } catch (err) {
      console.error("[SongHost TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const runStationLaunch = async (value: string) => {
    try {
      if (mode === "curator") {
        await launchCurator(value);
      } else if (mode === "full-album") {
        await launchAlbum({ query: value });
      } else if (mode === "song-radio") {
        // Free-text Song Radio: treat the query as a track search seed.
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(value)}&type=track&limit=1`,
        );
        const data = (await res.json()) as SmartSearchResponse;
        const hit = data.tracks?.[0];
        if (!hit) {
          setError("No matching track found");
          return;
        }
        await launchSongRadio(hit);
      } else {
        await launchArtistRadio(value);
      }
    } finally {
      isSelectingRef.current = false;
      setLoading(false);
    }
  };

  const beginSelecting = (nextQuery?: string) => {
    isSelectingRef.current = true;
    dismissDropdown();
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

  const selectTrack = (track: SearchTrackResult) => {
    if (loading || isSelectingRef.current) return;
    beginSelecting(`${track.title} - ${track.artist}`);
    void (async () => {
      try {
        await launchSongRadio(track);
      } finally {
        isSelectingRef.current = false;
        setLoading(false);
      }
    })();
  };

  const selectArtist = (artist: SearchArtistResult, launchMode?: ArtistRadioMode) => {
    if (loading || isSelectingRef.current) return;
    beginSelecting(artist.name);
    void (async () => {
      try {
        await launchArtistRadio(artist.name, launchMode);
      } finally {
        isSelectingRef.current = false;
        setLoading(false);
      }
    })();
  };

  const selectAlbum = (album: SearchAlbumResult) => {
    if (loading || isSelectingRef.current) return;
    const label = `${album.title} - ${album.artist}`;
    beginSelecting(label);
    void (async () => {
      try {
        const collectionId = album.id.startsWith("itunes-album:")
          ? Number(album.id.replace("itunes-album:", ""))
          : undefined;
        await launchAlbum({
          collectionId: Number.isFinite(collectionId) ? collectionId : undefined,
          albumTitle: album.title,
          artist: album.artist,
          query: label,
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
  const visibleTracks =
    resultFilter === "all" || resultFilter === "songs" ? results.tracks : [];
  const visibleArtists =
    resultFilter === "all" || resultFilter === "artists" ? results.artists : [];

  const flatItems: FlatItem[] = [
    ...visibleAlbums.map((item) => ({ kind: "album" as const, item })),
    ...visibleTracks.map((item) => ({ kind: "track" as const, item })),
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
      if (active?.kind === "track") selectTrack(active.item);
      else if (active?.kind === "artist") selectArtist(active.item, "mixed");
      else if (active?.kind === "album") selectAlbum(active.item);
      else void launch();
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  };

  const isArtistMix = mode === "artist-only";
  const isArtistRadio = mode === "mixed";

  const cycleSearchMode = () => {
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
          ? "PLAY ARTIST MIX"
          : "PLAY ARTIST RADIO";
  const loadingLabel = isCurator
    ? "Curating Playlist..."
    : isFullAlbum
      ? "Loading Album..."
      : isSongRadio
        ? "Building Song Radio..."
        : isArtistMix
          ? "Building Artist Mix..."
          : isArtistRadio
            ? "Building Artist Radio..."
            : "Tuning Station...";
  const isLaunching = loading;

  const placeholder = isLaunching
    ? loadingLabel
    : isCurator
      ? "Describe a vibe, genre, or mood for a custom playlist..."
      : isFullAlbum
        ? "Enter an artist or album for a full album listen with liner notes..."
        : isSongRadio
          ? "Enter a song to create a mix of this track, artist & similar music..."
          : isArtistMix
            ? "Enter an artist to create a mix featuring deep cuts..."
            : "Enter an artist to create a broad radio station...";

  const queryReady = query.trim().length >= 2;
  const hasDropdownResults = flatItems.length > 0;
  const showOverlay = !isLaunching && showDropdown && queryReady;

  let flatCursor = -1;

  return (
    <div ref={containerRef} className="relative z-50">
      {!hideLabel && (
        <label
          htmlFor="smart-search-input"
          className="mb-2 block font-mono text-xs font-bold uppercase tracking-widest text-accent"
        >
          Find the music you love
        </label>
      )}

      <div className="flex flex-col xs:flex-row gap-2">
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
            onBlur={() => setInputFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isLaunching}
            aria-busy={isLaunching}
            aria-expanded={showOverlay}
            aria-controls="smart-search-dropdown"
            aria-autocomplete="list"
            autoComplete="off"
            className={`w-full rounded-lg border bg-slate-950/90 px-4 py-3 pl-9 font-mono text-sm text-white caret-cyan-400 shadow-inner outline-none transition-all placeholder-zinc-500 sm:pl-10 ${
              accentBorder
                ? "border-cyan-500/50 shadow-[0_0_18px_rgba(6,182,212,0.15)] focus:border-cyan-400 focus:shadow-[0_0_0_2px_rgba(6,182,212,0.35),0_0_22px_rgba(6,182,212,0.2)]"
                : "border-zinc-700 focus:border-accent/50"
            } ${isLaunching ? "opacity-70" : ""}`}
          />

          {showOverlay && (
              <div
                id="smart-search-dropdown"
                className="absolute top-full left-0 right-0 z-[100] mt-2 flex max-h-80 flex-col overflow-hidden shadow-2xl bg-[#121215]/95 backdrop-blur-xl border border-zinc-700/80 rounded-xl"
                role="listbox"
              >
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
                          onClick={() => applyCatalogFilter(chip.id)}
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

                <div className="min-h-0 flex-1 overflow-y-auto p-1">
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
                                  onClick={() => selectAlbum(album)}
                                />
                                <div className="pointer-events-none absolute right-2 top-2">
                                  <ActionBadge label="Album Deep Dive" />
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
                          const index = flatCursor;
                          const duration = formatDuration(track.durationSec);
                          const tags = [
                            duration || null,
                            track.album?.trim() || null,
                          ].filter((tag): tag is string => Boolean(tag));
                          return (
                            <li
                              key={track.id}
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
                                  onClick={() => selectTrack(track)}
                                />
                                <div className="pointer-events-none absolute right-2 top-2">
                                  <ActionBadge label="Song Radio" />
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
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
                                    artist.genres?.length
                                      ? artist.genres.join(" · ")
                                      : "Artist Radio"
                                  }
                                  isActive={index === activeIndex}
                                  onClick={() => selectArtist(artist, "mixed")}
                                />
                                <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-0.5">
                                  <ArtistActionButton
                                    label="Artist Radio"
                                    onSelect={() => selectArtist(artist, "mixed")}
                                  />
                                  <ArtistActionButton
                                    label="Artist Mix"
                                    onSelect={() => selectArtist(artist, "artist-only")}
                                  />
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  {resultFilter !== "ai" && !hasDropdownResults && (
                    <p className="px-2 py-3 font-mono text-[11px] text-zinc-500">
                      No matching {resultFilter === "all" ? "results" : resultFilter} yet.
                    </p>
                  )}
                </div>
              </div>
            )}
        </div>
        {onToggleTuner && (
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
        )}
        <button
          type="button"
          onClick={handleLaunchClick}
          disabled={disabled}
          aria-disabled={disabled || isLaunching || !query.trim()}
          className={`shrink-0 flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-zinc-950 shadow-sm transition-all hover:bg-accent-hover active:scale-95 ${
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
      </div>
      {error && <p className="font-mono text-[11px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}
