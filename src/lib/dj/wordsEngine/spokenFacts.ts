/**
 * Facts already chosen for a song in this browser session.
 * Longer memory stays on the Classic lore ledger. New nuggets are not
 * rows in that ledger, so they are not written there.
 */

const sessionFacts = new Map<string, Set<string>>();
const MAX_REMEMBERED = 40;

function memoryKey(artist: string, title: string): string {
  const a = artist.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  if (!a && !t) return "";
  return `${a}::${t}`;
}

export function spokenFactIdsFor(artist: string, title: string): string[] {
  const key = memoryKey(artist, title);
  if (!key) return [];
  return [...(sessionFacts.get(key) ?? [])];
}

export function rememberSpokenFacts(
  artist: string,
  title: string,
  ids: readonly string[],
): void {
  const key = memoryKey(artist, title);
  if (!key) return;
  const bucket = sessionFacts.get(key) ?? new Set<string>();
  for (const id of ids) {
    const clean = id.trim();
    if (!clean) continue;
    bucket.add(clean);
    if (bucket.size >= MAX_REMEMBERED) break;
  }
  sessionFacts.set(key, bucket);
}

export function clearSpokenFacts(): void {
  sessionFacts.clear();
}
