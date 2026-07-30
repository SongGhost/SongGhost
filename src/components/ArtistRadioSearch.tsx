"use client";

import { Loader2, Radio, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CuratedPlaylistResult } from "@/types/curator";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import type { ArtistRadioMode, ArtistRadioResult } from "@/lib/artist-radio";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import { getFailedYoutubeIds } from "@/lib/failed-youtube-ids";
import { consoleActionBtnClass, consoleInputClass } from "@/components/QuickConnectors";

export type MusicSearchMode = ArtistRadioMode | "curator";

type ArtistRadioSearchProps = {
  onLaunch: (result: ArtistRadioResult) => void;
  onLoadCurated: (station: Station, tracks: StationTrack[], personaId: PersonaId) => void;
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
    hint: "Describe a vibe — AI builds your playlist",
  },
];

export default function ArtistRadioSearch({ onLaunch, onLoadCurated, disabled }: ArtistRadioSearchProps) {
  const [artistQuery, setArtistQuery] = useState("");
  const [mode, setMode] = useState<MusicSearchMode>("artist-only");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const res = await fetch(`/api/artist-suggest?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setShowSuggestions(true);
      setActiveIndex(-1);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    if (mode === "curator") {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(artistQuery.trim());
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [artistQuery, fetchSuggestions, mode]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      setSuggestions([]);
    } catch {
      setError("Network error — try again");
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
      setSuggestions([]);
    } catch {
      setError("Network error — try again");
    }
  };

  const launch = async (queryOverride?: string) => {
    const value = (queryOverride ?? artistQuery).trim();
    if (!value) return;

    primeAudioOnGesture();
    setLoading(true);
    setError(null);
    setShowSuggestions(false);

    try {
      if (mode === "curator") {
        await launchCurator(value);
      } else {
        await launchArtistRadio(value);
      }
    } finally {
      setLoading(false);
    }
  };

  const selectSuggestion = (name: string) => {
    setArtistQuery(name);
    setShowSuggestions(false);
    launch(name);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      setShowSuggestions(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        selectSuggestion(suggestions[activeIndex]);
      } else if (!loading) {
        launch();
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const isCurator = mode === "curator";
  const launchLabel = isCurator ? "Curate" : "Launch Radio";
  const loadingLabel = isCurator ? "Curating..." : "Tuning...";

  return (
    <div ref={containerRef}>
      <label
        htmlFor="artist-radio-input"
        className="text-stone-900 font-mono text-xs font-bold uppercase tracking-widest mb-2 block"
      >
        Find the music you love
      </label>

      <div
        className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2"
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
              disabled={disabled || loading}
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
          ) : (
            <Radio className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-stone-400 pointer-events-none z-10" />
          )}
          <input
            id="artist-radio-input"
            type="text"
            value={artistQuery}
            onChange={(e) => {
              setArtistQuery(e.target.value);
              setError(null);
            }}
            onFocus={() => !isCurator && suggestions.length > 0 && setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder={
              isCurator
                ? "Chill 90s trip-hop for studying..."
                : "Soundgarden, The Cranberries..."
            }
            disabled={disabled || loading}
            autoComplete="off"
            className={`${consoleInputClass} pl-9 sm:pl-10`}
          />
          {!isCurator && showSuggestions && suggestions.length > 0 && (
            <ul
              className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-[#C8BFA0] rounded-lg overflow-hidden max-h-48 overflow-y-auto shadow-md"
              role="listbox"
            >
              {suggestions.map((name, i) => (
                <li key={name} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectSuggestion(name)}
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
        </div>
        <button
          type="button"
          onClick={() => launch()}
          disabled={disabled || loading || !artistQuery.trim()}
          className={`${consoleActionBtnClass} shrink-0 flex items-center justify-center gap-1.5 disabled:opacity-50`}
        >
          {loading ? (
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
