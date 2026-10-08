/**
 * What this station has already said, and any promise the host still owes.
 * Kept in memory for this process. The browser also sends the same list back,
 * because a later request may land on a different server.
 *
 * Fact ids, connector phrases, and the last few fact types travel in that
 * list with a prefix, so one round-trip carries the whole memory.
 */

import type { FactTopic } from "./claims";

export type OpenTease = {
  songTitle: string;
  artist: string;
  claimId: string;
  claim: string;
};

export type StationLedger = {
  claimIds: string[];
  factKeys: string[];
  connectors: string[];
  shapes: string[];
  rotation: string[];
  topics: FactTopic[];
  tease: OpenTease | null;
};

const EMPTY: StationLedger = {
  claimIds: [],
  factKeys: [],
  connectors: [],
  shapes: [],
  rotation: [],
  topics: [],
  tease: null,
};

const ledgers = new Map<string, StationLedger>();

export function stationMemoryKey(stationId?: string, stationName?: string): string {
  const id = stationId?.trim() || stationName?.trim() || "";
  return id.toLowerCase();
}

export function readStationMemory(key: string): StationLedger {
  if (!key) return { ...EMPTY, claimIds: [], factKeys: [], connectors: [], shapes: [], rotation: [], topics: [] };
  const found = ledgers.get(key);
  if (!found) return { ...EMPTY, claimIds: [], factKeys: [], connectors: [], shapes: [], rotation: [], topics: [] };
  return { ...found, shapes: found.shapes ?? [] };
}

export function writeStationMemory(key: string, ledger: StationLedger): void {
  if (!key) return;
  ledgers.set(key, {
    claimIds: ledger.claimIds.slice(0, 80),
    factKeys: ledger.factKeys.slice(0, 80),
    connectors: ledger.connectors.slice(0, 40),
    shapes: (ledger.shapes ?? []).slice(0, 80),
    rotation: ledger.rotation.slice(-12),
    topics: ledger.topics.slice(0, 24),
    tease: ledger.tease,
  });
}

export function clearStationMemory(): void {
  ledgers.clear();
}

/** Split the list the browser sends back into facts, glue, and recent types. */
export function parseStationIds(ids: readonly string[]): {
  claimIds: string[];
  factKeys: string[];
  connectors: string[];
  shapes: string[];
  rotation: string[];
} {
  const claimIds: string[] = [];
  const factKeys: string[] = [];
  const connectors: string[] = [];
  const shapes: string[] = [];
  const rotation: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    if (id.startsWith("fact:")) factKeys.push(id.slice(5));
    else if (id.startsWith("conn:")) connectors.push(id.slice(5));
    else if (id.startsWith("shape:")) shapes.push(id.slice(6));
    else if (id.startsWith("rot:")) rotation.push(id.slice(4));
    else claimIds.push(id);
  }
  return { claimIds, factKeys, connectors, shapes, rotation };
}

/** One list for the browser. Prefixes keep facts, glue, and types apart. */
export function packStationIds(input: {
  claimIds: readonly string[];
  factKeys: readonly string[];
  connectors: readonly string[];
  shapes: readonly string[];
  rotation: readonly string[];
}): string[] {
  return [
    ...input.claimIds,
    ...input.factKeys.map((key) => `fact:${key}`),
    ...input.connectors.map((key) => `conn:${key}`),
    ...input.shapes.map((key) => `shape:${key}`),
    ...input.rotation.map((key) => `rot:${key}`),
  ].slice(0, 240);
}
