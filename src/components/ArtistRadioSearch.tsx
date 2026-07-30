"use client";



import { Loader2, Radio } from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ArtistRadioResult } from "@/lib/artist-radio";

import { primeAudioOnGesture } from "@/lib/audio-unlock";



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

    <div className="artist-radio-search space-y-1.5" ref={containerRef}>

      <label

        htmlFor="artist-radio-input"

        className="text-[10px] sm:text-xs tracking-widest text-label uppercase"

      >

        Start Artist Radio...

      </label>

      <div className="flex flex-col xs:flex-row gap-2">

        <div className="relative flex-1 min-w-0">

          <Radio className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-teal-400/50 pointer-events-none z-10" />

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

            className="tune-input w-full rounded-lg pl-8 sm:pl-10 pr-3 py-2 text-xs sm:text-sm"

          />

          {showSuggestions && suggestions.length > 0 && (

            <ul

              className="autocomplete-dropdown absolute z-50 left-0 right-0 top-full mt-1 rounded-lg overflow-hidden max-h-48 overflow-y-auto"

              role="listbox"

            >

              {suggestions.map((name, i) => (

                <li key={name} role="option" aria-selected={i === activeIndex}>

                  <button

                    type="button"

                    onMouseDown={(e) => e.preventDefault()}

                    onClick={() => selectSuggestion(name)}

                    className={`autocomplete-item w-full text-left px-3 py-2 text-xs sm:text-sm text-ice/90 transition-colors ${

                      i === activeIndex ? "autocomplete-item-active" : ""

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

          className="analog-btn analog-btn-tune shrink-0 px-4 sm:px-5 py-2 text-[10px] sm:text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"

        >

          {loading ? (

            <>

              <Loader2 className="h-3.5 w-3.5 animate-spin" />

              TUNING...

            </>

          ) : (

            "LAUNCH RADIO"

          )}

        </button>

      </div>

      {error && <p className="text-[10px] sm:text-xs text-red-400/90">{error}</p>}

      <p className="text-[10px] text-label-muted">

        YouTube playback today · Spotify &amp; Apple Music coming soon

      </p>

    </div>

  );

}

