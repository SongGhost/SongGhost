/**
 * One New script + one voice clip. Used by warmup and by playNewBreak.
 * Does not call the Classic two-clip generator.
 */

import type { LocalVoiceSlot } from "@/types/voice";
import type { DjSegmentPlan } from "@/types/dj";
import type { AlbumContext } from "@/types/station";

export type NewBreakClipRequest = {
  songTitle: string;
  artistName: string;
  album?: string;
  releaseYear?: number;
  personaId?: string;
  provider?: string;
  voice?: string;
  voiceSlot?: LocalVoiceSlot;
  tier?: "free" | "pro";
  stationId?: string;
  stationName?: string;
  commentaryFormat?: string;
  segmentPlan?: DjSegmentPlan;
  previousTrack?: { title: string; artist: string };
  albumContext?: AlbumContext | null;
  allowExplicit?: boolean;
  homeCity?: string;
  signal?: AbortSignal;
};

function voiceSlotField(slot: LocalVoiceSlot | undefined): { voiceSlot: LocalVoiceSlot } | Record<string, never> {
  return slot != null ? { voiceSlot: slot } : {};
}

export async function synthesizeNewBreak(
  request: NewBreakClipRequest,
): Promise<{ blob: Blob; script: string } | null> {
  if (request.signal?.aborted) return null;

  const scriptResponse = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      djEngine: "new",
      songTitle: request.songTitle,
      artistName: request.artistName,
      album: request.album,
      releaseYear: request.releaseYear,
      hostId: request.personaId,
      personaId: request.personaId,
      provider: request.provider,
      voice: request.voice,
      tier: request.tier,
      stationId: request.stationId,
      stationName: request.stationName,
      commentaryFormat: request.commentaryFormat,
      segmentPlan: request.segmentPlan,
      previousTrack: request.previousTrack,
      albumContext: request.albumContext,
      allowExplicit: request.allowExplicit,
      homeCity: request.segmentPlan?.kind === "local_events" ? request.homeCity : undefined,
      ...voiceSlotField(request.voiceSlot),
    }),
    signal: request.signal,
  });

  if (!scriptResponse.ok || request.signal?.aborted) return null;
  const payload = (await scriptResponse.json()) as { script?: unknown };
  const script = typeof payload.script === "string" ? payload.script.trim() : "";
  if (!script || request.signal?.aborted) return null;

  const voiceResponse = await fetch("/api/generate-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: script,
      personaId: request.personaId,
      provider: request.provider ?? "openai",
      voice: request.voice,
      tier: request.tier,
      ...voiceSlotField(request.voiceSlot),
    }),
    signal: request.signal,
  });

  if (!voiceResponse.ok || request.signal?.aborted) return null;
  const buffer = await voiceResponse.arrayBuffer();
  if (request.signal?.aborted) return null;
  return {
    script,
    blob: new Blob([buffer], {
      type: voiceResponse.headers.get("content-type") || "audio/mpeg",
    }),
  };
}
