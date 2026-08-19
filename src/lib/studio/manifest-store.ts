/**
 * Shared in-process studio manifest cache + CDN load/save helpers.
 * Used by save-station and upload-voicemail so local/dev stays consistent.
 */

import { DEFAULT_PERSONA } from "@/data/personas";
import { getPhase5Env } from "@/lib/env";
import {
  normalizeStudioDjConfig,
  type StudioStationManifest,
} from "@/lib/studio/manifest";
import {
  audioBufferToDataUrl,
  isR2Configured,
  STUDIO_STATIONS_PREFIX,
  STUDIO_USER_INDEX_PREFIX,
  uploadR2Buffer,
} from "@/lib/storage/r2";

const localManifestStore = new Map<string, StudioStationManifest>();
/** In-process per-user authored station id lists (dev / warm cache). */
const localUserIndex = new Map<string, string[]>();

export type StudioUserIndex = {
  userId: string;
  stationIds: string[];
  updatedAt: string;
};

export function getLocalManifest(
  id: string,
): StudioStationManifest | undefined {
  return localManifestStore.get(id);
}

export function setLocalManifest(manifest: StudioStationManifest): void {
  localManifestStore.set(manifest.id, manifest);
}

function userIndexKey(userId: string): string {
  return `${STUDIO_USER_INDEX_PREFIX}/${encodeURIComponent(userId)}.json`;
}

export async function fetchManifestFromCdn(
  id: string,
): Promise<StudioStationManifest | null> {
  const { NEXT_PUBLIC_R2_CDN_URL } = getPhase5Env();
  if (!NEXT_PUBLIC_R2_CDN_URL?.trim()) return null;

  const url = `${NEXT_PUBLIC_R2_CDN_URL.replace(/\/$/, "")}/${STUDIO_STATIONS_PREFIX}/${encodeURIComponent(id)}.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as StudioStationManifest;
    if (!data?.id) return null;
    return data;
  } catch {
    return null;
  }
}

/** Local store first, then R2 CDN. */
export async function loadStudioManifest(
  id: string,
): Promise<StudioStationManifest | null> {
  const local = getLocalManifest(id);
  if (local) return local;

  if (!isR2Configured()) return null;

  const remote = await fetchManifestFromCdn(id);
  if (!remote) return null;

  const manifest: StudioStationManifest = {
    ...remote,
    djConfig: normalizeStudioDjConfig(remote.djConfig, DEFAULT_PERSONA.id),
  };
  setLocalManifest(manifest);
  return manifest;
}

/** Persist manifest to R2 (or data-URL fallback) and refresh the local cache. */
export async function persistStudioManifest(
  manifest: StudioStationManifest,
): Promise<{ url: string; key: string }> {
  const key = `${STUDIO_STATIONS_PREFIX}/${manifest.id}.json`;
  const payload = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

  let url: string;
  if (isR2Configured()) {
    url = await uploadR2Buffer(key, payload, "application/json");
  } else {
    console.warn(
      "[studio/manifest-store] R2 unconfigured — storing in-process + data URL",
    );
    url = audioBufferToDataUrl(payload, "application/json");
  }

  setLocalManifest(manifest);
  return { url, key };
}

async function fetchUserIndexFromCdn(
  userId: string,
): Promise<StudioUserIndex | null> {
  const { NEXT_PUBLIC_R2_CDN_URL } = getPhase5Env();
  if (!NEXT_PUBLIC_R2_CDN_URL?.trim()) return null;

  const url = `${NEXT_PUBLIC_R2_CDN_URL.replace(/\/$/, "")}/${userIndexKey(userId)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as StudioUserIndex;
    if (!data || !Array.isArray(data.stationIds)) return null;
    return {
      userId,
      stationIds: data.stationIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      ),
      updatedAt:
        typeof data.updatedAt === "string"
          ? data.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Record a published station under the author's account index. */
export async function indexStudioManifestForUser(
  userId: string,
  stationId: string,
): Promise<void> {
  const trimmedUser = userId.trim();
  const trimmedStation = stationId.trim();
  if (!trimmedUser || !trimmedStation) return;

  const existing =
    localUserIndex.get(trimmedUser) ??
    (await fetchUserIndexFromCdn(trimmedUser))?.stationIds ??
    [];
  const stationIds = [
    trimmedStation,
    ...existing.filter((id) => id !== trimmedStation),
  ];
  localUserIndex.set(trimmedUser, stationIds);

  const index: StudioUserIndex = {
    userId: trimmedUser,
    stationIds,
    updatedAt: new Date().toISOString(),
  };
  const key = userIndexKey(trimmedUser);
  const payload = Buffer.from(JSON.stringify(index, null, 2), "utf8");

  if (isR2Configured()) {
    await uploadR2Buffer(key, payload, "application/json");
  }
}

/** Load every authored studio mix for a signed-in account. */
export async function loadStudioManifestsForUser(
  userId: string,
): Promise<StudioStationManifest[]> {
  const trimmedUser = userId.trim();
  if (!trimmedUser) return [];

  const stationIds = [
    ...(localUserIndex.get(trimmedUser) ??
      (await fetchUserIndexFromCdn(trimmedUser))?.stationIds ??
      []),
  ];

  // Also surface in-process manifests authored by this user that may not yet
  // be indexed on CDN (local/dev publish path).
  for (const manifest of localManifestStore.values()) {
    if (
      manifest.authorUserId === trimmedUser &&
      !stationIds.includes(manifest.id)
    ) {
      stationIds.push(manifest.id);
    }
  }
  localUserIndex.set(trimmedUser, stationIds);

  const manifests: StudioStationManifest[] = [];
  for (const id of stationIds) {
    const manifest = await loadStudioManifest(id);
    if (manifest) manifests.push(manifest);
  }
  return manifests;
}
