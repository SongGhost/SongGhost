"use client";

import { useCallback, useEffect, useState } from "react";
import {
  shelfItemFromManifest,
  type StudioMixShelfItem,
  type StudioStationManifest,
} from "@/lib/studio/manifest";

const STORAGE_KEY = "songhost_studio_mixes";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readShelf(): StudioMixShelfItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StudioMixShelfItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as StudioMixShelfItem).id === "string" &&
        typeof (item as StudioMixShelfItem).name === "string",
    );
  } catch {
    return [];
  }
}

function writeShelf(items: StudioMixShelfItem[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/**
 * Tracks SongHost Studio mixes the listener created or saved locally,
 * backed by `localStorage` under `songhost_studio_mixes`.
 */
export function useStudioStations() {
  const [mixes, setMixes] = useState<StudioMixShelfItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMixes(readShelf());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: StudioMixShelfItem[]) => {
    setMixes(next);
    writeShelf(next);
  }, []);

  const saveStudioMix = useCallback(
    (manifest: StudioStationManifest) => {
      const item = shelfItemFromManifest(manifest);
      const without = readShelf().filter((entry) => entry.id !== item.id);
      persist([item, ...without]);
      return item;
    },
    [persist],
  );

  const removeStudioMix = useCallback(
    (id: string) => {
      persist(readShelf().filter((entry) => entry.id !== id));
    },
    [persist],
  );

  const getStudioMix = useCallback((id: string): StudioMixShelfItem | undefined => {
    return readShelf().find((entry) => entry.id === id);
  }, []);

  return {
    mixes,
    hydrated,
    saveStudioMix,
    removeStudioMix,
    getStudioMix,
  };
}
