/**
 * Anti-Repetition Fact Engine — served-fact ledger for DJ lore.
 *
 * Tracks which `lore_facts` rows a Clerk user has already heard so
 * `/api/generate-script` can inject negative prompt directives.
 */

import { eq, inArray } from "drizzle-orm";
import { db, loreFacts, userLoreHistory } from "@/lib/db";

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
