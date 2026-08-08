import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { DEFAULT_PERSONA } from "@/data/personas";
import {
  normalizeBreakTiming,
  normalizeStudioDjConfig,
  type StudioDjBreakCue,
  type StudioManifestTrack,
  type StudioStationManifest,
} from "@/lib/studio/manifest";
import {
  getLocalManifest,
  indexStudioManifestForUser,
  loadStudioManifest,
  loadStudioManifestsForUser,
  persistStudioManifest,
  setLocalManifest,
} from "@/lib/studio/manifest-store";

export const dynamic = "force-dynamic";

export type {
  StudioDjBreakCue,
  StudioManifestTrack,
  StudioStationManifest,
} from "@/lib/studio/manifest";

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
  const timing = normalizeBreakTiming(raw.timing);
  if (timing) cue.timing = timing;
  const audioUrl = asNonEmptyString(raw.audioUrl);
  if (audioUrl) cue.audioUrl = audioUrl;
  const customText = asNonEmptyString(raw.customText);
  if (customText) cue.customText = customText;
  const voiceId = asNonEmptyString(raw.voiceId);
  if (voiceId) cue.voiceId = voiceId;
  const label = asNonEmptyString(raw.label);
  if (label) cue.label = label;
  if (raw.isCallIn === true) cue.isCallIn = true;
  if (raw.isCallIn === false) cue.isCallIn = false;
  return cue;
}

function normalizeCallerUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry != null);
}

/**
 * GET `?id=` — load one published studio station manifest.
 * GET `?userId=` — list authored studio mixes for that account (dashboard hydrate).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = asNonEmptyString(searchParams.get("userId"));
    if (userId) {
      const manifests = await loadStudioManifestsForUser(userId);
      return NextResponse.json({
        userId,
        mixes: manifests,
        manifests,
      });
    }

    const id = asNonEmptyString(searchParams.get("id"));
    if (!id) {
      return NextResponse.json(
        { error: "Missing studio station id or userId" },
        { status: 400 },
      );
    }

    const local = getLocalManifest(id);
    if (local) {
      return NextResponse.json({ id: local.id, manifest: local });
    }

    const remote = await loadStudioManifest(id);
    if (remote) {
      return NextResponse.json({ id: remote.id, manifest: remote });
    }

    return NextResponse.json(
      { error: "Studio station not found" },
      { status: 404 },
    );
  } catch (err) {
    console.error("[studio/save-station] GET failed:", err);
    return NextResponse.json(
      {
        error: "Failed to load studio station manifest",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/**
 * POST JSON station manifests (tracks, DJ break cue points, caller audio URLs, djConfig).
 * Persists to R2 under `studio-stations/{id}.json` and indexes under `authorUserId` when set.
 * When `id` is present, overwrites the existing station record instead of minting a new UUID.
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
    const existingId = asNonEmptyString(body.id);
    const isUpdate = Boolean(existingId);
    const id = existingId ?? randomUUID();

    // When overwriting, prefer the stored createdAt so edits don't reset provenance.
    let preservedCreatedAt: string | null = asNonEmptyString(body.createdAt);
    let preservedAuthor: string | null = null;
    if (isUpdate && existingId) {
      const prior =
        getLocalManifest(existingId) ?? (await loadStudioManifest(existingId));
      if (prior) {
        preservedCreatedAt = prior.createdAt || preservedCreatedAt;
        preservedAuthor = prior.authorUserId?.trim() || null;
      }
    }

    const djConfig = normalizeStudioDjConfig(body.djConfig, DEFAULT_PERSONA.id);
    const authorUserId =
      asNonEmptyString(body.authorUserId) ??
      asNonEmptyString(body.userId) ??
      preservedAuthor;
    const coverImageUrl = asNonEmptyString(body.coverImageUrl);

    const manifest: StudioStationManifest = {
      id,
      name,
      tracks,
      djBreaks,
      callerAudioUrls,
      djConfig,
      createdAt: preservedCreatedAt ?? now,
      updatedAt: now,
    };

    const description = asNonEmptyString(body.description);
    if (description) manifest.description = description;
    if (coverImageUrl) {
      manifest.coverImageUrl = coverImageUrl;
    } else if (isUpdate) {
      // Explicit omit clears cover on overwrite.
      delete manifest.coverImageUrl;
    }
    if (authorUserId) manifest.authorUserId = authorUserId;

    // Keep cache warm before persist so concurrent readers see the draft.
    setLocalManifest(manifest);
    const { url, key } = await persistStudioManifest(manifest);

    if (authorUserId) {
      await indexStudioManifestForUser(authorUserId, manifest.id);
    }

    if (isUpdate) {
      return NextResponse.json({
        success: true,
        id: manifest.id,
        message: "Station updated",
        url,
        key,
        manifest,
      });
    }

    return NextResponse.json({
      success: true,
      id: manifest.id,
      message: "Station created",
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
