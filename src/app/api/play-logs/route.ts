import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { lookupMusicBrainzRecording } from "@/lib/catalog/musicbrainz";
import { db, getDb, userPlayLogs, users } from "@/lib/db";
import { isHttpStreamUrl } from "@/lib/audio/DirectStreamProvider";

export const dynamic = "force-dynamic";

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

const playLogBodySchema = z.object({
  playSessionId: z.string().trim().min(1),
  trackTitle: z.string().trim().min(1),
  artistName: z.string().trim().min(1),
  albumTitle: optionalText,
  isrc: optionalText,
  durationSec: z.number().finite().positive().optional(),
  streamUrl: optionalText,
});

function isDatabaseConfigured(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

function normalizeIsrc(value: string | undefined): string | undefined {
  const isrc = value?.trim().toUpperCase();
  return isrc && isrc.length >= 12 ? isrc : undefined;
}

async function ensureUserRow(userId: string): Promise<boolean> {
  try {
    const clerkUser = await currentUser();
    const email =
      clerkUser?.primaryEmailAddress?.emailAddress?.trim() ||
      clerkUser?.emailAddresses?.[0]?.emailAddress?.trim() ||
      `${userId}@users.clerk`;
    await db
      .insert(users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: users.id });
    return true;
  } catch (error) {
    console.warn("[api/play-logs] Failed to ensure user row:", error);
    return false;
  }
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = playLogBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid play-log payload" }, { status: 400 });
  }

  const body = parsed.data;
  if (body.streamUrl && !isHttpStreamUrl(body.streamUrl)) {
    return NextResponse.json({ error: "Invalid streamUrl" }, { status: 400 });
  }

  const { userId: clerkUserId } = await auth();
  let resolvedIsrc = normalizeIsrc(body.isrc);

  if (!resolvedIsrc) {
    const meta = await lookupMusicBrainzRecording(body.artistName, body.trackTitle);
    resolvedIsrc = normalizeIsrc(meta?.isrc);
  }

  if (!isDatabaseConfigured()) {
    console.warn(
      "[api/play-logs] DATABASE_URL is not configured — skipping user_play_logs insert",
    );
    return NextResponse.json({ success: true, isrc: resolvedIsrc ?? null });
  }

  let userId: string | null = clerkUserId ?? null;
  if (userId) {
    const ok = await ensureUserRow(userId);
    if (!ok) userId = null;
  }

  try {
    await db
      .insert(userPlayLogs)
      .values({
        userId,
        isrc: resolvedIsrc,
        trackTitle: body.trackTitle,
        artistName: body.artistName,
        albumTitle: body.albumTitle,
        durationSec: body.durationSec,
        playSessionId: body.playSessionId,
      })
      .onConflictDoNothing({ target: userPlayLogs.playSessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/play-logs] Insert failed:", message);
    return NextResponse.json({ error: "Failed to commit play log" }, { status: 500 });
  }

  return NextResponse.json({ success: true, isrc: resolvedIsrc ?? null });
}
