"use client";

import { Disc3, Loader2, Radio, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import StationCard from "@/components/cards/StationCard";
import SearchModePills, {
  type MusicSearchMode,
} from "@/components/search/SearchModePills";
import { consoleActionBtnClass } from "@/components/QuickConnectors";
import type { CuratedPlaylistResult } from "@/types/curator";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import type { AlbumRadioResult } from "@/lib/album-radio";
import type { ArtistRadioResult } from "@/lib/artist-radio";
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

export default function SmartSearchBar({
  onLaunch,
  onLoadCurated,
  onLaunchAlbum,
  onLaunchSongRadio,
  disabled,
}: SmartSearchBarProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<MusicSearchMode>("song-radio");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SmartSearchResponse>(emptySearch);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Blocks debounced/in-flight suggest calls once a result is chosen or launch starts. */
  const isSelectingRef = useRef(false);

  const isCurator = mode === "curator";
  const isFullAlbum = mode === "full-album";
  const isArtistMode = mode === "artist-only" || mode === "mixed";
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

  const fetchSmartSearch = useCallback(
    async (q: string) => {
      if (isSelectingRef.current) return;
      if (q.length < 2) {
        setResults(emptySearch());
        return;
      }

      try {
        let typeParam = "track,artist,album";
        if (isArtistMode) typeParam = "artist";
        else if (isFullAlbum) typeParam = "album";
        else if (isSongRadio) typeParam = "track,artist,album";

        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(typeParam)}&limit=6`,
        );
        if (isSelectingRef.current) return;
        const data = (await res.json()) as SmartSearchResponse & { error?: string };
        if (isSelectingRef.current) return;
        if (!res.ok) {
          setResults(emptySearch());
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
      }
    },
    [isArtistMode, isFullAlbum, isSongRadio],
  );

  useEffect(() => {
    if (isCurator) {
      setResults(emptySearch());
      setShowDropdown(false);
      return;
    }

    if (isSelectingRef.current || loading) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (isSelectingRef.current) return;
      void fetchSmartSearch(query.trim());
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSmartSearch, mode, loading, isCurator]);

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
    setResults(emptySearch());
    setShowDropdown(false);
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
      setQuery("");
      dismissDropdown();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
      setError("Network error - try again");
    }
  };

  const launchArtistRadio = async (artist?: string) => {
    const name = (artist ?? query).trim();
    if (!name) {
      console.error("[LinerLore ABORT] Missing artist name");
      return;
    }

    try {
      const artistMode = mode === "mixed" ? "mixed" : "artist-only";
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
      console.error("[LinerLore TRACE ERROR]", err);
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
      setQuery("");
      dismissDropdown();
    } catch (err) {
      console.error("[LinerLore TRACE ERROR]", err);
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
      console.error("[LinerLore TRACE ERROR]", err);
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
    console.log("[LinerLore TRACE 1] Launch Radio button explicitly clicked!");
    e?.preventDefault();

    const value = (queryOverride ?? query).trim();
    if (!value) {
      console.error("[LinerLore ABORT] Missing query value");
      return;
    }
    if (loading || isSelectingRef.current) {
      console.error("[LinerLore ABORT] Already loading / selecting");
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

  const selectArtist = (artist: SearchArtistResult) => {
    if (loading || isSelectingRef.current) return;
    beginSelecting(artist.name);
    void (async () => {
      try {
        await launchArtistRadio(artist.name);
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

  const flatItems: FlatItem[] = [
    ...results.tracks.map((item) => ({ kind: "track" as const, item })),
    ...results.artists.map((item) => ({ kind: "artist" as const, item })),
    ...results.albums.map((item) => ({ kind: "album" as const, item })),
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
      else if (active?.kind === "artist") selectArtist(active.item);
      else if (active?.kind === "album") selectAlbum(active.item);
      else void launch();
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  };

  const isArtistMix = mode === "artist-only";
  const isArtistRadio = mode === "mixed";

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

  const hasDropdownResults =
    results.tracks.length > 0 ||
    results.artists.length > 0 ||
    results.albums.length > 0;

  let flatCursor = -1;

  return (
    <div ref={containerRef}>
      <label
        htmlFor="smart-search-input"
        className="mb-2 block font-mono text-xs font-bold uppercase tracking-widest text-zinc-200"
      >
        Find the music you love
      </label>

      <SearchModePills
        mode={mode}
        onChange={setMode}
        disabled={disabled || isLaunching}
      />

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
            id="smart-search-input"
            type="text"
            value={query}
            onChange={(e) => {
              if (isLaunching || isSelectingRef.current) return;
              setQuery(e.target.value);
              setError(null);
            }}
            onFocus={() => {
              if (isCurator || isLaunching || isSelectingRef.current) return;
              if (hasDropdownResults) setShowDropdown(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isLaunching}
            aria-busy={isLaunching}
            aria-expanded={showDropdown && hasDropdownResults}
            aria-controls="smart-search-dropdown"
            autoComplete="off"
            className={`w-full rounded-lg border border-zinc-700 bg-zinc-900/90 px-4 py-2.5 pl-9 font-mono text-xs text-white caret-amber-500 shadow-inner outline-none transition-all placeholder-zinc-400 focus:border-amber-500/50 sm:pl-10 ${isLaunching ? "opacity-70" : ""}`}
          />

          {!isCurator &&
            !isLaunching &&
            showDropdown &&
            hasDropdownResults && (
              <div
                id="smart-search-dropdown"
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/90 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                role="listbox"
              >
                {results.tracks.length > 0 && (
                  <section className="mb-1.5">
                    <h3 className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-500/80">
                      Tracks (Song Radio)
                    </h3>
                    <ul className="space-y-0.5">
                      {results.tracks.map((track) => {
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
                            <StationCard
                              variant="compact"
                              artworkUrl={track.artworkUrl}
                              title={track.title}
                              subtitle={track.artist}
                              tags={tags}
                              isActive={index === activeIndex}
                              onClick={() => selectTrack(track)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {results.artists.length > 0 && (
                  <section className="mb-1.5">
                    <h3 className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-500/80">
                      Artists
                    </h3>
                    <ul className="space-y-0.5">
                      {results.artists.map((artist) => {
                        flatCursor += 1;
                        const index = flatCursor;
                        return (
                          <li
                            key={artist.id}
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseDown={(e) => e.preventDefault()}
                          >
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
                              onClick={() => selectArtist(artist)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {results.albums.length > 0 && (
                  <section>
                    <h3 className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-500/80">
                      Albums
                    </h3>
                    <ul className="space-y-0.5">
                      {results.albums.map((album) => {
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
                            <StationCard
                              variant="compact"
                              artworkUrl={album.artworkUrl}
                              title={album.title}
                              subtitle={album.artist}
                              tags={tags}
                              isActive={index === activeIndex}
                              onClick={() => selectAlbum(album)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </div>
            )}
        </div>
        <button
          type="button"
          onClick={handleLaunchClick}
          disabled={disabled}
          aria-disabled={disabled || isLaunching || !query.trim()}
          className={`${consoleActionBtnClass} shrink-0 flex items-center justify-center gap-1.5 ${
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
