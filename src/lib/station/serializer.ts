/**
 * Station permalink serializer — packs a shareable station snapshot into a
 * URL-safe Base64 `?preset=` token and unpacks it back into a StationConfig.
 *
 * Compact keys and a short version header keep tokens short enough for QR codes
 * and mobile share sheets. Album sleeves are included when they fit; oversized
 * deep-dive metadata is trimmed rather than blowing past the URL budget.
 */

import type { PersonaId } from "@/data/personas";
import {
  hasVoiceProfileOverride,
  isChatterPacing,
  isEraLock,
  isStationMode,
  normalizeAlbumContext,
  normalizeStationConfig,
  normalizeVoiceProfileOverride,
  sanitizeVibePrompt,
  type AlbumContext,
  type ChatterPacing,
  type EraLock,
  type StationConfig,
  type StationMode,
  type VoiceProfileOverride,
} from "@/types/station";

/** Query-string key the app hydrates from on load. */
export const STATION_PRESET_PARAM = "preset";

/** Wire format version — bump only when the compact schema becomes incompatible. */
export const STATION_PRESET_VERSION = 1 as const;

/**
 * Soft ceiling for the encoded token. Past this, QR codes get dense and some
 * messengers truncate the URL — trim the sleeve before giving up.
 */
export const MAX_PRESET_TOKEN_LENGTH = 1800;

export type ShareableStationInput = {
  stationId: string;
  /** Display name already resolved (override or station default) */
  name?: string;
  frequency?: number;
  hostPersonaId?: PersonaId | null;
  chatterPacing?: ChatterPacing | null;
  eraLock?: EraLock;
  vibePrompt?: string;
  mode?: StationMode;
  albumContext?: AlbumContext | null;
  voiceProfile?: VoiceProfileOverride | null;
};

/**
 * Compact on-the-wire shape. Short keys are deliberate — every character lands
 * in the share URL twice once QR-encoded.
 */
export type CompactStationPreset = {
  v: typeof STATION_PRESET_VERSION;
  id: string;
  n?: string;
  f?: number;
  h?: string;
  c?: ChatterPacing;
  e?: EraLock;
  vibe?: string;
  m?: StationMode;
  a?: CompactAlbumPreset;
  vp?: CompactVoiceProfile;
};

type CompactAlbumPreset = {
  t: string;
  ar: string;
  y?: number;
  s?: string;
  p?: string;
  l?: string;
  pe?: { n: string; r: string }[];
  tr: { t: string; s?: string; d?: number; n?: string }[];
};

type CompactVoiceProfile = {
  en?: VoiceProfileOverride["energy"];
  ac?: VoiceProfileOverride["accent"];
  sn?: VoiceProfileOverride["snark"];
  pa?: VoiceProfileOverride["pacing"];
};

export type DecodeStationPresetResult =
  | { ok: true; stationId: string; config: StationConfig; compact: CompactStationPreset }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * URL-safe Base64
 * ------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(token: string): Uint8Array | null {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);

  try {
    const binary =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** UTF-8 JSON → URL-safe Base64 (no padding). */
export function encodeBase64UrlJson(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64Url(bytes);
}

/** Inverse of `encodeBase64UrlJson`. Returns null on corrupt input. */
export function decodeBase64UrlJson(token: string): unknown | null {
  if (typeof token !== "string" || !token.trim()) return null;
  const bytes = base64UrlToBytes(token.trim());
  if (!bytes) return null;
  try {
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Compact encode / expand
 * ------------------------------------------------------------------ */

function compactVoiceProfile(
  profile: VoiceProfileOverride | null | undefined,
): CompactVoiceProfile | undefined {
  const normalized = normalizeVoiceProfileOverride(profile);
  if (!normalized) return undefined;
  const out: CompactVoiceProfile = {};
  if (normalized.energy) out.en = normalized.energy;
  if (normalized.accent) out.ac = normalized.accent;
  if (normalized.snark) out.sn = normalized.snark;
  if (normalized.pacing) out.pa = normalized.pacing;
  return out;
}

function expandVoiceProfile(value: unknown): VoiceProfileOverride | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const compact = value as CompactVoiceProfile;
  return normalizeVoiceProfileOverride({
    energy: compact.en,
    accent: compact.ac,
    snark: compact.sn,
    pacing: compact.pa,
  });
}

function compactAlbum(
  album: AlbumContext,
  options: { includeNotes: boolean; includePersonnel: boolean },
): CompactAlbumPreset {
  const out: CompactAlbumPreset = {
    t: album.albumTitle,
    ar: album.artist,
    tr: album.trackList.map((track) => {
      const entry: CompactAlbumPreset["tr"][number] = { t: track.title };
      if (track.side) entry.s = track.side;
      if (typeof track.durationSeconds === "number") entry.d = track.durationSeconds;
      if (options.includeNotes && track.note) entry.n = track.note;
      return entry;
    }),
  };

  if (typeof album.releaseYear === "number") out.y = album.releaseYear;
  if (album.recordingStudio) out.s = album.recordingStudio;
  if (album.producer) out.p = album.producer;
  if (album.label) out.l = album.label;

  if (options.includePersonnel && album.personnel.length > 0) {
    out.pe = album.personnel.map((credit) => ({ n: credit.name, r: credit.role }));
  }

  return out;
}

function expandAlbum(value: unknown): AlbumContext | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const compact = value as CompactAlbumPreset;
  return (
    normalizeAlbumContext({
      albumTitle: compact.t,
      artist: compact.ar,
      releaseYear: compact.y,
      recordingStudio: compact.s,
      producer: compact.p,
      label: compact.l,
      personnel: Array.isArray(compact.pe)
        ? compact.pe.map((credit) => ({ name: credit.n, role: credit.r }))
        : [],
      trackList: Array.isArray(compact.tr)
        ? compact.tr.map((track, index) => ({
            position: index + 1,
            title: track.t,
            side: track.s,
            durationSeconds: track.d,
            note: track.n,
          }))
        : [],
    }) ?? undefined
  );
}

/**
 * Fold resolved settings into the compact wire shape. Omits fields that match
 * "no override" so a bare station id stays a short token.
 */
export function toCompactStationPreset(input: ShareableStationInput): CompactStationPreset {
  const stationId = input.stationId.trim();
  const compact: CompactStationPreset = {
    v: STATION_PRESET_VERSION,
    id: stationId,
  };

  const name = typeof input.name === "string" ? input.name.trim().slice(0, 40) : "";
  if (name) compact.n = name;

  if (typeof input.frequency === "number" && Number.isFinite(input.frequency) && input.frequency > 0) {
    compact.f = Math.round(input.frequency * 10) / 10;
  }

  if (typeof input.hostPersonaId === "string" && input.hostPersonaId.trim()) {
    compact.h = input.hostPersonaId;
  }

  if (isChatterPacing(input.chatterPacing)) compact.c = input.chatterPacing;
  if (isEraLock(input.eraLock) && input.eraLock !== "all") compact.e = input.eraLock;

  const vibe = sanitizeVibePrompt(input.vibePrompt);
  if (vibe) compact.vibe = vibe;

  if (isStationMode(input.mode) && input.mode !== "standard") compact.m = input.mode;

  const album = normalizeAlbumContext(input.albumContext);
  if (album) {
    compact.a = compactAlbum(album, { includeNotes: true, includePersonnel: true });
  }

  const voice = compactVoiceProfile(input.voiceProfile);
  if (voice) compact.vp = voice;

  return compact;
}

/**
 * Expand a compact preset into a normalized StationConfig ready for
 * `setStationConfig` / `resolveStationSettings`.
 */
export function fromCompactStationPreset(compact: CompactStationPreset): StationConfig {
  return normalizeStationConfig(compact.id, {
    name: compact.n,
    frequency: compact.f,
    hostPersonaId: typeof compact.h === "string" ? (compact.h as PersonaId) : undefined,
    chatterPacing: compact.c,
    eraLock: compact.e,
    vibePrompt: compact.vibe,
    mode: compact.m,
    albumContext: expandAlbum(compact.a),
    voiceProfile: expandVoiceProfile(compact.vp),
  });
}

function isCompactStationPreset(value: unknown): value is CompactStationPreset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompactStationPreset>;
  return (
    candidate.v === STATION_PRESET_VERSION &&
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0
  );
}

/**
 * Shrink a deep-dive sleeve until the token fits the share budget.
 *
 * Order of cuts: track notes → personnel → sleeve itself. A rotation station
 * with no album is never trimmed; a deep dive that still won't fit loses the
 * sleeve and degrades to standard mode on the receiving end.
 */
function fitCompactPreset(compact: CompactStationPreset): CompactStationPreset {
  let candidate = compact;
  if (encodeBase64UrlJson(candidate).length <= MAX_PRESET_TOKEN_LENGTH) {
    return candidate;
  }

  if (candidate.a) {
    const album = expandAlbum(candidate.a);
    if (album) {
      candidate = {
        ...candidate,
        a: compactAlbum(album, { includeNotes: false, includePersonnel: true }),
      };
      if (encodeBase64UrlJson(candidate).length <= MAX_PRESET_TOKEN_LENGTH) {
        return candidate;
      }

      candidate = {
        ...candidate,
        a: compactAlbum(album, { includeNotes: false, includePersonnel: false }),
      };
      if (encodeBase64UrlJson(candidate).length <= MAX_PRESET_TOKEN_LENGTH) {
        return candidate;
      }
    }

    const { a, m, ...withoutAlbum } = candidate;
    void a;
    // A deep-dive flag with no sleeve is meaningless on the far side.
    candidate = m === "album_deep_dive" ? withoutAlbum : { ...withoutAlbum, m };
  }

  return candidate;
}

/** Encode a station snapshot into a URL-safe `preset` token. */
export function serializeStationPreset(input: ShareableStationInput): string {
  const stationId = input.stationId?.trim();
  if (!stationId) {
    throw new Error("Cannot share a station without an id");
  }

  const compact = fitCompactPreset(toCompactStationPreset({ ...input, stationId }));
  return encodeBase64UrlJson(compact);
}

/** Decode a `preset` token back into a StationConfig. */
export function deserializeStationPreset(token: string): DecodeStationPresetResult {
  const parsed = decodeBase64UrlJson(token);
  if (!isCompactStationPreset(parsed)) {
    return { ok: false, error: "Invalid or unsupported station preset" };
  }

  const config = fromCompactStationPreset(parsed);
  return { ok: true, stationId: config.stationId, config, compact: parsed };
}

/**
 * Build a shareable absolute URL for the given snapshot.
 *
 * `baseUrl` may be an origin (`https://app.example`) or a full page URL; the
 * `preset` query param is written onto it and any prior `preset` is replaced.
 */
export function buildStationShareUrl(baseUrl: string, input: ShareableStationInput): string {
  const url = new URL(baseUrl, "http://localhost");
  url.searchParams.set(STATION_PRESET_PARAM, serializeStationPreset(input));
  // Drop the synthetic origin when the caller handed us a relative path.
  if (baseUrl.startsWith("/") || baseUrl.startsWith("?")) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}

/** Pull a preset token out of the current (or supplied) search string. */
export function readPresetTokenFromSearch(search: string): string | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const token = params.get(STATION_PRESET_PARAM);
  return token && token.trim() ? token.trim() : null;
}

/** Strip the preset param so a refresh does not re-apply the same share. */
export function stripPresetFromUrl(href: string): string {
  const url = new URL(href, "http://localhost");
  url.searchParams.delete(STATION_PRESET_PARAM);
  const search = url.searchParams.toString();
  const path = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return `${url.origin}${path}`;
  }
  return path;
}

/** Human-readable rows for the share modal's configuration summary. */
export function summarizeShareableStation(input: ShareableStationInput): {
  label: string;
  value: string;
}[] {
  const rows: { label: string; value: string }[] = [];

  if (input.name?.trim()) rows.push({ label: "Station", value: input.name.trim() });
  if (typeof input.frequency === "number" && input.frequency > 0) {
    rows.push({ label: "Frequency", value: `${input.frequency.toFixed(1)} FM` });
  }
  if (input.hostPersonaId) rows.push({ label: "Host", value: String(input.hostPersonaId) });
  if (isChatterPacing(input.chatterPacing)) {
    rows.push({ label: "Chatter", value: input.chatterPacing.replace(/_/g, " ") });
  }
  if (isEraLock(input.eraLock) && input.eraLock !== "all") {
    rows.push({ label: "Era", value: input.eraLock });
  }
  if (isStationMode(input.mode) && input.mode !== "standard") {
    rows.push({ label: "Mode", value: "Album deep dive" });
  }
  const vibe = sanitizeVibePrompt(input.vibePrompt);
  if (vibe) rows.push({ label: "Vibe", value: vibe });

  const album = normalizeAlbumContext(input.albumContext);
  if (album) {
    rows.push({
      label: "Album",
      value: album.releaseYear
        ? `${album.albumTitle} — ${album.artist} (${album.releaseYear})`
        : `${album.albumTitle} — ${album.artist}`,
    });
  }

  const voice = normalizeVoiceProfileOverride(input.voiceProfile);
  if (voice && hasVoiceProfileOverride(voice)) {
    const parts = [
      voice.energy ? `energy ${voice.energy}` : null,
      voice.accent && voice.accent !== "neutral" ? `accent ${voice.accent}` : null,
      voice.snark && voice.snark !== "none" ? `snark ${voice.snark}` : null,
      voice.pacing && voice.pacing !== "natural" ? `pacing ${voice.pacing}` : null,
    ].filter(Boolean);
    if (parts.length) rows.push({ label: "Voice", value: parts.join(" · ") });
  }

  return rows;
}
