import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  audioBufferToDataUrl,
  isR2Configured,
  MIX_COVERS_PREFIX,
  uploadR2Buffer,
} from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const PUBLIC_R2_DEV_BASE =
  "https://pub-4ccaecae14d948fda893e9fe29f7734b.r2.dev";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

const MAX_BYTES = 5 * 1024 * 1024;

function resolveImageFile(formData: FormData): File | null {
  const candidates = ["image", "file", "cover", "blob"];
  for (const key of candidates) {
    const value = formData.get(key);
    if (value instanceof File && value.size > 0) return value;
  }

  for (const value of formData.values()) {
    if (value instanceof File && value.size > 0 && value.type.startsWith("image/")) {
      return value;
    }
  }
  return null;
}

function extensionFor(file: File): string | null {
  const mime = (file.type || "").toLowerCase();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];

  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  if (name.endsWith(".webp")) return "webp";
  return null;
}

function publicCoverUrl(filename: string): string {
  const cdn =
    process.env.NEXT_PUBLIC_R2_CDN_URL?.replace(/\/$/, "") || PUBLIC_R2_DEV_BASE;
  return `${cdn}/${MIX_COVERS_PREFIX}/${filename}`;
}

/**
 * POST multipart/form-data with a cover image (`.png`, `.jpg`, `.webp`).
 * Stores under R2 `mix-covers/` (bucket song-ghost) and returns `coverImageUrl`.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = resolveImageFile(formData);
    if (!file) {
      return NextResponse.json(
        { error: "Missing image file in multipart form data" },
        { status: 400 },
      );
    }

    const mime = (file.type || "").toLowerCase();
    const ext = extensionFor(file);
    const mimeAllowed = !mime || ALLOWED_MIME.has(mime) || mime.startsWith("image/");
    if (!ext || !mimeAllowed) {
      return NextResponse.json(
        { error: "Cover art must be a .png, .jpg, or .webp image" },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Cover image must be 5MB or smaller" },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType =
      mime === "image/jpg" || mime === "image/jpeg"
        ? "image/jpeg"
        : mime === "image/png"
          ? "image/png"
          : mime === "image/webp"
            ? "image/webp"
            : ext === "png"
              ? "image/png"
              : ext === "webp"
                ? "image/webp"
                : "image/jpeg";

    const filename = `${randomUUID()}.${ext}`;
    const key = `${MIX_COVERS_PREFIX}/${filename}`;

    let url: string;
    if (isR2Configured()) {
      url = await uploadR2Buffer(key, buffer, contentType);
    } else {
      console.warn(
        "[studio/upload-cover] R2 unconfigured — returning inline data URL",
      );
      url = audioBufferToDataUrl(buffer, contentType);
    }

    const coverImageUrl = isR2Configured() ? publicCoverUrl(filename) : url;

    return NextResponse.json({
      coverImageUrl,
      url: coverImageUrl,
      key,
      filename,
      bytes: buffer.byteLength,
      contentType,
    });
  } catch (err) {
    console.error("[studio/upload-cover] Upload failed:", err);
    return NextResponse.json(
      {
        error: "Failed to upload studio cover image",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
