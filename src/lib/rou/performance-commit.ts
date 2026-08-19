/**
 * SoundExchange ROU performance-commit helpers (37 CFR § 370).
 * DirectStream-only — quarantined companion adapters must not import this
 * to write `user_play_logs`.
 */

import { isHttpStreamUrl } from "@/lib/audio/DirectStreamProvider";
import type { PlaybackState } from "@/types/audio";

/** A performance is committed only after the playhead has passed this mark. */
export const PERFORMANCE_COMMIT_SECONDS = 30;

export type RouPerformancePayload = {
  playSessionId: string;
  trackTitle: string;
  artistName: string;
  albumTitle?: string;
  isrc?: string;
  /** Licensed HTTP stream. Preview-only URLs must not be supplied. */
  streamUrl: string;
  durationSec?: number;
};

export function buildPlaySessionId(input: {
  stationId: string;
  trackId: string;
  queueIndex: number;
  queueGeneration: number;
}): string {
  return `${input.stationId}:${input.trackId}:${input.queueIndex}:${input.queueGeneration}`;
}

export function isLicensedStreamUrl(url: string | undefined | null): boolean {
  return isHttpStreamUrl(url);
}

export function shouldCommitPerformance(input: {
  position: number;
  playbackState: PlaybackState;
  playSessionId: string | undefined;
  committedSessionId: string | null;
  licensedStreamUrl: string | undefined;
}): boolean {
  if (!input.playSessionId) return false;
  if (input.committedSessionId === input.playSessionId) return false;
  if (input.playbackState !== "playing") return false;
  if (!(input.position > PERFORMANCE_COMMIT_SECONDS)) return false;
  if (!isLicensedStreamUrl(input.licensedStreamUrl)) return false;
  return true;
}

export async function postPlayLog(
  payload: RouPerformancePayload,
): Promise<string | undefined> {
  try {
    const res = await fetch("/api/play-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { success?: boolean; isrc?: string | null };
    const isrc = data.isrc?.trim();
    return isrc ? isrc.toUpperCase() : undefined;
  } catch (error) {
    console.warn("[rou] performance commit failed:", error);
    return undefined;
  }
}
