"use client";

import { Ban, Search, ThumbsUp, Trash2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  BlockedPreferenceEntry,
  LikedPreferenceEntry,
  TrackPreferenceTab,
} from "@/hooks/useTrackPreferences";

export type TrackPreferenceDrawerProps = {
  open: boolean;
  onClose: () => void;
  activeTab: TrackPreferenceTab;
  onTabChange: (tab: TrackPreferenceTab) => void;
  likedTracks: LikedPreferenceEntry[];
  blockedEntries: BlockedPreferenceEntry[];
  onRemoveLiked: (youtubeId: string) => void;
  onRemoveBlocked: (entry: BlockedPreferenceEntry) => void;
  accentColor?: string;
};

function formatAddedAt(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time) || time <= 0) return "Earlier";
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function matchesQuery(
  query: string,
  title: string,
  artist: string,
): boolean {
  if (!query) return true;
  const haystack = `${title} ${artist}`.toLowerCase();
  return haystack.includes(query);
}

function TabEmptyState({ children }: { children: string }) {
  return (
    <p className="px-1 py-10 text-center font-sans text-xs text-zinc-500">
      {children}
    </p>
  );
}

type PreferenceRowProps = {
  title: string;
  artist: string;
  artworkUrl?: string;
  addedAt: string;
  badge?: string;
  onRemove: () => void;
  removeLabel: string;
};

function PreferenceRow({
  title,
  artist,
  artworkUrl,
  addedAt,
  badge,
  onRemove,
  removeLabel,
}: PreferenceRowProps) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
        {artworkUrl ? (
          <Image
            src={artworkUrl}
            alt=""
            fill
            sizes="44px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Ban className="h-4 w-4 text-zinc-600" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-sans text-sm text-zinc-100">{title}</p>
          {badge ? (
            <span className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-red-300">
              {badge}
            </span>
          ) : null}
        </div>
        <p className="truncate font-mono text-[11px] text-zinc-500">{artist}</p>
        <p className="mt-0.5 font-mono text-[10px] tabular-nums text-zinc-600">
          Added {formatAddedAt(addedAt)}
        </p>
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-lg p-2 transition-colors"
        aria-label={removeLabel}
        title={removeLabel}
      >
        <Trash2 className="h-4 w-4 cursor-pointer text-slate-500 transition hover:text-red-400" />
      </button>
    </li>
  );
}

/**
 * Slide-over manager for liked tracks and the block list.
 * Presentation-only — mutations flow through `useTrackPreferences`.
 */
export default function TrackPreferenceDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
  likedTracks,
  blockedEntries,
  onRemoveLiked,
  onRemoveBlocked,
  accentColor = "#2992cf",
}: TrackPreferenceDrawerProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredLiked = useMemo(
    () =>
      likedTracks.filter((track) =>
        matchesQuery(normalizedQuery, track.title, track.artist),
      ),
    [likedTracks, normalizedQuery],
  );

  const filteredBlocked = useMemo(
    () =>
      blockedEntries.filter((entry) =>
        matchesQuery(normalizedQuery, entry.title, entry.artist),
      ),
    [blockedEntries, normalizedQuery],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close track preferences"
      />

      <aside
        className="relative flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
        style={{ "--station-accent": accentColor } as CSSProperties}
        aria-label="Track preferences"
      >
        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <ThumbsUp className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <h2 className="font-sans text-sm font-semibold text-zinc-100">
            Track Preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label="Preference lists"
          className="flex border-b border-zinc-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "LIKED TRACKS"}
            onClick={() => onTabChange("LIKED TRACKS")}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              activeTab === "LIKED TRACKS"
                ? "border-accent text-accent"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span aria-hidden="true">👍</span>
            Liked Tracks
            <span className="tabular-nums text-zinc-600">({likedTracks.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "BLOCKED TRACKS & ARTISTS"}
            onClick={() => onTabChange("BLOCKED TRACKS & ARTISTS")}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              activeTab === "BLOCKED TRACKS & ARTISTS"
                ? "border-accent text-accent"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span aria-hidden="true">🚫</span>
            Blocked Content
            <span className="tabular-nums text-zinc-600">
              ({blockedEntries.length})
            </span>
          </button>
        </div>

        <div className="border-b border-zinc-800 px-4 py-3">
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search liked or blocked tracks..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/70 py-2 pl-9 pr-3 font-sans text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-accent/50"
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {activeTab === "LIKED TRACKS" ? (
            filteredLiked.length === 0 ? (
              <TabEmptyState>
                {likedTracks.length === 0
                  ? "No liked tracks yet. Tap the thumbs-up on a song to save it."
                  : "No liked tracks match your search."}
              </TabEmptyState>
            ) : (
              <ul className="space-y-2">
                {filteredLiked.map((track) => (
                  <PreferenceRow
                    key={`${track.id}-${track.youtubeId}`}
                    title={track.title}
                    artist={track.artist}
                    artworkUrl={track.artworkUrl}
                    addedAt={track.addedAt}
                    onRemove={() => onRemoveLiked(track.youtubeId)}
                    removeLabel={`Remove ${track.title} from liked tracks`}
                  />
                ))}
              </ul>
            )
          ) : filteredBlocked.length === 0 ? (
            <TabEmptyState>
              {blockedEntries.length === 0
                ? "Nothing blocked yet. Tap Don't Play on a song to ban it."
                : "No blocked items match your search."}
            </TabEmptyState>
          ) : (
            <ul className="space-y-2">
              {filteredBlocked.map((entry) => (
                <PreferenceRow
                  key={`${entry.kind}-${entry.id}`}
                  title={entry.title}
                  artist={entry.kind === "artist" ? "All tracks by this artist" : entry.artist}
                  artworkUrl={entry.artworkUrl}
                  addedAt={entry.addedAt}
                  badge={entry.kind === "artist" ? "Artist" : undefined}
                  onRemove={() => onRemoveBlocked(entry)}
                  removeLabel={
                    entry.kind === "artist"
                      ? `Unblock artist ${entry.title}`
                      : `Unblock ${entry.title}`
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
