/**
 * Anti-Repetition Fact Engine — served-fact ledger for DJ lore.
 *
 * Tracks which `lore_facts` rows a Clerk user has already heard so
 * `/api/generate-script` can inject a verified fact (positive grounding)
 * and negative prompt directives (anti-repetition).
 */

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, loreFacts, userLoreHistory } from "@/lib/db";

/** One verified lore fact that this listener has not yet heard. */
export type UnservedLoreFact = {
  factId: string;
  factText: string;
};

/** Previously served lore fact ids for a listener (deduped). */
export async function getServedFactIds(userId: string): Promise<string[]> {
  const trimmed = userId.trim();
  if (!trimmed) return [];

  const rows = await db
    .select({ factId: userLoreHistory.factId })
    .from(userLoreHistory)
    .where(eq(userLoreHistory.userId, trimmed));

  return [...new Set(rows.map((row) => row.factId))];
}

/**
 * Resolve served fact texts for negative-prompt injection.
 * Returns an empty list when the user has no history or DB is unavailable.
 */
export async function getExcludedFactTopics(userId: string): Promise<string[]> {
  const factIds = await getServedFactIds(userId);
  if (!factIds.length) return [];

  const rows = await db
    .select({ factText: loreFacts.factText })
    .from(loreFacts)
    .where(inArray(loreFacts.id, factIds));

  return rows
    .map((row) => row.factText.trim())
    .filter((text) => text.length > 0);
}

/**
 * Pick one verified, unserved lore fact for this listener.
 *
 * Preference: current track → current artist → current album → any unserved
 * row. Returns null when none remain. Fail-open: DB errors return null.
 */
export async function getUnservedLoreFact(
  userId?: string | null,
  ids?: {
    artistId?: string | null;
    trackId?: string | null;
    albumId?: string | null;
  },
): Promise<UnservedLoreFact | null> {
  try {
    const servedIds = await getServedFactIds(userId ?? "");
    const trackId = ids?.trackId?.trim() || undefined;
    const artistId = ids?.artistId?.trim() || undefined;
    const albumId = ids?.albumId?.trim() || undefined;

    if (trackId) {
      const match = await selectUnservedFact(servedIds, eq(loreFacts.trackId, trackId));
      if (match) return match;
    }
    if (artistId) {
      const match = await selectUnservedFact(servedIds, eq(loreFacts.artistId, artistId));
      if (match) return match;
    }
    if (albumId) {
      const match = await selectUnservedFact(servedIds, eq(loreFacts.albumId, albumId));
      if (match) return match;
    }

    return await selectUnservedFact(servedIds);
  } catch {
    return null;
  }
}

/** Record that a DJ break containing this fact finished playback. */
export async function logServedFact(userId: string, factId: string): Promise<void> {
  const trimmedUser = userId.trim();
  const trimmedFact = factId.trim();
  if (!trimmedUser || !trimmedFact) return;

  await db.insert(userLoreHistory).values({
    userId: trimmedUser,
    factId: trimmedFact,
  });
}

async function selectUnservedFact(
  servedIds: string[],
  match?: ReturnType<typeof eq>,
): Promise<UnservedLoreFact | null> {
  const rows = await db
    .select({ factId: loreFacts.id, factText: loreFacts.factText })
    .from(loreFacts)
    .where(
      and(
        match,
        servedIds.length ? notInArray(loreFacts.id, servedIds) : undefined,
      ),
    )
    .limit(1);

  const row = rows[0];
  const factText = row?.factText?.trim() ?? "";
  if (!row?.factId || !factText) return null;
  return { factId: row.factId, factText };
}
