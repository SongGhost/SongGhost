/**
 * Facts already chosen for a song in this browser session.
 * Longer memory stays on the Classic lore ledger. New nuggets are not
 * rows in that ledger, so they are not written there.
 */

const sessionFacts = new Map<string, Set<string>>();
const MAX_REMEMBERED = 40;

export type StationSpeechMemory = {
  claimIds: string[];
  topics: string[];
  tease: {
    songTitle: string;
    artist: string;
    claimId: string;
    claim: string;
  } | null;
};

const stationSpeech = new Map<string, StationSpeechMemory>();

function stationKey(stationId?: string, stationName?: string): string {
  return (stationId?.trim() || stationName?.trim() || "").toLowerCase();
}

export function stationSpeechFor(stationId?: string, stationName?: string): StationSpeechMemory {
  const key = stationKey(stationId, stationName);
  if (!key) return { claimIds: [], topics: [], tease: null };
  return stationSpeech.get(key) ?? { claimIds: [], topics: [], tease: null };
}

export function rememberStationSpeech(
  stationId: string | undefined,
  stationName: string | undefined,
  memory: StationSpeechMemory,
): void {
  const key = stationKey(stationId, stationName);
  if (!key) return;
  stationSpeech.set(key, memory);
}

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
  stationSpeech.clear();
}
