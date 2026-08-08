"use client";

import {
  ArrowDown,
  ArrowUp,
  Disc3,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  formatDuration,
  newClientId,
  type SearchTrackResult,
  type StudioTimelineTrack,
} from "@/components/studio/types";

export type TrackSequenceBuilderProps = {
  tracks: StudioTimelineTrack[];
  onAddTrack: (track: StudioTimelineTrack) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (index: number) => void;
  /**
   * Render a break-authoring slot for the gap after `afterTrackIndex`
   * (`-1` = before the first track).
   */
  renderBreakSlot?: (afterTrackIndex: number) => ReactNode;
};

/**
 * Spotify-backed track search + reorderable sequence list for Ghost Studio.
 */
export default function TrackSequenceBuilder({
  tracks,
  onAddTrack,
  onMoveUp,
  onMoveDown,
  onRemove,
  renderBreakSlot,
}: TrackSequenceBuilderProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTrackResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const fetchSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as {
        tracks?: SearchTrackResult[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Search failed");
        setResults([]);
        return;
      }
      setResults(data.tracks ?? []);
      setActiveIndex(-1);
    } catch {
      setError("Network error — try again");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSearch(query.trim());
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSearch]);

  const addResult = useCallback(
    (hit: SearchTrackResult) => {
      onAddTrack({
        clientId: newClientId("track"),
        title: hit.title,
        artist: hit.artist,
        previewUrl: hit.previewUrl,
        durationSec: hit.durationSec,
        artworkUrl: hit.artworkUrl,
        album: hit.album,
        spotifyId: hit.spotifyId,
      });
      setQuery("");
      setResults([]);
      setActiveIndex(-1);
    },
    [onAddTrack],
  );

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="studio-track-search"
          className="font-mono text-[10px] uppercase tracking-widest text-zinc-500"
        >
          Track Search
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <input
            id="studio-track-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
                e.preventDefault();
                addResult(results[activeIndex]);
              } else if (e.key === "Escape") {
                setResults([]);
              }
            }}
            placeholder="Search Spotify tracks…"
            autoComplete="off"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 py-2.5 pl-10 pr-10 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent/70"
          />
          {loading && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500"
              aria-hidden="true"
            />
          )}
        </div>

        {error && (
          <p className="font-sans text-xs text-red-400" role="alert">
            {error}
          </p>
        )}

        {results.length > 0 && (
          <ul
            ref={listRef}
            role="listbox"
            className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
          >
            {results.map((hit, index) => (
              <li key={hit.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onClick={() => addResult(hit)}
                  className={[
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    index === activeIndex
                      ? "bg-accent/10"
                      : "hover:bg-zinc-900",
                  ].join(" ")}
                >
                  <ArtworkThumb url={hit.artworkUrl} title={hit.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-sans text-sm text-zinc-100">
                      {hit.title}
                    </p>
                    <p className="truncate font-sans text-xs text-zinc-500">
                      {hit.artist}
                      {hit.album ? ` · ${hit.album}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                    {formatDuration(hit.durationSec)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Sequence
          </h2>
          <p className="font-mono text-[10px] text-zinc-600">
            {tracks.length} track{tracks.length === 1 ? "" : "s"}
          </p>
        </div>

        {tracks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-10 text-center">
            <Disc3 className="mx-auto mb-2 h-6 w-6 text-zinc-700" aria-hidden="true" />
            <p className="font-sans text-sm text-zinc-500">
              Search and add tracks to start building your timeline.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {renderBreakSlot?.(-1)}
            {tracks.map((track, index) => (
              <li key={track.clientId} className="space-y-2">
                <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                  <ArtworkThumb url={track.artworkUrl} title={track.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-sans text-sm font-medium text-zinc-100">
                      <span className="mr-2 font-mono text-[10px] text-zinc-600">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {track.title}
                    </p>
                    <p className="truncate font-sans text-xs text-zinc-500">
                      {track.artist}
                      {track.album ? ` · ${track.album}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                    {formatDuration(track.durationSec)}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onMoveUp(index)}
                      disabled={index === 0}
                      className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                      aria-label={`Move ${track.title} up`}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveDown(index)}
                      disabled={index >= tracks.length - 1}
                      className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
                      aria-label={`Move ${track.title} down`}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(index)}
                      className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
                      aria-label={`Remove ${track.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {renderBreakSlot?.(index)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function ArtworkThumb({
  url,
  title,
}: {
  url?: string;
  title: string;
}) {
  if (!url) {
    return (
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950"
        aria-hidden="true"
      >
        <Disc3 className="h-4 w-4 text-zinc-700" />
      </div>
    );
  }

  return (
    // External CDN / Spotify CDN artwork — next/image domain allowlist not required for editor thumbs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={44}
      height={44}
      className="h-11 w-11 shrink-0 rounded-md border border-zinc-800 object-cover"
      title={title}
    />
  );
}
