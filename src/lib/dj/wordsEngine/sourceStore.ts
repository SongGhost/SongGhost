/**
 * The source pack for one song, kept on disk.
 * The in-memory sheet dies when the server restarts. This file does not.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SheetClaim } from "./claims";
import type { SourcePassage } from "./types";

const VERSION = 1;

type SavedPack = {
  version: number;
  artist: string;
  title: string;
  claims: SheetClaim[];
  passages: SourcePassage[];
};

function packDir(): string {
  return join(process.cwd(), "data", "dj-source-packs");
}

function packFile(artist: string, title: string): string {
  const key = `${artist} ${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140);
  return join(packDir(), `${key || "song"}.json`);
}

export function readSourcePack(artist: string, title: string): { claims: SheetClaim[]; passages: SourcePassage[] } | null {
  try {
    const raw = readFileSync(packFile(artist, title), "utf8");
    const parsed = JSON.parse(raw) as SavedPack;
    if (parsed.version !== VERSION) return null;
    if (!Array.isArray(parsed.claims) || !Array.isArray(parsed.passages)) return null;
    return { claims: parsed.claims, passages: parsed.passages };
  } catch {
    return null;
  }
}

export function writeSourcePack(artist: string, title: string, claims: SheetClaim[], passages: SourcePassage[]): void {
  if (!artist.trim() || !title.trim()) return;
  if (claims.length === 0 && passages.length === 0) return;
  const body: SavedPack = {
    version: VERSION,
    artist: artist.trim(),
    title: title.trim(),
    claims,
    passages,
  };
  mkdirSync(packDir(), { recursive: true });
  writeFileSync(packFile(artist, title), JSON.stringify(body));
}
