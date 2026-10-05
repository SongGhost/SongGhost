/**
 * What this station has already said, and any promise the host still owes.
 * Kept in memory for this process. The browser also sends the same list back,
 * because a later request may land on a different server.
 */

import type { FactTopic } from "./claims";

export type OpenTease = {
  songTitle: string;
  artist: string;
  claimId: string;
  claim: string;
};

type Ledger = {
  claimIds: string[];
  topics: FactTopic[];
  tease: OpenTease | null;
};

const ledgers = new Map<string, Ledger>();

export function stationMemoryKey(stationId?: string, stationName?: string): string {
  const id = stationId?.trim() || stationName?.trim() || "";
  return id.toLowerCase();
}

export function readStationMemory(key: string): Ledger {
  if (!key) return { claimIds: [], topics: [], tease: null };
  return ledgers.get(key) ?? { claimIds: [], topics: [], tease: null };
}

export function writeStationMemory(key: string, ledger: Ledger): void {
  if (!key) return;
  ledgers.set(key, {
    claimIds: ledger.claimIds.slice(0, 80),
    topics: ledger.topics.slice(0, 24),
    tease: ledger.tease,
  });
}

export function clearStationMemory(): void {
  ledgers.clear();
}
