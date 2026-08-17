"use client";

import {
  Check,
  Disc3,
  GripVertical,
  ImagePlus,
  ListMusic,
  Loader2,
  Play,
  Radio,
  Search,
  Shuffle,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArtworkImage from "@/components/common/ArtworkImage";
import type { Station, StationTrack } from "@/data/stations";
import type { PersonaId } from "@/data/personas";
import { useTier } from "@/context/TierContext";
import {
  getAvailablePersonas,
  getPersonaPickerValue,
  toStationPersonaId,
} from "@/lib/dj/personaConfig";
import { buildSavedStation } from "@/lib/saved-stations";
import { getYouTubeThumbnail } from "@/lib/youtube";
import VUMeter from "@/components/VUMeter";

type QueueModalProps = {
  open: boolean;
  onClose: () => void;
  queue: StationTrack[];
  currentIndex: number;
  isPlaying: boolean;
  onRemoveTrack: (index: number) => void;
  onReorderTrack: (fromIndex: number, toIndex: number) => void;
  /** Jump playhead to this queue index and start playback immediately. */
  onJumpToTrack: (index: number) => void;
  /** Shuffle only the unplayed tail without interrupting the on-air track. */
  onShuffleRemaining: () => void;
  onInsertNext: (track: StationTrack) => void;
  onAppendTrack: (track: StationTrack) => void;
  /** Persona pre-selected in the save form — defaults to whoever is on air */
  defaultPersonaId?: PersonaId;
  onSaveStation?: (station: Station) => void;
  /** Clerk user present — when false, Save Station soft-gates to account creation. */
  isAuthenticated?: boolean;
  /** Soft gate — open onboarding Step 1 ("Create SongHost Account"). */
  onRequireAuth?: () => void;
};

const inputClass =
  "bg-white border border-[#D2C5B4] focus:border-accent text-zinc-900 font-mono text-xs placeholder:text-zinc-400 rounded-lg px-4 py-2.5 shadow-inner outline-none transition-all w-full";

const actionBtnClass =
  "bg-white hover:bg-accent hover:text-zinc-950 border border-[#D2C5B4] text-zinc-800 font-mono text-xs font-semibold uppercase tracking-widest px-4 py-2.5 rounded-lg transition-all active:scale-95 shadow-sm";

const fieldLabelClass =
  "block font-mono text-[10px] text-zinc-500 uppercase tracking-widest";

/** Amber rule drawn on the edge the dragged row would land against. */
const DROP_ABOVE_CLASS = "shadow-[inset_0_3px_0_0_var(--brand-accent)]";
const DROP_BELOW_CLASS = "shadow-[inset_0_-3px_0_0_var(--brand-accent)]";

function trackIdentity(track: StationTrack | undefined): string {
  if (!track) return "";
  return (
    track.youtubeId?.trim() ||
    (track.itunesTrackId ? `preview:${track.itunesTrackId}` : "") ||
    track.previewUrl?.trim() ||
    ""
  );
}

function trackKey(track: StationTrack, index: number): string {
  return trackIdentity(track) || `row:${index}`;
}

/** Up to four seed-track thumbnails for the default station artwork mosaic. */
function seedArtworkUrls(tracks: StationTrack[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const id = track.youtubeId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    urls.push(getYouTubeThumbnail(id, "hq"));
    if (urls.length >= 4) break;
  }
  return urls;
}

export default function QueueModal({
  open,
  onClose,
  queue,
  currentIndex,
  isPlaying,
  onRemoveTrack,
  onReorderTrack,
  onJumpToTrack,
  onShuffleRemaining,
  onInsertNext,
  onAppendTrack,
  defaultPersonaId,
  onSaveStation,
  isAuthenticated = true,
  onRequireAuth,
}: QueueModalProps) {
  const { isPro } = useTier();
  const personaOptions = useMemo(() => getAvailablePersonas(isPro), [isPro]);

  const [saveOpen, setSaveOpen] = useState(false);
  const [stationName, setStationName] = useState("");
  const [stationPersonaId, setStationPersonaId] = useState(() =>
    getPersonaPickerValue(defaultPersonaId, isPro),
  );
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedStationName, setSavedStationName] = useState<string | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<StationTrack[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [pendingTrack, setPendingTrack] = useState<StationTrack | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [armedIndex, setArmedIndex] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const pendingGripFocusRef = useRef<number | null>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stationNameInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const currentTrackIdentity = trackIdentity(queue[currentIndex]);
  const mosaicUrls = useMemo(() => seedArtworkUrls(queue), [queue]);

  // Keyed on the on-air track rather than its index so a reorder never yanks the
  // list out from under the cursor — only a genuine track change re-centers.
  useEffect(() => {
    if (!open) {
      setSearchOpen(false);
      setSearchQuery("");
      setSearchResults([]);
      setSearchError(null);
      setPendingTrack(null);
      setDragIndex(null);
      setDropIndex(null);
      setArmedIndex(null);
      setSaveOpen(false);
      setStationName("");
      setCoverUrl(null);
      setCoverError(null);
      setCoverUploading(false);
      setSaveError(null);
      setSavedStationName(null);
      return;
    }

    requestAnimationFrame(() => {
      currentRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [open, currentTrackIdentity]);

  // Rows remount when the queue order changes, so a keyboard move has to hand
  // focus back to the grip at its new position to stay repeatable.
  useEffect(() => {
    const target = pendingGripFocusRef.current;
    if (target === null) return;
    pendingGripFocusRef.current = null;
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-grip-index="${target}"]`)
      ?.focus();
  });

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

  useEffect(() => {
    if (saveOpen) stationNameInputRef.current?.focus();
  }, [saveOpen]);

  // Keep the picker on a tier-legal host if subscription status flips mid-form.
  useEffect(() => {
    if (!saveOpen) return;
    const allowed = new Set(personaOptions.map((p) => p.id));
    if (!allowed.has(stationPersonaId)) {
      setStationPersonaId(
        getPersonaPickerValue(defaultPersonaId, isPro) || personaOptions[0]?.id || "sam",
      );
    }
  }, [saveOpen, isPro, personaOptions, stationPersonaId, defaultPersonaId]);

  const openSaveForm = () => {
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    setSearchOpen(false);
    setSearchResults([]);
    setPendingTrack(null);
    setSaveError(null);
    setSavedStationName(null);
    setCoverUrl(null);
    setCoverError(null);
    setStationPersonaId(getPersonaPickerValue(defaultPersonaId, isPro));
    setSaveOpen(true);
  };

  const closeSaveForm = () => {
    setSaveOpen(false);
    setSaveError(null);
    setCoverError(null);
  };

  const uploadCover = useCallback(async (file: File) => {
    setCoverUploading(true);
    setCoverError(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/studio/upload-cover", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        coverImageUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.coverImageUrl) {
        throw new Error(data.error ?? "Failed to upload cover image");
      }
      setCoverUrl(data.coverImageUrl);
    } catch (err) {
      setCoverError(
        err instanceof Error ? err.message : "Failed to upload cover image",
      );
    } finally {
      setCoverUploading(false);
    }
  }, []);

  const handleSaveStation = () => {
    if (!onSaveStation) return;

    const name = stationName.trim();
    if (!name) {
      setSaveError("Give your station a name.");
      return;
    }
    if (!queue.length) {
      setSaveError("Add at least one track before saving.");
      return;
    }

    const station = buildSavedStation({
      name,
      personaId: toStationPersonaId(stationPersonaId, isPro),
      coverUrl,
      tracks: queue,
    });

    onSaveStation(station);
    setSaveOpen(false);
    setStationName("");
    setCoverUrl(null);
    setCoverError(null);
    setSaveError(null);
    setSavedStationName(station.name);
  };

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

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
    setArmedIndex(null);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    // Rows are only draggable once their grip is pressed, so text selection and
    // the remove button keep working normally.
    if (armedIndex !== index) {
      e.preventDefault();
      return;
    }
    setDragIndex(index);
    setDropIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropIndex !== index) setDropIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    if (dragIndex === null) return;
    e.preventDefault();
    if (dragIndex !== index) onReorderTrack(dragIndex, index);
    endDrag();
  };

  const handleGripKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    const target = index + delta;
    if (target < 0 || target >= queue.length) return;
    e.preventDefault();
    pendingGripFocusRef.current = target;
    onReorderTrack(index, target);
  };

  if (!open) return null;

  const canReshuffle = queue.length - currentIndex - 1 >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close playlist"
      />
      <div className="relative bg-[#FAF8F5] border border-[#D2C5B4] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-auto rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col overflow-hidden min-h-0">
        <div className="flex items-center justify-between mb-3 gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ListMusic className="h-4 w-4 shrink-0 text-accent" />
            <h2 className="font-sans text-sm sm:text-base font-semibold text-zinc-900">Playlist</h2>
            <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
              {queue.length} track{queue.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onShuffleRemaining}
              disabled={!canReshuffle}
              className="flex items-center gap-1.5 rounded-lg border border-[#D2C5B4] bg-white px-2.5 py-1 text-xs font-mono text-zinc-700 transition-all hover:border-accent/40 hover:bg-[#ECE8DF] hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#D2C5B4] disabled:hover:bg-white disabled:hover:text-zinc-700"
              title="Shuffle remaining unplayed tracks"
            >
              <Shuffle className="h-3.5 w-3.5 text-accent" />
              <span>Reshuffle</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={listRef}
          className="min-h-0 overscroll-region touch-pan-y flex-1 overflow-y-auto mb-3 -mx-1 px-1"
        >
          {queue.length === 0 ? (
            <p className="font-sans text-xs text-zinc-500 py-6 text-center">
              Queue is empty — search for a song below.
            </p>
          ) : (
            <ol className="space-y-1">
              {queue.map((track, index) => {
                const isCurrent = index === currentIndex;
                const key = trackKey(track, index);
                const isDragging = dragIndex === index;
                const isDropTarget = dragIndex !== null && dropIndex === index && !isDragging;
                const dropEdgeClass = isDropTarget
                  ? dragIndex > index
                    ? DROP_ABOVE_CLASS
                    : DROP_BELOW_CLASS
                  : "";
                return (
                  <li
                    key={`${key}-${index}`}
                    ref={isCurrent ? currentRowRef : undefined}
                    draggable={armedIndex === index}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={endDrag}
                    className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs sm:text-sm transition-all duration-150 ${
                      isCurrent
                        ? "bg-accent/15 border border-accent/30 shadow-[0_0_12px_-4px_var(--brand-accent)]"
                        : "cursor-pointer border border-transparent hover:bg-[#ECE8DF]/80"
                    } ${isDragging ? "opacity-40" : ""} ${
                      isDropTarget ? `bg-accent/10 ${dropEdgeClass}` : ""
                    }`}
                  >
                    <button
                      type="button"
                      data-grip-index={index}
                      onPointerDown={() => setArmedIndex(index)}
                      onPointerUp={() => setArmedIndex(null)}
                      onKeyDown={(e) => handleGripKeyDown(e, index)}
                      className="shrink-0 -ml-0.5 p-0.5 rounded text-zinc-300 hover:text-accent cursor-grab active:cursor-grabbing transition-colors"
                      aria-label={`Reorder ${track.title}. Use arrow up and arrow down to move.`}
                      title="Drag to reorder"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </button>
                    {isCurrent ? (
                      <>
                        <span className="w-5 shrink-0 text-center font-mono tabular-nums text-[10px] font-semibold text-accent">
                          ▶
                        </span>
                        <VUMeter active={isPlaying} inline />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-sans font-medium text-accent">
                            {track.title}
                          </p>
                          <p className="truncate font-mono text-[10px] sm:text-xs text-zinc-500">
                            {track.artist}
                          </p>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onJumpToTrack(index)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        aria-label={`Play ${track.title} by ${track.artist}`}
                        title="Play now"
                      >
                        <span className="relative w-5 shrink-0 text-center font-mono tabular-nums text-[10px] text-zinc-400">
                          <span className="group-hover:opacity-0 transition-opacity">
                            {index + 1}
                          </span>
                          <Play
                            className="absolute inset-0 m-auto h-3 w-3 text-accent opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden="true"
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-sans text-zinc-700 group-hover:text-zinc-900">
                            {track.title}
                          </p>
                          <p className="truncate font-mono text-[10px] sm:text-xs text-zinc-500">
                            {track.artist}
                          </p>
                        </div>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveTrack(index)}
                      className="shrink-0 p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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

        <div className="border-t border-[#D2C5B4] pt-3 space-y-2 shrink-0">
          {saveOpen ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-accent" />
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  Save as Station
                </p>
              </div>

              <div className="space-y-1">
                <label htmlFor="saved-station-name" className={fieldLabelClass}>
                  Station Name
                </label>
                <input
                  id="saved-station-name"
                  ref={stationNameInputRef}
                  type="text"
                  value={stationName}
                  onChange={(e) => {
                    setStationName(e.target.value);
                    setSaveError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveStation();
                    } else if (e.key === "Escape") {
                      closeSaveForm();
                    }
                  }}
                  placeholder="Late Night Drive"
                  maxLength={40}
                  autoComplete="off"
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="saved-station-persona" className={fieldLabelClass}>
                  DJ Persona
                </label>
                <select
                  id="saved-station-persona"
                  value={stationPersonaId}
                  onChange={(e) => setStationPersonaId(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {personaOptions.map((persona) => (
                    <option key={persona.id} value={persona.id}>
                      {persona.displayName}
                      {persona.description ? ` (${persona.description})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <span className={fieldLabelClass}>Station Artwork</span>
                <div className="flex items-start gap-3">
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[#D2C5B4] bg-[#ECE8DF]">
                    {coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- user/R2 upload or data URL
                      <img
                        src={coverUrl}
                        alt="Station artwork preview"
                        className="h-full w-full object-cover"
                      />
                    ) : mosaicUrls.length > 0 ? (
                      <div className="grid h-full w-full grid-cols-2 grid-rows-2">
                        {Array.from({ length: 4 }, (_, i) => {
                          const url = mosaicUrls[i] ?? mosaicUrls[i % mosaicUrls.length];
                          return url ? (
                            <ArtworkImage
                              key={`${url}-${i}`}
                              src={url}
                              alt=""
                              className="h-full w-full object-cover"
                              fallbackIcon={
                                <Disc3 className="h-3 w-3 text-zinc-400" aria-hidden="true" />
                              }
                            />
                          ) : (
                            <div
                              key={`empty-${i}`}
                              className="bg-[#E4DDD0]"
                              aria-hidden="true"
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-400">
                        <ImagePlus className="h-6 w-6" aria-hidden="true" />
                      </div>
                    )}
                    {coverUploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-[#FAF8F5]/80">
                        <Loader2 className="h-5 w-5 animate-spin text-accent" />
                      </div>
                    )}
                    {coverUrl && !coverUploading && (
                      <button
                        type="button"
                        onClick={() => setCoverUrl(null)}
                        className="absolute right-1 top-1 rounded-md bg-[#FAF8F5]/90 p-0.5 text-zinc-500 transition-colors hover:text-red-500"
                        aria-label="Remove uploaded artwork"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={coverUploading}
                      className={`${actionBtnClass} inline-flex w-full items-center justify-center gap-2 py-2 disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      {coverUploading ? "Uploading…" : "Upload Artwork"}
                    </button>
                    <p className="font-sans text-[10px] leading-snug text-zinc-500">
                      Square image recommended. Without an upload, seed-track
                      artwork is used.
                    </p>
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadCover(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
                {coverError && (
                  <p className="font-sans text-[10px] text-red-500" role="alert">
                    {coverError}
                  </p>
                )}
              </div>

              {saveError && <p className="font-sans text-[10px] text-red-500">{saveError}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveStation}
                  className={`${actionBtnClass} flex-1 py-2`}
                >
                  Save Station
                </button>
                <button
                  type="button"
                  onClick={closeSaveForm}
                  className="bg-white hover:bg-zinc-100 border border-[#D2C5B4] text-zinc-700 font-mono text-xs px-3 py-2 rounded-lg transition-all"
                >
                  Cancel
                </button>
              </div>

              <p className="font-sans text-[10px] text-zinc-500">
                Saves the current {queue.length} track{queue.length === 1 ? "" : "s"} as this
                station&rsquo;s seed tracks.
              </p>
            </div>
          ) : !searchOpen ? (
            <>
              {savedStationName && (
                <p className="flex items-center gap-1.5 font-sans text-[10px] text-accent">
                  <Check className="h-3 w-3" />
                  Saved &ldquo;{savedStationName}&rdquo; to My Stations.
                </p>
              )}
              <div className={onSaveStation ? "grid grid-cols-2 gap-2" : ""}>
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className={`${actionBtnClass} w-full flex items-center justify-center gap-2`}
                >
                  <Search className="h-3.5 w-3.5" />
                  Search for a song
                </button>
                {onSaveStation && (
                  <button
                    type="button"
                    onClick={openSaveForm}
                    className={`${actionBtnClass} w-full flex items-center justify-center gap-2`}
                  >
                    <Radio className="h-3.5 w-3.5" />
                    Save as Station
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none z-10" />
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
                  className={`${inputClass} pl-9`}
                />
                {searchLoading && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-zinc-500" />
                )}
                {searchResults.length > 0 && (
                  <ul
                    className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-[#D2C5B4] rounded-lg overflow-hidden max-h-40 overflow-y-auto shadow-md"
                    role="listbox"
                  >
                    {searchResults.map((track, i) => (
                      <li key={trackKey(track, i)} role="option" aria-selected={i === activeResultIndex}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectResult(track)}
                          className={`w-full text-left px-3 py-2 font-sans text-xs sm:text-sm transition-colors hover:bg-[#F5F3ED] hover:text-accent ${
                            i === activeResultIndex ? "bg-[#F5F3ED] text-accent" : "text-zinc-700"
                          }`}
                        >
                          <span>{track.title}</span>
                          <span className="text-zinc-500"> — {track.artist}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {searchError && <p className="font-sans text-[10px] text-red-400/90">{searchError}</p>}

              {pendingTrack && (
                <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
                  <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest mb-1">
                    Selected
                  </p>
                  <p className="font-sans text-xs text-zinc-900 truncate">
                    {pendingTrack.title} — {pendingTrack.artist}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => addPending("next")}
                      className={`${actionBtnClass} flex-1 py-1.5`}
                    >
                      Next in Queue
                    </button>
                    <button
                      type="button"
                      onClick={() => addPending("append")}
                      className="bg-white hover:bg-zinc-100 border border-[#D2C5B4] text-zinc-700 font-mono text-xs px-3 py-1.5 rounded-lg transition-all flex-1"
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
                className="font-sans text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors"
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
