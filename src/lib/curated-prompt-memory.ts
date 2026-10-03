/**
 * Songs already used for one AI prompt.
 * The browser remembers them for the tab. The server remembers them for this
 * process, so a repeat on a warm instance still sees the last list.
 */

import {
  curatedSongKey,
  type CuratedSongRef,
} from "@/lib/curate-playlist";

const MAX_REMEMBERED = 75;
const STORAGE_PREFIX = "songhost-ai-list:";

const memory = new Map<string, CuratedSongRef[]>();

export function promptMemoryKey(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

export function mergeCuratedTitles(
  existing: readonly CuratedSongRef[],
  incoming: readonly CuratedSongRef[],
): CuratedSongRef[] {
  const seen = new Set<string>();
  const out: CuratedSongRef[] = [];
  for (const song of [...existing, ...incoming]) {
    const title = song?.title?.trim() ?? "";
    const artist = song?.artist?.trim() ?? "";
    if (!title || !artist) continue;
    const key = curatedSongKey({ title, artist });
    if (!key || key === "::" || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, artist });
  }
  return out.slice(-MAX_REMEMBERED);
}

export function recallCuratedTitles(prompt: string): CuratedSongRef[] {
  return [...(memory.get(promptMemoryKey(prompt)) ?? [])];
}

export function rememberCuratedTitles(
  prompt: string,
  titles: readonly CuratedSongRef[],
): CuratedSongRef[] {
  const key = promptMemoryKey(prompt);
  const merged = mergeCuratedTitles(memory.get(key) ?? [], titles);
  memory.set(key, merged);
  return merged;
}

export function clearCuratedPromptMemory(): void {
  memory.clear();
}

export function readStoredCuratedTitles(prompt: string): CuratedSongRef[] {
  if (typeof window === "undefined" || !window.sessionStorage) return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + promptMemoryKey(prompt));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return mergeCuratedTitles([], Array.isArray(parsed) ? (parsed as CuratedSongRef[]) : []);
  } catch {
    return [];
  }
}

export function storeCuratedTitles(prompt: string, titles: readonly CuratedSongRef[]): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const merged = mergeCuratedTitles(readStoredCuratedTitles(prompt), titles);
    window.sessionStorage.setItem(
      STORAGE_PREFIX + promptMemoryKey(prompt),
      JSON.stringify(merged),
    );
  } catch {
    // Private browsing can refuse storage. The request still sends whatever we had.
  }
}
