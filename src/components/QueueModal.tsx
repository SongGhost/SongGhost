"use client";

import { ListMusic, Loader2, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StationTrack } from "@/data/stations";
import VUMeter from "@/components/VUMeter";

type QueueModalProps = {
  open: boolean;
  onClose: () => void;
  queue: StationTrack[];
  currentIndex: number;
  isPlaying: boolean;
  onRemoveTrack: (index: number) => void;
  onInsertNext: (track: StationTrack) => void;
  onAppendTrack: (track: StationTrack) => void;
};

function trackKey(track: StationTrack, index: number): string {
  return (
    track.youtubeId?.trim() ||
    (track.itunesTrackId ? `preview:${track.itunesTrackId}` : "") ||
    track.previewUrl?.trim() ||
    `row:${index}`
  );
}

export default function QueueModal({
  open,
  onClose,
  queue,
  currentIndex,
  isPlaying,
  onRemoveTrack,
  onInsertNext,
  onAppendTrack,
}: QueueModalProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<StationTrack[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [pendingTrack, setPendingTrack] = useState<StationTrack | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSearchOpen(false);
      setSearchQuery("");
      setSearchResults([]);
      setSearchError(null);
      setPendingTrack(null);
      return;
    }

    requestAnimationFrame(() => {
      currentRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [open, currentIndex]);

  const fetchSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const res = await fetch(`/api/song-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? "Search failed");
        setSearchResults([]);
        return;
      }
      setSearchResults(data.tracks ?? []);
      setActiveResultIndex(-1);
    } catch {
      setSearchError("Network error — try again");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!searchOpen) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSearch(searchQuery.trim());
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, searchOpen, fetchSearch]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const handleSelectResult = (track: StationTrack) => {
    setPendingTrack(track);
    setSearchQuery(`${track.title} — ${track.artist}`);
    setSearchResults([]);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveResultIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveResultIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeResultIndex >= 0 && searchResults[activeResultIndex]) {
        handleSelectResult(searchResults[activeResultIndex]);
      }
    } else if (e.key === "Escape") {
      setSearchOpen(false);
      setSearchResults([]);
      setPendingTrack(null);
    }
  };

  const addPending = (mode: "next" | "append") => {
    if (!pendingTrack) return;
    if (mode === "next") onInsertNext(pendingTrack);
    else onAppendTrack(pendingTrack);
    setPendingTrack(null);
    setSearchQuery("");
    setSearchOpen(false);
    setSearchResults([]);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close playlist"
      />
      <div className="queue-modal relative w-full sm:max-w-lg mx-auto rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-amber-400/90" />
            <h2 className="text-sm sm:text-base font-semibold text-ice/90">Playlist</h2>
            <span className="text-[10px] text-ice/40 tabular-nums">
              {queue.length} track{queue.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ice/50 hover:text-ice/90 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto min-h-[160px] max-h-[45vh] mb-3 -mx-1 px-1">
          {queue.length === 0 ? (
            <p className="text-xs text-ice/50 py-6 text-center">Queue is empty — search for a song below.</p>
          ) : (
            <ol className="space-y-1">
              {queue.map((track, index) => {
                const isCurrent = index === currentIndex;
                const key = trackKey(track, index);
                return (
                  <li
                    key={`${key}-${index}`}
                    ref={isCurrent ? currentRowRef : undefined}
                    className={`queue-row flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs sm:text-sm transition-colors ${
                      isCurrent ? "queue-row-active" : "hover:bg-white/5"
                    }`}
                  >
                    <span
                      className={`w-5 shrink-0 text-center tabular-nums text-[10px] ${
                        isCurrent ? "text-amber-400/90 font-semibold" : "text-ice/35"
                      }`}
                    >
                      {isCurrent ? "▶" : index + 1}
                    </span>
                    {isCurrent && <VUMeter active={isPlaying} inline />}
                    <div className="min-w-0 flex-1">
                      <p className={`truncate ${isCurrent ? "text-amber-100/95 font-medium" : "text-ice/85"}`}>
                        {track.title}
                      </p>
                      <p className="truncate text-[10px] sm:text-xs text-ice/45">{track.artist}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveTrack(index)}
                      className="shrink-0 p-1.5 rounded-md text-ice/35 hover:text-red-400/90 hover:bg-red-400/10 transition-colors"
                      aria-label={`Remove ${track.title} from queue`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="border-t border-white/10 pt-3 space-y-2">
          {!searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="analog-btn analog-btn-tune w-full flex items-center justify-center gap-2 px-4 py-2 text-[10px] sm:text-xs"
            >
              <Search className="h-3.5 w-3.5" />
              Search for a song
            </button>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-teal-400/50 pointer-events-none z-10" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPendingTrack(null);
                    setSearchError(null);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Song or artist name..."
                  autoComplete="off"
                  className="tune-input w-full rounded-lg pl-8 pr-3 py-2 text-xs sm:text-sm"
                />
                {searchLoading && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-ice/40" />
                )}
                {searchResults.length > 0 && (
                  <ul
                    className="autocomplete-dropdown absolute z-50 left-0 right-0 top-full mt-1 rounded-lg overflow-hidden max-h-40 overflow-y-auto"
                    role="listbox"
                  >
                    {searchResults.map((track, i) => (
                      <li key={trackKey(track, i)} role="option" aria-selected={i === activeResultIndex}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectResult(track)}
                          className={`autocomplete-item w-full text-left px-3 py-2 text-xs sm:text-sm transition-colors ${
                            i === activeResultIndex ? "autocomplete-item-active" : ""
                          }`}
                        >
                          <span className="text-ice/90">{track.title}</span>
                          <span className="text-ice/45"> — {track.artist}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {searchError && <p className="text-[10px] text-red-400/90">{searchError}</p>}

              {pendingTrack && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2">
                  <p className="text-[10px] text-amber-200/60 uppercase tracking-widest mb-1">Selected</p>
                  <p className="text-xs text-ice/90 truncate">
                    {pendingTrack.title} — {pendingTrack.artist}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => addPending("next")}
                      className="analog-btn analog-btn-tune flex-1 px-3 py-1.5 text-[10px] sm:text-xs"
                    >
                      Next in Queue
                    </button>
                    <button
                      type="button"
                      onClick={() => addPending("append")}
                      className="analog-btn flex-1 px-3 py-1.5 text-[10px] sm:text-xs rounded-lg border border-white/10"
                    >
                      Append to Queue
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                  setSearchResults([]);
                  setPendingTrack(null);
                }}
                className="text-[10px] text-ice/40 hover:text-ice/70 transition-colors"
              >
                Cancel search
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
