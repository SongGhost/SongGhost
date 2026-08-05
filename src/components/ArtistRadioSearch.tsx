"use client";

import { Disc3, Loader2, Radio, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CuratedPlaylistResult } from "@/types/curator";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import type { AlbumRadioResult } from "@/lib/album-radio";
import type { ArtistRadioMode, ArtistRadioResult } from "@/lib/artist-radio";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import { getFailedYoutubeIds } from "@/lib/failed-youtube-ids";
import { consoleActionBtnClass, consoleInputClass } from "@/components/QuickConnectors";

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
    } catch {
      setError("Network error - try again");
    }
  };

  const launchArtistRadio = async (artist?: string) => {
    const name = (artist ?? artistQuery).trim();
    if (!name) return;

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
    } catch {
      setError("Network error - try again");
    }
  };

  const launchAlbum = async (opts: { collectionId?: number; query?: string }) => {
    try {
      const params = new URLSearchParams();
      if (opts.collectionId) params.set("collectionId", String(opts.collectionId));
      else if (opts.query) params.set("q", opts.query);
      else return;

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
    } catch {
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

  const launch = async (queryOverride?: string) => {
    const value = (queryOverride ?? artistQuery).trim();
    if (!value || loading || isSelectingRef.current) return;

    beginSelecting();
    await runStationLaunch(value);
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
        className="text-stone-900 font-mono text-xs font-bold uppercase tracking-widest mb-2 block"
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
                  ? "border-amber-600 bg-[#FAF7EE] text-amber-900"
                  : "border-[#C8BFA0] bg-white text-stone-700 hover:bg-[#FAF7EE]"
              }`}
            >
              <span className="block font-mono text-[11px] font-bold uppercase tracking-wider">
                {option.label}
              </span>
              <span className="block font-sans text-[11px] text-stone-500 mt-0.5">{option.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col xs:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          {isCurator ? (
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-stone-400 pointer-events-none z-10" />
          ) : isFullAlbum ? (
            <Disc3 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-stone-400 pointer-events-none z-10" />
          ) : (
            <Radio className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-stone-400 pointer-events-none z-10" />
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
            className={`${consoleInputClass} pl-9 sm:pl-10 ${isLaunching ? "opacity-70" : ""}`}
          />
          {!isCurator &&
            !isLaunching &&
            showSuggestions &&
            isArtistMode &&
            suggestions.length > 0 && (
              <ul
                className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-[#C8BFA0] rounded-lg overflow-hidden max-h-48 overflow-y-auto shadow-md"
                role="listbox"
              >
                {suggestions.map((name, i) => (
                  <li key={name} role="option" aria-selected={i === activeIndex}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectArtistSuggestion(name)}
                      className={`w-full text-left px-3 py-2 font-sans text-xs sm:text-sm text-stone-700 transition-colors hover:bg-[#FAF7EE] hover:text-amber-800 ${
                        i === activeIndex ? "bg-[#FAF7EE] text-amber-800" : ""
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
                className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-[#C8BFA0] rounded-lg overflow-hidden max-h-64 overflow-y-auto shadow-md"
                role="listbox"
              >
                {albumSuggestions.map((album, i) => (
                  <li
                    key={album.collectionId}
                    role="option"
                    aria-selected={i === activeIndex}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectAlbumSuggestion(album)}
                      className={`w-full flex items-center gap-2.5 text-left px-2.5 py-2 transition-colors hover:bg-[#FAF7EE] ${
                        i === activeIndex ? "bg-[#FAF7EE]" : ""
                      }`}
                    >
                      {album.coverArtUrl ? (
                        <img
                          src={album.coverArtUrl}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 shrink-0 rounded object-cover border border-[#C8BFA0]"
                        />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[#C8BFA0] bg-[#FAF7EE]">
                          <Disc3 className="h-4 w-4 text-stone-400" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-sans text-xs sm:text-sm font-medium text-stone-800">
                          {album.albumTitle}
                        </span>
                        <span className="block truncate font-sans text-[11px] text-stone-500">
                          {album.artist}
                          {album.releaseYear ? ` (${album.releaseYear})` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
        <button
          type="button"
          onClick={() => void launch()}
          disabled={disabled || isLaunching || !artistQuery.trim()}
          className={`${consoleActionBtnClass} shrink-0 flex items-center justify-center gap-1.5 disabled:opacity-50`}
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
