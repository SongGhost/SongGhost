"use client";

import { Disc3, Loader2, Radio, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import StationCard from "@/components/cards/StationCard";
import { consoleActionBtnClass, consoleInputClass } from "@/components/QuickConnectors";
import type { CuratedPlaylistResult } from "@/types/curator";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import type { AlbumRadioResult } from "@/lib/album-radio";
import type { ArtistRadioMode, ArtistRadioResult } from "@/lib/artist-radio";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import { getFailedYoutubeIds } from "@/lib/failed-youtube-ids";

export type MusicSearchMode = ArtistRadioMode | "curator" | "full-album";

export type AlbumSuggestItem = {
  collectionId: number;
  albumTitle: string;
  artist: string;
  releaseYear: number | null;
  coverArtUrl: string | null;
  trackCount: number | null;
};

type ArtistRadioSearchProps = {
  onLaunch: (result: ArtistRadioResult) => void;
  onLoadCurated: (station: Station, tracks: StationTrack[], personaId: PersonaId) => void;
  /** Launches an `album_deep_dive` session with sleeve metadata attached */
  onLaunchAlbum: (result: AlbumRadioResult) => void;
  disabled?: boolean;
};

const MODE_OPTIONS: { value: MusicSearchMode; label: string; hint: string }[] = [
  {
    value: "artist-only",
    label: "Artist Only",
    hint: "Deep cuts from the artist you searched",
  },
  {
    value: "mixed",
    label: "Radio Mix",
    hint: "Blend with similar artists (Last.fm recommended)",
  },
  {
    value: "curator",
    label: "AI Curator",
    hint: "Describe a vibe - AI builds your playlist",
  },
  {
    value: "full-album",
    label: "Full Album",
    hint: "Play an entire record with DJ lore & liner notes",
  },
];

export default function ArtistRadioSearch({
  onLaunch,
  onLoadCurated,
  onLaunchAlbum,
  disabled,
}: ArtistRadioSearchProps) {
  const [artistQuery, setArtistQuery] = useState("");
  const [mode, setMode] = useState<MusicSearchMode>("artist-only");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [albumSuggestions, setAlbumSuggestions] = useState<AlbumSuggestItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Blocks debounced/in-flight suggest calls once a result is chosen or launch starts. */
  const isSelectingRef = useRef(false);

  const isCurator = mode === "curator";
  const isFullAlbum = mode === "full-album";
  const isArtistMode = mode === "artist-only" || mode === "mixed";

  const dismissSuggestions = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setShowSuggestions(false);
    setSuggestions([]);
    setAlbumSuggestions([]);
    setActiveIndex(-1);
  }, []);

  const fetchArtistSuggestions = useCallback(async (query: string) => {
    if (isSelectingRef.current) return;

    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`/api/artist-suggest?q=${encodeURIComponent(query)}`);
      if (isSelectingRef.current) return;
      const data = await res.json();
      if (isSelectingRef.current) return;
      setSuggestions(data.suggestions ?? []);
      setAlbumSuggestions([]);
      setShowSuggestions(true);
      setActiveIndex(-1);
    } catch {
      if (isSelectingRef.current) return;
      setSuggestions([]);
    }
  }, []);

  const fetchAlbumSuggestions = useCallback(async (query: string) => {
    if (isSelectingRef.current) return;

    if (query.length < 2) {
      setAlbumSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`/api/album-suggest?q=${encodeURIComponent(query)}`);
      if (isSelectingRef.current) return;
      const data = await res.json();
      if (isSelectingRef.current) return;
      setAlbumSuggestions((data.albums as AlbumSuggestItem[] | undefined) ?? []);
      setSuggestions([]);
      setShowSuggestions(true);
      setActiveIndex(-1);
    } catch {
      if (isSelectingRef.current) return;
      setAlbumSuggestions([]);
    }
  }, []);

  useEffect(() => {
    if (isCurator) {
      setSuggestions([]);
      setAlbumSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Selecting a result sets artistQuery - do not re-open or re-query while launching.
    if (isSelectingRef.current || loading) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (isSelectingRef.current) return;
      const q = artistQuery.trim();
      if (isFullAlbum) void fetchAlbumSuggestions(q);
      else void fetchArtistSuggestions(q);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    artistQuery,
    fetchArtistSuggestions,
    fetchAlbumSuggestions,
    mode,
    loading,
    isCurator,
    isFullAlbum,
  ]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear the wrong suggest list when the listener flips modes.
  useEffect(() => {
    setSuggestions([]);
    setAlbumSuggestions([]);
    setShowSuggestions(false);
    setActiveIndex(-1);
    setError(null);
  }, [mode]);

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
      setArtistQuery("");
      dismissSuggestions();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const launchArtistRadio = async (artist?: string) => {
    const name = (artist ?? artistQuery).trim();
    if (!name) {
      console.error("[LinerLore ABORT] Missing artist name");
      return;
    }

    try {
      const params = new URLSearchParams({
        artist: name,
        mode,
      });
      const excludeYoutubeIds = [...getFailedYoutubeIds()];
      if (excludeYoutubeIds.length) {
        params.set("excludeYoutubeIds", excludeYoutubeIds.join(","));
      }
      const res = await fetch(`/api/artist-radio?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Could not launch artist radio");
        return;
      }

      onLaunch(data as ArtistRadioResult);
      setArtistQuery("");
      dismissSuggestions();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const launchAlbum = async (opts: { collectionId?: number; query?: string }) => {
    try {
      const params = new URLSearchParams();
      if (opts.collectionId) params.set("collectionId", String(opts.collectionId));
      else if (opts.query) params.set("q", opts.query);
      else {
        console.error("[LinerLore ABORT] Missing album collectionId and query");
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
      setArtistQuery("");
      dismissSuggestions();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const runStationLaunch = async (
    value: string,
    album?: Pick<AlbumSuggestItem, "collectionId" | "albumTitle">,
  ) => {
    try {
      if (mode === "curator") {
        await launchCurator(value);
      } else if (mode === "full-album") {
        await launchAlbum(
          album?.collectionId
            ? { collectionId: album.collectionId }
            : { query: value },
        );
      } else {
        await launchArtistRadio(value);
      }
    } finally {
      isSelectingRef.current = false;
      setLoading(false);
    }
  };

  /** Sync: dismiss dropdown, halt suggest debounce, enter launching UI. */
  const beginSelecting = (nextQuery?: string) => {
    isSelectingRef.current = true;
    dismissSuggestions();
    if (nextQuery !== undefined) setArtistQuery(nextQuery);
    setLoading(true);
    setError(null);
    primeAudioOnGesture();
  };

  const launch = async (
    queryOverride?: string,
    e?: React.SyntheticEvent,
  ) => {
    console.log("[LinerLore TRACE 1] Launch Radio button explicitly clicked!");
    e?.preventDefault();

    const value = (queryOverride ?? artistQuery).trim();
    if (!value) {
      console.error("[LinerLore ABORT] Missing query value");
      return;
    }
    if (loading) {
      console.error("[LinerLore ABORT] Already loading");
      return;
    }
    if (isSelectingRef.current) {
      console.error("[LinerLore ABORT] Selection already in progress");
      return;
    }

    beginSelecting();
    try {
      await runStationLaunch(value);
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
      throw err;
    }
  };

  /** Bound directly to the Launch Radio button — always logs before any guard. */
  const handleLaunchClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    void launch(undefined, e);
  };

  const selectArtistSuggestion = (name: string) => {
    if (loading || isSelectingRef.current) return;
    beginSelecting(name);
    void runStationLaunch(name);
  };

  const selectAlbumSuggestion = (album: AlbumSuggestItem) => {
    if (loading || isSelectingRef.current) return;
    const label = `${album.albumTitle} - ${album.artist}`;
    beginSelecting(label);
    void runStationLaunch(label, album);
  };

  const suggestionCount = isFullAlbum ? albumSuggestions.length : suggestions.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (loading || isSelectingRef.current) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestionCount - 1));
      setShowSuggestions(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isFullAlbum && activeIndex >= 0 && albumSuggestions[activeIndex]) {
        selectAlbumSuggestion(albumSuggestions[activeIndex]);
      } else if (isArtistMode && activeIndex >= 0 && suggestions[activeIndex]) {
        selectArtistSuggestion(suggestions[activeIndex]);
      } else {
        void launch();
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const launchLabel = isCurator ? "Curate" : isFullAlbum ? "Play Album" : "Launch Radio";
  const loadingLabel = isCurator
    ? "Curating Playlist..."
    : isFullAlbum
      ? "Loading Album..."
      : "Tuning Station...";
  const isLaunching = loading;

  const placeholder = isLaunching
    ? loadingLabel
    : isCurator
      ? "Chill 90s trip-hop for studying..."
      : isFullAlbum
        ? "Rumours, Dark Side of the Moon..."
        : "Soundgarden, The Cranberries...";

  return (
    <div ref={containerRef}>
      <label
        htmlFor="artist-radio-input"
        className="mb-2 block font-mono text-xs font-bold uppercase tracking-widest text-zinc-200"
      >
        Find the music you love
      </label>

      <div
        className="grid grid-cols-2 gap-2 mb-2"
        role="radiogroup"
        aria-label="Music search mode"
      >
        {MODE_OPTIONS.map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || isLaunching}
              onClick={() => setMode(option.value)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                selected
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
                  : "border-white/[0.08] bg-[#121215] text-zinc-300 hover:border-white/[0.14]"
              }`}
            >
              <span className="block font-mono text-[11px] font-bold uppercase tracking-wider">
                {option.label}
              </span>
              <span className="mt-0.5 block font-sans text-[11px] text-zinc-500">{option.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col xs:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          {isCurator ? (
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 sm:h-4 sm:w-4" />
          ) : isFullAlbum ? (
            <Disc3 className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 sm:h-4 sm:w-4" />
          ) : (
            <Radio className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 sm:h-4 sm:w-4" />
          )}
          <input
            id="artist-radio-input"
            type="text"
            value={artistQuery}
            onChange={(e) => {
              if (isLaunching || isSelectingRef.current) return;
              setArtistQuery(e.target.value);
              setError(null);
            }}
            onFocus={() => {
              if (isCurator || isLaunching || isSelectingRef.current) return;
              if (isFullAlbum && albumSuggestions.length > 0) setShowSuggestions(true);
              else if (isArtistMode && suggestions.length > 0) setShowSuggestions(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isLaunching}
            aria-busy={isLaunching}
            autoComplete="off"
            className={`${consoleInputClass} border-white/[0.08] bg-[#0c0c0e] pl-9 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 sm:pl-10 ${isLaunching ? "opacity-70" : ""}`}
          />
          {!isCurator &&
            !isLaunching &&
            showSuggestions &&
            isArtistMode &&
            suggestions.length > 0 && (
              <ul
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#121215] shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
                role="listbox"
              >
                {suggestions.map((name, i) => (
                  <li key={name} role="option" aria-selected={i === activeIndex}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectArtistSuggestion(name)}
                      className={`w-full px-3 py-2 text-left font-sans text-xs text-zinc-200 transition-colors hover:bg-amber-500/10 hover:text-amber-300 sm:text-sm ${
                        i === activeIndex ? "bg-amber-500/10 text-amber-300" : ""
                      }`}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {!isCurator &&
            !isLaunching &&
            showSuggestions &&
            isFullAlbum &&
            albumSuggestions.length > 0 && (
              <ul
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#0c0c0e]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
                role="listbox"
              >
                {albumSuggestions.map((album, i) => {
                  const tags = [
                    album.releaseYear ? String(album.releaseYear) : null,
                    album.trackCount ? `${album.trackCount} tracks` : null,
                  ].filter((tag): tag is string => Boolean(tag));
                  return (
                    <li
                      key={album.collectionId}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <StationCard
                        variant="compact"
                        artworkUrl={album.coverArtUrl}
                        title={album.albumTitle}
                        subtitle={album.artist}
                        tags={tags}
                        isActive={i === activeIndex}
                        onClick={() => selectAlbumSuggestion(album)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
        <button
          type="button"
          onClick={handleLaunchClick}
          // Keep enabled so clicks always reach handleLaunchClick (TRACE 1 + ABORT logs).
          // Empty/loading/selecting are rejected inside launch() with explicit abort reasons.
          disabled={disabled}
          aria-disabled={disabled || isLaunching || !artistQuery.trim()}
          className={`${consoleActionBtnClass} shrink-0 flex items-center justify-center gap-1.5 ${
            disabled || isLaunching || !artistQuery.trim() ? "opacity-50" : ""
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
