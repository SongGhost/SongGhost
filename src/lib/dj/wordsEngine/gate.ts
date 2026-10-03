/**
 * Reject a New script that invents a proper noun, runs long, or breaks Clean Mode.
 * A failed script is discarded. The caller speaks the short true draft instead.
 */

import type { FactPack } from "./types";

const GLUE = new Set([
  "a", "an", "and", "at", "back", "by", "came", "for", "from", "heard", "here",
  "hold", "in", "is", "it", "just", "listen", "moment", "next", "now", "of",
  "on", "one", "onto", "out", "produced", "recorded", "that", "the", "this",
  "to", "up", "was", "with", "worth", "you", "your", "ear",
]);

const PROFANITY = /\b(?:fuck|fucking|shit|bitch|asshole)\b/i;

export function wordCeiling(pack: Pick<FactPack, "depth" | "shape" | "nuggets" | "recapLines">): number {
  if (pack.shape === "song_id" || pack.shape === "stinger") return 18;
  if (pack.shape === "recap") return Math.max(24, 12 + pack.recapLines.length * 10);
  if (pack.shape === "teaser") return 36;
  const count = pack.nuggets.length;
  if (count === 0 || pack.depth === "standard") return 32;
  if (pack.depth === "roots_branches") return 48;
  if (pack.depth === "time_capsule") return 36 + 18 * count;
  return Math.min(120, 36 + 22 * count);
}

export function wordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeToken(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "").toLowerCase();
}

function packTokens(pack: FactPack): Set<string> {
  const blob = [
    pack.now.title,
    pack.now.artist,
    pack.previous?.title,
    pack.previous?.artist,
    pack.stationName,
    ...pack.recapLines,
    ...pack.nuggets.map((nugget) => nugget.sentence),
  ]
    .filter(Boolean)
    .join(" ");

  const allowed = new Set<string>(GLUE);
  for (const piece of blob.split(/[\s/]+/)) {
    const key = normalizeToken(piece);
    if (!key) continue;
    allowed.add(key);
    allowed.add(key.replace(/'/g, ""));
    for (const part of key.split("-")) {
      if (part) allowed.add(part);
    }
  }
  return allowed;
}

function yearsIn(script: string): string[] {
  return script.match(/\b(?:1[5-9]\d{2}|20\d{2})\b/g) ?? [];
}

export function scriptPassesGate(script: string, pack: FactPack): boolean {
  const text = script.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (wordCount(text) > wordCeiling(pack)) return false;
  if (!pack.allowExplicit && PROFANITY.test(text)) return false;

  const allowedYears = new Set(pack.allowedYears.map(String));
  for (const year of yearsIn(text)) {
    if (!allowedYears.has(year)) return false;
  }

  const allowed = packTokens(pack);
  for (const raw of text.split(/\s+/)) {
    const key = normalizeToken(raw);
    if (!key) continue;
    if (allowed.has(key) || allowed.has(key.replace(/'/g, ""))) continue;
    if (/\d/.test(key)) continue;
    return false;
  }
  return true;
}
