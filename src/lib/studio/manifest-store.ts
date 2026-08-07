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
  uploadR2Buffer,
} from "@/lib/storage/r2";

const localManifestStore = new Map<string, StudioStationManifest>();

export function getLocalManifest(
  id: string,
): StudioStationManifest | undefined {
  return localManifestStore.get(id);
}

export function setLocalManifest(manifest: StudioStationManifest): void {
  localManifestStore.set(manifest.id, manifest);
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
    if (!data?.id || !Array.isArray(data.tracks)) return null;
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
