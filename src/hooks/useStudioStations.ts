"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  shelfItemFromManifest,
  type StudioMixShelfItem,
  type StudioStationManifest,
} from "@/lib/studio/manifest";

const LEGACY_STORAGE_KEY = "songhost_studio_mixes";

function studioMixesStorageKey(userId: string | null | undefined): string {
  return userId?.trim()
    ? `songhost_studio_mixes_${userId.trim()}`
    : "songhost_studio_mixes_guest";
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readShelf(userId: string | null | undefined): StudioMixShelfItem[] {
  if (!isBrowser()) return [];
  try {
    const key = studioMixesStorageKey(userId);
    let raw = localStorage.getItem(key);
    if (!raw && !userId?.trim()) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(key, raw);
      }
    } else if (!raw && userId?.trim()) {
      // Migrate guest/legacy shelf into the signed-in account once.
      const legacy =
        localStorage.getItem(LEGACY_STORAGE_KEY) ??
        localStorage.getItem("songhost_studio_mixes_guest");
      if (legacy) {
        localStorage.setItem(key, legacy);
        raw = legacy;
      }
    }
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

function writeShelf(
  userId: string | null | undefined,
  items: StudioMixShelfItem[],
): void {
  if (!isBrowser()) return;
  localStorage.setItem(studioMixesStorageKey(userId), JSON.stringify(items));
}

function mergeMixes(
  local: StudioMixShelfItem[],
  remote: StudioMixShelfItem[],
): StudioMixShelfItem[] {
  const byId = new Map<string, StudioMixShelfItem>();
  for (const item of [...remote, ...local]) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const existingTime = Date.parse(existing.updatedAt) || 0;
    const nextTime = Date.parse(item.updatedAt) || 0;
    byId.set(item.id, nextTime >= existingTime ? item : existing);
  }
  return Array.from(byId.values()).sort(
    (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0),
  );
}

/**
 * Tracks SongHost Studio mixes the listener created or saved locally,
 * keyed by account under `songhost_studio_mixes_${userId}` with an
 * optional hydrate from GET `/api/studio/save-station?userId=`.
 */
export function useStudioStations() {
  const { userId, isLoaded } = useAuth();
  const [mixes, setMixes] = useState<StudioMixShelfItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  /** Account the current `mixes` snapshot belongs to — blocks cross-user writes. */
  const hydratedUserRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;
    setIsHydrated(false);
    hydratedUserRef.current = undefined;

    const local = readShelf(userId);
    setMixes(local);

    const finish = (items: StudioMixShelfItem[]) => {
      if (cancelled) return;
      hydratedUserRef.current = userId;
      setMixes(items);
      writeShelf(userId, items);
      setIsHydrated(true);
    };

    const hydrateRemote = async () => {
      if (!userId?.trim()) {
        finish(local);
        return;
      }

      try {
        const res = await fetch(
          `/api/studio/save-station?userId=${encodeURIComponent(userId)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as {
            mixes?: StudioStationManifest[];
            manifests?: StudioStationManifest[];
          };
          const manifests = data.mixes ?? data.manifests ?? [];
          const remote = manifests.map(shelfItemFromManifest);
          finish(mergeMixes(local, remote));
          return;
        }
      } catch (error) {
        console.warn("[SongGhost] studioMixesHydrateFailed", { error });
      }
      finish(local);
    };

    void hydrateRemote();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  useEffect(() => {
    if (!isHydrated) return;
    if (hydratedUserRef.current !== userId) return;
    writeShelf(userId, mixes);
  }, [mixes, isHydrated, userId]);

  const saveStudioMix = useCallback((manifest: StudioStationManifest) => {
    const item = shelfItemFromManifest(manifest);
    setMixes((prev) => [item, ...prev.filter((entry) => entry.id !== item.id)]);
    return item;
  }, []);

  const removeStudioMix = useCallback((id: string) => {
    setMixes((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const getStudioMix = useCallback(
    (id: string): StudioMixShelfItem | undefined => {
      return mixes.find((entry) => entry.id === id);
    },
    [mixes],
  );

  return {
    mixes,
    hydrated: isHydrated,
    isHydrated,
    saveStudioMix,
    removeStudioMix,
    getStudioMix,
  };
}
