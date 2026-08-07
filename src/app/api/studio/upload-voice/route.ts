import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { applyTelephoneBandpass } from "@/lib/audio/telephone-eq";
import {
  audioBufferToDataUrl,
  isR2Configured,
  STUDIO_BREAKS_PREFIX,
  uploadR2Buffer,
} from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const PUBLIC_R2_DEV_BASE =
  "https://pub-4ccaecae14d948fda893e9fe29f7734b.r2.dev";

function parseIsCallIn(formData: FormData, request: Request): boolean {
  const header = request.headers.get("x-is-call-in") ?? request.headers.get("isCallIn");
  if (header != null) {
    const normalized = header.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  const field = formData.get("isCallIn");
  if (typeof field === "string") {
    const normalized = field.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

function resolveAudioFile(formData: FormData): File | null {
  const candidates = ["audio", "file", "blob"];
  for (const key of candidates) {
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

function publicStudioBreakUrl(filename: string): string {
  const cdn =
    process.env.NEXT_PUBLIC_R2_CDN_URL?.replace(/\/$/, "") || PUBLIC_R2_DEV_BASE;
  return `${cdn}/${STUDIO_BREAKS_PREFIX}/${filename}.mp3`;
}

/**
 * POST multipart/form-data with an audio blob (+ optional `isCallIn`).
 * Stores under R2 `studio-breaks/` and returns the public clip URL.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = resolveAudioFile(formData);
    if (!file) {
      return NextResponse.json(
        { error: "Missing audio file in multipart form data" },
        { status: 400 },
      );
    }

    const isCallIn = parseIsCallIn(formData, request);
    const arrayBuffer = await file.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);
    let callInApplied = false;

    if (isCallIn) {
      const result = applyTelephoneBandpass(buffer);
      buffer = Buffer.from(result.buffer);
      callInApplied = result.applied;
    }

    const filename = randomUUID();
    const key = `${STUDIO_BREAKS_PREFIX}/${filename}.mp3`;
    const mimeType = file.type || "audio/mpeg";

    let url: string;
    if (isR2Configured()) {
      url = await uploadR2Buffer(key, buffer, mimeType);
    } else {
      console.warn(
        "[studio/upload-voice] R2 unconfigured — returning inline data URL",
      );
      url = audioBufferToDataUrl(buffer, mimeType);
    }

    // Contract URL shape for configured CDN (matches pub-*.r2.dev/studio-breaks/{id}.mp3).
    const publicUrl = isR2Configured() ? publicStudioBreakUrl(filename) : url;

    return NextResponse.json({
      url: publicUrl,
      key,
      filename: `${filename}.mp3`,
      isCallIn,
      callInApplied,
      bytes: buffer.byteLength,
      contentType: mimeType,
    });
  } catch (err) {
    console.error("[studio/upload-voice] Upload failed:", err);
    return NextResponse.json(
      {
        error: "Failed to upload studio voice clip",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
