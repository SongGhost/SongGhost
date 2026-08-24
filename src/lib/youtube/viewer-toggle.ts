"use client";

import { useCallback, useEffect, useState } from "react";
import { YT_EMBED_HIDDEN, YT_EMBED_VISIBLE } from "@/lib/youtube/embed-size";

/** localStorage flag for the test-only YouTube dock viewer. Default off. */
export const STORAGE_YOUTUBE_VIEWER = "songhost_youtube_viewer";

const YOUTUBE_VIEWER_CHANGE_EVENT = "songhost:youtube-viewer";

export { YT_EMBED_HIDDEN, YT_EMBED_VISIBLE };

export function readYoutubeViewerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_YOUTUBE_VIEWER) === "true";
  } catch {
    return false;
  }
}

export function writeYoutubeViewerEnabled(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_YOUTUBE_VIEWER, next ? "true" : "false");
  } catch {
    /* private mode / quota */
  }
  window.dispatchEvent(new Event(YOUTUBE_VIEWER_CHANGE_EVENT));
}

/**
 * Test-only dock viewer. Default is hidden (current production host).
 * Toggling does not remount the iframe.
 */
export function useYoutubeViewerEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(readYoutubeViewerEnabled());
    const onChange = () => setEnabled(readYoutubeViewerEnabled());
    window.addEventListener(YOUTUBE_VIEWER_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(YOUTUBE_VIEWER_CHANGE_EVENT, onChange);
  }, []);

  const setViewerEnabled = useCallback((next: boolean) => {
    writeYoutubeViewerEnabled(next);
    setEnabled(next);
  }, []);

  return [enabled, setViewerEnabled];
}
