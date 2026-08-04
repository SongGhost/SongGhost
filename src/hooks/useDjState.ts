"use client";

import { useSyncExternalStore } from "react";
import {
  getDjBroadcastState,
  subscribeDjBroadcast,
  type DjBroadcastState,
} from "@/lib/dj/broadcast-state";

/**
 * Live view of the DJ channel: the break on air, its script, and the session's
 * transcript log.
 *
 * Read-only by design. The broadcast log is written by the audio engine alone,
 * so a UI surface subscribing here cannot perturb break scheduling or voice
 * playback no matter how often it re-renders.
 *
 * The server snapshot is the same empty state the store starts from, so the
 * first client render matches the markup React streamed.
 */
export function useDjState(): DjBroadcastState {
  return useSyncExternalStore(subscribeDjBroadcast, getDjBroadcastState, getDjBroadcastState);
}
