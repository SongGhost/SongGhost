"use client";

import { useEffect, useRef } from "react";
import { getYouTubeThumbnail } from "@/lib/youtube";

export type MediaSessionMetadataInput = {
  title: string;
  artist: string;
  album?: string;
  /** Primary artwork URL (used for all declared sizes when `artwork` is omitted). */
  artworkUrl?: string | null;
  /** Optional YouTube id — builds a multi-resolution artwork ladder. */
  youtubeId?: string | null;
  /** Explicit Media Session artwork entries; wins over `artworkUrl` / `youtubeId`. */
  artwork?: MediaMetadataInit["artwork"];
};

export type UseMediaSessionOptions = {
  /** When false, clears action handlers and skips metadata writes. */
  enabled?: boolean;
  metadata: MediaSessionMetadataInput | null;
  playbackState?: MediaSessionPlaybackState;
  onPlay: () => void;
  onPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
};

function guessImageType(src: string): string {
  const lower = src.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.includes("ytimg.com")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

/**
 * Build the lock-screen artwork ladder (96 / 128 / 512).
 * Prefers a YouTube quality ladder when a video id is known; otherwise repeats
 * a single URL (or the SongGhost app icon) across the three size slots.
 */
export function buildMediaSessionArtwork(
  artworkUrl?: string | null,
  youtubeId?: string | null,
): NonNullable<MediaMetadataInit["artwork"]> {
  const id = youtubeId?.trim();
  if (id) {
    return [
      {
        src: getYouTubeThumbnail(id, "default"),
        sizes: "96x96",
        type: "image/jpeg",
      },
      {
        src: getYouTubeThumbnail(id, "mq"),
        sizes: "128x128",
        type: "image/jpeg",
      },
      {
        src: getYouTubeThumbnail(id, "hq"),
        sizes: "512x512",
        type: "image/jpeg",
      },
    ];
  }

  const src = artworkUrl?.trim() || "/icon-512.png";
  const type = guessImageType(src);
  return [
    { src, sizes: "96x96", type },
    { src, sizes: "128x128", type },
    { src, sizes: "512x512", type },
  ];
}

function mediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

/**
 * Publishes now-playing metadata + lock-screen / headset Media Session actions.
 *
 * Callbacks are held in refs so parent re-renders never re-bind handlers or
 * re-trigger metadata writes from unstable function identities.
 */
export function useMediaSession({
  enabled = true,
  metadata,
  playbackState = "none",
  onPlay,
  onPause,
  onNextTrack,
  onPreviousTrack,
}: UseMediaSessionOptions): void {
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onNextTrackRef = useRef(onNextTrack);
  const onPreviousTrackRef = useRef(onPreviousTrack);

  onPlayRef.current = onPlay;
  onPauseRef.current = onPause;
  onNextTrackRef.current = onNextTrack;
  onPreviousTrackRef.current = onPreviousTrack;

  useEffect(() => {
    if (!enabled || !mediaSessionSupported()) return;

    try {
      navigator.mediaSession.setActionHandler("play", () => {
        onPlayRef.current();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        onPauseRef.current();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        onNextTrackRef.current();
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        onPreviousTrackRef.current();
      });
    } catch (err) {
      console.warn("[SongGhost] MediaSession action handlers failed", err);
    }

    return () => {
      if (!mediaSessionSupported()) return;
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
      } catch {
        // Older browsers may reject null clears.
      }
    };
  }, [enabled]);

  const title = metadata?.title?.trim() ?? "";
  const artist = metadata?.artist?.trim() ?? "";
  const album = metadata?.album?.trim() || "SongGhost Radio";
  const artworkUrl = metadata?.artworkUrl ?? null;
  const youtubeId = metadata?.youtubeId ?? null;
  const explicitArtwork = metadata?.artwork;

  useEffect(() => {
    if (!enabled || !mediaSessionSupported()) return;
    if (!title || !artist) return;

    const artwork =
      explicitArtwork ?? buildMediaSessionArtwork(artworkUrl, youtubeId);

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork,
      });
    } catch (err) {
      console.warn("[SongGhost] MediaSession metadata update failed", err);
    }
  }, [enabled, title, artist, album, artworkUrl, youtubeId, explicitArtwork]);

  useEffect(() => {
    if (!enabled || !mediaSessionSupported()) return;
    try {
      navigator.mediaSession.playbackState = playbackState;
    } catch {
      // Older browsers may reject playbackState writes.
    }
  }, [enabled, playbackState]);
}
