"use client";

import { Loader2, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtistRadioResult } from "@/lib/artist-radio";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import { consoleActionBtnClass, consoleInputClass } from "@/components/QuickConnectors";

type ArtistRadioSearchProps = {
  onLaunch: (result: ArtistRadioResult) => void;
  disabled?: boolean;
};

export default function ArtistRadioSearch({ onLaunch, disabled }: ArtistRadioSearchProps) {
  const [artistQuery, setArtistQuery] = useState("");
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
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(artistQuery.trim());
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [artistQuery, fetchSuggestions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const launchRadio = async (artist?: string) => {
    const name = (artist ?? artistQuery).trim();
    if (!name) return;

    primeAudioOnGesture();
    setLoading(true);
    setError(null);
    setShowSuggestions(false);

    try {
      const res = await fetch(`/api/artist-radio?artist=${encodeURIComponent(name)}`);
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
    } finally {
      setLoading(false);
    }
  };

  const selectSuggestion = (name: string) => {
    setArtistQuery(name);
    setShowSuggestions(false);
    launchRadio(name);
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
        launchRadio();
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={containerRef}>
      <label
        htmlFor="artist-radio-input"
        className="text-stone-900 font-mono text-xs font-bold uppercase tracking-widest mb-2 block"
      >
        Start Artist Radio...
      </label>
      <div className="flex flex-col xs:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Radio className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-stone-400 pointer-events-none z-10" />
          <input
            id="artist-radio-input"
            type="text"
            value={artistQuery}
            onChange={(e) => {
              setArtistQuery(e.target.value);
              setError(null);
            }}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder="Soundgarden, The Cranberries..."
            disabled={disabled || loading}
            autoComplete="off"
            className={`${consoleInputClass} pl-9 sm:pl-10`}
          />
          {showSuggestions && suggestions.length > 0 && (
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
          onClick={() => launchRadio()}
          disabled={disabled || loading || !artistQuery.trim()}
          className={`${consoleActionBtnClass} shrink-0 flex items-center justify-center gap-1.5 disabled:opacity-50`}
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Tuning...
            </>
          ) : (
            "Launch Radio"
          )}
        </button>
      </div>
      {error && <p className="font-mono text-[11px] text-red-600 mt-2">{error}</p>}
      <span className="text-stone-500 font-mono text-[11px] mt-2 block">
        YouTube playback today · Spotify &amp; Apple Music coming soon
      </span>
    </div>
  );
}
