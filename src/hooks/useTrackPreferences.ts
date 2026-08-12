"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import {
  liftBan,
  loadTrackFeedback,
  normalizeArtistKey,
  unfavoriteTrack,
  type TrackFeedback,
} from "@/lib/user/feedback";
import { getYouTubeThumbnail } from "@/lib/youtube";
import type { LikedTrack } from "@/types/user";

const BLOCKED_STORAGE_KEY = "songghost:blocked-preferences";
const MAX_BLOCKED_ENTRIES = 500;

/** Tabs the preference drawer can open onto. */
export type TrackPreferenceTab = "LIKED TRACKS" | "BLOCKED TRACKS & ARTISTS";

export type BlockedPreferenceKind = "track" | "artist";

/** Renderable block-list row — richer than the id-only feedback blacklist. */
export type BlockedPreferenceEntry = {
  id: string;
  kind: BlockedPreferenceKind;
  title: string;
  artist: string;
  youtubeId?: string;
  artworkUrl?: string;
  addedAt: string;
};

export type LikedPreferenceEntry = {
  id: string;
  title: string;
  artist: string;
  youtubeId: string;
  artworkUrl?: string;
  addedAt: string;
};

function isStorageReady(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage?.getItem === "function";
  } catch {
    return false;
  }
}

function readBlockedEntries(): BlockedPreferenceEntry[] {
  if (!isStorageReady()) return [];
  try {
    const raw = window.localStorage.getItem(BLOCKED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeBlockedEntries(parsed);
  } catch {
    return [];
  }
}

function writeBlockedEntries(entries: BlockedPreferenceEntry[]): void {
  if (!isStorageReady()) return;
  try {
    window.localStorage.setItem(
      BLOCKED_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_BLOCKED_ENTRIES)),
    );
  } catch {
    // Quota / private mode: keep the in-memory list for the session.
  }
}

function normalizeBlockedEntries(value: unknown[]): BlockedPreferenceEntry[] {
  const out: BlockedPreferenceEntry[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<BlockedPreferenceEntry>;
    const kind: BlockedPreferenceKind = row.kind === "artist" ? "artist" : "track";
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : id;
    const artist =
      typeof row.artist === "string" && row.artist.trim()
        ? row.artist.trim()
        : kind === "artist"
          ? title
          : "Unknown artist";
    const youtubeId =
      typeof row.youtubeId === "string" && row.youtubeId.trim()
        ? row.youtubeId.trim()
        : undefined;
    const artworkUrl =
      typeof row.artworkUrl === "string" && row.artworkUrl.trim()
        ? row.artworkUrl.trim()
        : youtubeId
          ? getYouTubeThumbnail(youtubeId)
          : undefined;
    const addedAt =
      typeof row.addedAt === "string" && row.addedAt.trim()
        ? row.addedAt.trim()
        : new Date().toISOString();

    out.push({
      id,
      kind,
      title,
      artist,
      ...(youtubeId ? { youtubeId } : {}),
      ...(artworkUrl ? { artworkUrl } : {}),
      addedAt,
    });
  }

  return out.slice(0, MAX_BLOCKED_ENTRIES);
}

/**
 * Merge id-only blacklist entries that never got a rich metadata row (legacy
 * bans, or bans recorded before this store existed).
 */
function reconcileBlockedWithFeedback(
  entries: BlockedPreferenceEntry[],
  feedback: TrackFeedback,
): BlockedPreferenceEntry[] {
  const byKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));

  for (const trackId of feedback.bannedTracks) {
    const key = `track:${trackId}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      id: trackId,
      kind: "track",
      title: "Blocked track",
      artist: "Unknown artist",
      addedAt: new Date(0).toISOString(),
    });
  }

  for (const artistKey of feedback.bannedArtists) {
    const key = `artist:${artistKey}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      id: artistKey,
      kind: "artist",
      title: artistKey,
      artist: artistKey,
      addedAt: new Date(0).toISOString(),
    });
  }

  return Array.from(byKey.values()).sort(
    (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
  );
}

function toLikedEntries(likedTracks: LikedTrack[]): LikedPreferenceEntry[] {
  return likedTracks.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    youtubeId: track.youtubeId,
    artworkUrl: track.youtubeId ? getYouTubeThumbnail(track.youtubeId) : undefined,
    addedAt: track.likedAt,
  }));
}

export type RecordBlockedInput = {
  trackId?: string;
  youtubeId?: string;
  title?: string;
  artist?: string;
  /** When true, also (or only) record an artist-level ban row. */
  banArtist?: boolean;
  artworkUrl?: string;
};

export type UseTrackPreferencesResult = {
  drawerOpen: boolean;
  activeTab: TrackPreferenceTab;
  openDrawer: (tab: TrackPreferenceTab) => void;
  setActiveTab: (tab: TrackPreferenceTab) => void;
  closeDrawer: () => void;
  likedTracks: LikedPreferenceEntry[];
  blockedEntries: BlockedPreferenceEntry[];
  likedCount: number;
  blockedCount: number;
  /** Persist a rich block-list row alongside the id-only feedback blacklist. */
  recordBlocked: (input: RecordBlockedInput) => void;
  removeLiked: (youtubeId: string) => void;
  removeBlocked: (entry: BlockedPreferenceEntry) => void;
  /**
   * Notify the hook that the id-only feedback store changed so legacy bans
   * without metadata can surface in the drawer.
   */
  syncFromFeedback: (feedback?: TrackFeedback) => void;
};

/**
 * Liked / blocked preference surface for the track-feedback drawer.
 *
 * Liked rows live in `UserPreferences`. Blocked rows keep renderable metadata
 * in a parallel localStorage list — the queue blacklist stays id-only in
 * `feedback.ts` so admission stays synchronous and provider-agnostic.
 */
export function useTrackPreferences(
  onFeedbackChange?: (feedback: TrackFeedback) => void,
): UseTrackPreferencesResult {
  const { likedTracks: likedFromPrefs, toggleLikedTrack } = useUserPreferences();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TrackPreferenceTab>("LIKED TRACKS");
  const [blockedEntries, setBlockedEntries] = useState<BlockedPreferenceEntry[]>([]);

  useEffect(() => {
    setBlockedEntries(
      reconcileBlockedWithFeedback(readBlockedEntries(), loadTrackFeedback()),
    );
  }, []);

  const syncFromFeedback = useCallback(
    (feedback?: TrackFeedback) => {
      const source = feedback ?? loadTrackFeedback();
      setBlockedEntries((prev) => {
        const merged = reconcileBlockedWithFeedback(prev, source);
        writeBlockedEntries(merged);
        return merged;
      });
    },
    [],
  );

  const openDrawer = useCallback((tab: TrackPreferenceTab) => {
    setActiveTab(tab);
    setDrawerOpen(true);
  }, []);

  const selectTab = useCallback((tab: TrackPreferenceTab) => {
    setActiveTab(tab);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const recordBlocked = useCallback(
    (input: RecordBlockedInput) => {
      const now = new Date().toISOString();
      const trackId = input.trackId?.trim() ?? "";
      const youtubeId = input.youtubeId?.trim() || undefined;
      const title = input.title?.trim() || "Blocked track";
      const artist = input.artist?.trim() || "Unknown artist";
      const artworkUrl =
        input.artworkUrl?.trim() ||
        (youtubeId ? getYouTubeThumbnail(youtubeId) : undefined);

      setBlockedEntries((prev) => {
        let next = [...prev];

        if (trackId) {
          next = next.filter((entry) => !(entry.kind === "track" && entry.id === trackId));
          next.unshift({
            id: trackId,
            kind: "track",
            title,
            artist,
            ...(youtubeId ? { youtubeId } : {}),
            ...(artworkUrl ? { artworkUrl } : {}),
            addedAt: now,
          });
        }

        if (input.banArtist) {
          const artistKey = normalizeArtistKey(artist);
          if (artistKey) {
            next = next.filter(
              (entry) => !(entry.kind === "artist" && entry.id === artistKey),
            );
            next.unshift({
              id: artistKey,
              kind: "artist",
              title: artist,
              artist,
              addedAt: now,
            });
          }
        }

        const trimmed = next.slice(0, MAX_BLOCKED_ENTRIES);
        writeBlockedEntries(trimmed);
        return trimmed;
      });
    },
    [],
  );

  const removeLiked = useCallback(
    (youtubeId: string) => {
      const id = youtubeId.trim();
      if (!id) return;
      const liked = likedFromPrefs.find((track) => track.youtubeId === id);
      if (liked) {
        toggleLikedTrack({
          id: liked.id,
          title: liked.title,
          artist: liked.artist,
          youtubeId: liked.youtubeId,
        });
        const nextFeedback = unfavoriteTrack(liked.id);
        onFeedbackChange?.(nextFeedback);
      } else {
        const nextFeedback = unfavoriteTrack(id);
        onFeedbackChange?.(nextFeedback);
      }
    },
    [likedFromPrefs, onFeedbackChange, toggleLikedTrack],
  );

  const removeBlocked = useCallback(
    (entry: BlockedPreferenceEntry) => {
      const nextFeedback =
        entry.kind === "artist"
          ? liftBan("", entry.artist || entry.id)
          : liftBan(entry.id);
      onFeedbackChange?.(nextFeedback);

      setBlockedEntries((prev) => {
        const trimmed = prev.filter(
          (row) => !(row.kind === entry.kind && row.id === entry.id),
        );
        writeBlockedEntries(trimmed);
        return trimmed;
      });
    },
    [onFeedbackChange],
  );

  const likedTracks = useMemo(() => toLikedEntries(likedFromPrefs), [likedFromPrefs]);

  return {
    drawerOpen,
    activeTab,
    openDrawer,
    setActiveTab: selectTab,
    closeDrawer,
    likedTracks,
    blockedEntries,
    likedCount: likedTracks.length,
    blockedCount: blockedEntries.length,
    recordBlocked,
    removeLiked,
    removeBlocked,
    syncFromFeedback,
  };
}
