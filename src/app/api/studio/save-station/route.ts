import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  audioBufferToDataUrl,
  isR2Configured,
  STUDIO_STATIONS_PREFIX,
  uploadR2Buffer,
} from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

/** One track entry in a SongHost Studio station manifest. */
export type StudioManifestTrack = {
  title: string;
  artist: string;
  youtubeId?: string;
  previewUrl?: string;
  durationSec?: number;
};

/** Custom DJ / caller break cue placed on the station timeline. */
export type StudioDjBreakCue = {
  /** Absolute cue time in seconds from station start (or track-relative if trackIndex set). */
  cuePointSec: number;
  trackIndex?: number;
  kind?: "song_intro" | "stinger" | "full_break" | "call_in" | "custom";
  audioUrl?: string;
  label?: string;
};

/** JSON station manifest persisted by Ghost Studio. */
export type StudioStationManifest = {
  id: string;
  name: string;
  description?: string;
  tracks: StudioManifestTrack[];
  djBreaks: StudioDjBreakCue[];
  callerAudioUrls: string[];
  createdAt: string;
  updatedAt: string;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTrack(value: unknown): StudioManifestTrack | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const title = asNonEmptyString(raw.title);
  const artist = asNonEmptyString(raw.artist);
  if (!title || !artist) return null;

  const track: StudioManifestTrack = { title, artist };
  const youtubeId = asNonEmptyString(raw.youtubeId);
  if (youtubeId) track.youtubeId = youtubeId;
  const previewUrl = asNonEmptyString(raw.previewUrl);
  if (previewUrl) track.previewUrl = previewUrl;
  if (typeof raw.durationSec === "number" && Number.isFinite(raw.durationSec)) {
    track.durationSec = raw.durationSec;
  }
  return track;
}

function normalizeDjBreak(value: unknown): StudioDjBreakCue | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.cuePointSec !== "number" || !Number.isFinite(raw.cuePointSec)) {
    return null;
  }

  const cue: StudioDjBreakCue = { cuePointSec: raw.cuePointSec };
  if (typeof raw.trackIndex === "number" && Number.isInteger(raw.trackIndex)) {
    cue.trackIndex = raw.trackIndex;
  }
  if (
    raw.kind === "song_intro" ||
    raw.kind === "stinger" ||
    raw.kind === "full_break" ||
    raw.kind === "call_in" ||
    raw.kind === "custom"
  ) {
    cue.kind = raw.kind;
  }
  const audioUrl = asNonEmptyString(raw.audioUrl);
  if (audioUrl) cue.audioUrl = audioUrl;
  const label = asNonEmptyString(raw.label);
  if (label) cue.label = label;
  return cue;
}

function normalizeCallerUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry != null);
}

/**
 * POST JSON station manifests (tracks, DJ break cue points, caller audio URLs).
 * Persists to R2 under `studio-stations/{id}.json`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = asNonEmptyString(body.name);
    if (!name) {
      return NextResponse.json(
        { error: "Station manifest requires a non-empty name" },
        { status: 400 },
      );
    }

    const rawTracks = Array.isArray(body.tracks) ? body.tracks : [];
    const tracks = rawTracks
      .map(normalizeTrack)
      .filter((track): track is StudioManifestTrack => track != null);

    if (tracks.length === 0) {
      return NextResponse.json(
        { error: "Station manifest requires at least one valid track" },
        { status: 400 },
      );
    }

    const rawBreaks = Array.isArray(body.djBreaks)
      ? body.djBreaks
      : Array.isArray(body.customDjBreaks)
        ? body.customDjBreaks
        : [];
    const djBreaks = rawBreaks
      .map(normalizeDjBreak)
      .filter((cue): cue is StudioDjBreakCue => cue != null);

    const callerAudioUrls = normalizeCallerUrls(
      body.callerAudioUrls ?? body.callerUrls,
    );

    const now = new Date().toISOString();
    const id = asNonEmptyString(body.id) ?? randomUUID();

    const manifest: StudioStationManifest = {
      id,
      name,
      tracks,
      djBreaks,
      callerAudioUrls,
      createdAt: asNonEmptyString(body.createdAt) ?? now,
      updatedAt: now,
    };

    const description = asNonEmptyString(body.description);
    if (description) manifest.description = description;

    const key = `${STUDIO_STATIONS_PREFIX}/${id}.json`;
    const payload = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

    let url: string;
    if (isR2Configured()) {
      url = await uploadR2Buffer(key, payload, "application/json");
    } else {
      console.warn(
        "[studio/save-station] R2 unconfigured — returning inline data URL",
      );
      url = audioBufferToDataUrl(payload, "application/json");
    }

    return NextResponse.json({
      id: manifest.id,
      url,
      key,
      manifest,
    });
  } catch (err) {
    console.error("[studio/save-station] Save failed:", err);
    return NextResponse.json(
      {
        error: "Failed to save studio station manifest",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
