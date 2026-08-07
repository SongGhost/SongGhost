import { NextResponse } from "next/server";
import { applyTelephoneBandpass } from "@/lib/audio/telephone-eq";
import {
  loadStudioManifest,
  persistStudioManifest,
} from "@/lib/studio/manifest-store";
import type { StudioDjBreakCue } from "@/lib/studio/manifest";
import {
  audioBufferToDataUrl,
  isR2Configured,
  uploadR2Buffer,
  VOICEMAILS_PREFIX,
} from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

function asNonEmptyString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAudioBlob(formData: FormData): File | null {
  const preferred = ["audioBlob", "audio", "file", "blob"];
  for (const key of preferred) {
    const value = formData.get(key);
    if (value instanceof File && value.size > 0) return value;
  }

  for (const value of formData.values()) {
    if (value instanceof File && value.size > 0 && value.type.startsWith("audio/")) {
      return value;
    }
  }
  return null;
}

/**
 * POST multipart/form-data: `audioBlob`, `stationId`, optional `callerName`.
 * Stores under R2 `voicemails/{stationId}_{timestamp}.mp3` and appends a
 * `call_in` break (`isCallIn: true`) onto the station manifest.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const stationId = asNonEmptyString(formData.get("stationId"));
    if (!stationId) {
      return NextResponse.json(
        { error: "Missing stationId in multipart form data" },
        { status: 400 },
      );
    }

    const file = resolveAudioBlob(formData);
    if (!file) {
      return NextResponse.json(
        { error: "Missing audioBlob in multipart form data" },
        { status: 400 },
      );
    }

    const callerName = asNonEmptyString(formData.get("callerName"));
    const manifest = await loadStudioManifest(stationId);
    if (!manifest) {
      return NextResponse.json(
        { error: "Studio station not found" },
        { status: 404 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    const bandpass = applyTelephoneBandpass(buffer);
    buffer = Buffer.from(bandpass.buffer);

    const timestamp = Date.now();
    const key = `${VOICEMAILS_PREFIX}/${stationId}_${timestamp}.mp3`;
    const mimeType = file.type || "audio/mpeg";

    let url: string;
    if (isR2Configured()) {
      url = await uploadR2Buffer(key, buffer, mimeType);
    } else {
      console.warn(
        "[studio/upload-voicemail] R2 unconfigured — returning inline data URL",
      );
      url = audioBufferToDataUrl(buffer, mimeType);
    }

    const label = callerName
      ? `Voicemail from ${callerName}`
      : "Friend voicemail";

    const lastTrackIndex = Math.max(0, manifest.tracks.length - 1);
    const cue: StudioDjBreakCue = {
      cuePointSec: 0,
      trackIndex: lastTrackIndex,
      kind: "call_in",
      timing: "BETWEEN_TRACKS",
      audioUrl: url,
      label,
      isCallIn: true,
    };

    const now = new Date().toISOString();
    const updated = {
      ...manifest,
      djBreaks: [...manifest.djBreaks, cue],
      callerAudioUrls: [...manifest.callerAudioUrls, url],
      updatedAt: now,
    };

    const saved = await persistStudioManifest(updated);

    return NextResponse.json({
      url,
      key,
      stationId,
      callerName: callerName ?? null,
      isCallIn: true,
      callInApplied: bandpass.applied,
      bytes: buffer.byteLength,
      contentType: mimeType,
      stationTitle: updated.name,
      manifest: updated,
      manifestKey: saved.key,
      manifestUrl: saved.url,
    });
  } catch (err) {
    console.error("[studio/upload-voicemail] Upload failed:", err);
    return NextResponse.json(
      {
        error: "Failed to upload voicemail",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
