import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolvePersonaId } from "@/data/personas";
import {
  db,
  getDb,
  userMemorySlots,
  users,
  userSavedStations,
} from "@/lib/db";
import { mergeSavedStationLists } from "@/lib/station/saved-playlists";
import {
  createEmptyMemoryPresets,
  MEMORY_PRESET_COUNT,
  normalizeMemoryPresets,
  normalizeStationConfig,
  type MemoryPreset,
  type MemoryPresetList,
  type StationConfig,
  type StationConfigMap,
} from "@/types/station";
import type { StationDefinition } from "@/types/user";
import { readBlueprintSeeds } from "@/lib/station/blueprint";
import {
  isUserSyncPostBodyValid,
  normalizeCloudPreferences,
  type CloudPreferencesPayload,
} from "@/lib/user/preferences";

export const dynamic = "force-dynamic";

/** Extras parked alongside a memory dial slot (columns hold id/name). */
type MemorySlotConfigJson = {
  frequency: number;
  accentColor: string;
  personaId?: string;
  savedAt: string;
  stationConfig?: StationConfig;
  seedArtists?: string[];
  seedGenres?: string[];
  eras?: string[];
  energyLevel?: number;
  catalogDepth?: number;
  vibePrompt?: string;
};

type SyncPostBody = {
  memoryPresets?: unknown;
  savedStations?: unknown;
  stationConfigs?: unknown;
  preferences?: unknown;
  marketingOptIn?: unknown;
};

function parseMarketingOptIn(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isDatabaseConfigured(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

function isStationDefinition(value: unknown): value is StationDefinition {
  if (typeof value !== "object" || value === null) return false;
  const station = value as Partial<StationDefinition>;
  return (
    typeof station.id === "string" &&
    station.id.trim().length > 0 &&
    typeof station.name === "string" &&
    station.name.trim().length > 0 &&
    (Array.isArray(station.tracks) || Array.isArray(station.seedArtists) || Array.isArray(station.seedGenres))
  );
}

function normalizeSavedStations(value: unknown): StationDefinition[] {
  if (!Array.isArray(value)) return [];
  const out: StationDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isStationDefinition(entry)) continue;
    const id = entry.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      ...entry,
      id,
      name: entry.name.trim(),
      tracks: Array.isArray(entry.tracks) ? entry.tracks : [],
    });
  }
  return out;
}

function normalizeStationConfigsInput(value: unknown): StationConfigMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: StationConfigMap = {};
  for (const [stationId, config] of Object.entries(value)) {
    if (!stationId.trim()) continue;
    if (typeof config !== "object" || config === null) continue;
    out[stationId] = normalizeStationConfig(
      stationId,
      config as Partial<StationConfig>,
    );
  }
  return out;
}

function parseMemorySlotConfig(value: unknown): Partial<MemorySlotConfigJson> {
  if (typeof value !== "object" || value === null) return {};
  return value as Partial<MemorySlotConfigJson>;
}

function memoryPresetFromRow(row: {
  slotIndex: number;
  stationId: string;
  stationName: string;
  stationConfig: unknown;
}): MemoryPreset | null {
  if (
    !Number.isInteger(row.slotIndex) ||
    row.slotIndex < 0 ||
    row.slotIndex >= MEMORY_PRESET_COUNT
  ) {
    return null;
  }
  if (!row.stationId.trim()) return null;

  const config = parseMemorySlotConfig(row.stationConfig);

  const preset: MemoryPreset = {
    slot: row.slotIndex + 1,
    stationId: row.stationId.trim(),
    stationName: row.stationName.trim() || "Saved Station",
    frequency: Number.isFinite(config.frequency) ? Number(config.frequency) : 0,
    accentColor:
      typeof config.accentColor === "string" && config.accentColor.trim()
        ? config.accentColor
        : "#C4882A",
    savedAt:
      typeof config.savedAt === "string" && config.savedAt.trim()
        ? config.savedAt
        : new Date(0).toISOString(),
  };
  if (typeof config.personaId === "string" && config.personaId.trim()) {
    preset.personaId = resolvePersonaId(config.personaId);
  }
  const profile = readBlueprintSeeds(config);
  if (Object.keys(profile).length) {
    preset.profile = profile;
  }
  return preset;
}

/**
 * Rebuild per-station overrides parked inside memory-slot JSON so the client can
 * rehydrate `stationConfigs` (host persona, pacing, vibe, …) on initial sync.
 */
function stationConfigFromMemorySlot(
  stationId: string,
  slotJson: unknown,
  presetPersonaId: MemoryPreset["personaId"],
): StationConfig | null {
  const config = parseMemorySlotConfig(slotJson);
  const nested =
    typeof config.stationConfig === "object" && config.stationConfig !== null
      ? config.stationConfig
      : undefined;

  const hasPersona =
    typeof presetPersonaId === "string" && presetPersonaId.trim().length > 0;
  if (!nested && !hasPersona) return null;

  return normalizeStationConfig(stationId, {
    ...nested,
    ...(hasPersona ? { hostPersonaId: presetPersonaId } : {}),
  });
}

function savedStationFromRow(row: {
  stationId: string;
  stationName: string;
  stationConfig: unknown;
}): StationDefinition | null {
  if (isStationDefinition(row.stationConfig)) {
    return {
      ...row.stationConfig,
      id: row.stationId.trim() || row.stationConfig.id,
      name: row.stationName.trim() || row.stationConfig.name,
    };
  }
  return null;
}

async function ensureUserRow(
  userId: string,
  marketingOptIn?: boolean,
): Promise<void> {
  const clerkUser = await currentUser();
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress?.trim() ||
    clerkUser?.emailAddresses?.[0]?.emailAddress?.trim() ||
    `${userId}@users.clerk`;

  await db
    .insert(users)
    .values({
      id: userId,
      email,
      ...(typeof marketingOptIn === "boolean"
        ? {
            marketingOptIn,
            marketingOptInAt: marketingOptIn ? new Date() : null,
          }
        : {}),
    })
    .onConflictDoNothing({ target: users.id });

  if (typeof marketingOptIn === "boolean") {
    await applyMarketingOptIn(userId, marketingOptIn);
  }
}

/**
 * Write marketing consent without clobbering an existing grant timestamp when
 * the boolean is unchanged. Stamp `now()` on grant (true) or when the value
 * actually changes. Leave the row alone if the client omitted the field.
 */
async function applyMarketingOptIn(
  userId: string,
  marketingOptIn: boolean,
): Promise<void> {
  const [row] = await db
    .select({
      marketingOptIn: users.marketingOptIn,
      marketingOptInAt: users.marketingOptInAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return;

  if (row.marketingOptIn === marketingOptIn) {
    if (marketingOptIn && !row.marketingOptInAt) {
      await db
        .update(users)
        .set({ marketingOptInAt: new Date() })
        .where(eq(users.id, userId));
    }
    return;
  }

  await db
    .update(users)
    .set({
      marketingOptIn,
      marketingOptInAt: new Date(),
    })
    .where(eq(users.id, userId));
}

async function readCloudState(userId: string): Promise<{
  memoryPresets: MemoryPresetList;
  savedStations: StationDefinition[];
  stationConfigs: StationConfigMap;
  preferences: CloudPreferencesPayload | null;
}> {
  const [slotRows, stationRows, userRows] = await Promise.all([
    db.select().from(userMemorySlots).where(eq(userMemorySlots.userId, userId)),
    db.select().from(userSavedStations).where(eq(userSavedStations.userId, userId)),
    db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ]);

  const memoryPresets = createEmptyMemoryPresets();
  const stationConfigs: StationConfigMap = {};
  for (const row of slotRows) {
    const preset = memoryPresetFromRow(row);
    if (!preset) continue;
    memoryPresets[row.slotIndex] = preset;

    const restored = stationConfigFromMemorySlot(
      preset.stationId,
      row.stationConfig,
      preset.personaId,
    );
    if (restored) {
      stationConfigs[preset.stationId] = normalizeStationConfig(preset.stationId, {
        ...stationConfigs[preset.stationId],
        ...restored,
      });
    }
  }

  const savedStations: StationDefinition[] = [];
  for (const row of stationRows) {
    const station = savedStationFromRow(row);
    if (station) savedStations.push(station);
  }

  const preferences = normalizeCloudPreferences(userRows[0]?.preferences);
  if (preferences?.stationConfigs) {
    for (const [stationId, config] of Object.entries(preferences.stationConfigs)) {
      if (!stationId.trim()) continue;
      stationConfigs[stationId] = normalizeStationConfig(stationId, {
        ...stationConfigs[stationId],
        ...config,
      });
    }
  }

  return {
    memoryPresets: normalizeMemoryPresets(memoryPresets),
    savedStations,
    stationConfigs,
    preferences,
  };
}

async function upsertCloudPreferences(
  userId: string,
  preferences: CloudPreferencesPayload,
): Promise<void> {
  await db
    .update(users)
    .set({ preferences })
    .where(eq(users.id, userId));
}

async function upsertMemoryPresets(
  userId: string,
  presets: MemoryPresetList,
  stationConfigs: StationConfigMap,
): Promise<void> {
  const normalized = normalizeMemoryPresets(presets);
  const now = new Date();
  const keptIndexes: number[] = [];

  for (let slotIndex = 0; slotIndex < MEMORY_PRESET_COUNT; slotIndex += 1) {
    const preset = normalized[slotIndex];
    if (!preset) continue;
    keptIndexes.push(slotIndex);

    const override = stationConfigs[preset.stationId];
    const profile = preset.profile;
    const stationConfig: MemorySlotConfigJson = {
      frequency: preset.frequency,
      accentColor: preset.accentColor,
      savedAt: preset.savedAt,
      ...(preset.personaId ? { personaId: preset.personaId } : {}),
      ...(override ? { stationConfig: override } : {}),
      ...(profile?.seedArtists ? { seedArtists: profile.seedArtists } : {}),
      ...(profile?.seedGenres ? { seedGenres: profile.seedGenres } : {}),
      ...(profile?.eras ? { eras: profile.eras } : {}),
      ...(typeof profile?.energyLevel === "number" ? { energyLevel: profile.energyLevel } : {}),
      ...(typeof profile?.catalogDepth === "number" ? { catalogDepth: profile.catalogDepth } : {}),
      ...(profile?.vibePrompt ? { vibePrompt: profile.vibePrompt } : {}),
    };

    await db
      .insert(userMemorySlots)
      .values({
        userId,
        slotIndex,
        stationId: preset.stationId,
        stationName: preset.stationName,
        stationConfig,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userMemorySlots.userId, userMemorySlots.slotIndex],
        set: {
          stationId: preset.stationId,
          stationName: preset.stationName,
          stationConfig,
          updatedAt: now,
        },
      });
  }

  if (keptIndexes.length === 0) {
    await db.delete(userMemorySlots).where(eq(userMemorySlots.userId, userId));
    return;
  }

  await db
    .delete(userMemorySlots)
    .where(
      and(
        eq(userMemorySlots.userId, userId),
        notInArray(userMemorySlots.slotIndex, keptIndexes),
      ),
    );
}

async function upsertSavedStations(
  userId: string,
  stations: StationDefinition[],
): Promise<void> {
  const normalized = normalizeSavedStations(stations);
  const now = new Date();
  const keptIds = normalized.map((s) => s.id);

  for (const station of normalized) {
    await db
      .insert(userSavedStations)
      .values({
        userId,
        stationId: station.id,
        stationName: station.name,
        stationConfig: station,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userSavedStations.userId, userSavedStations.stationId],
        set: {
          stationName: station.name,
          stationConfig: station,
          updatedAt: now,
        },
      });
  }

  if (keptIds.length === 0) {
    await db.delete(userSavedStations).where(eq(userSavedStations.userId, userId));
    return;
  }

  await db
    .delete(userSavedStations)
    .where(
      and(
        eq(userSavedStations.userId, userId),
        notInArray(userSavedStations.stationId, keptIds),
      ),
    );
}

/**
 * GET /api/user/sync
 * Return the signed-in listener's cloud memory slots (1–6), saved stations,
 * and `users.preferences` JSONB (Host Studio + lastStationId + hostRetention).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        memoryPresets: createEmptyMemoryPresets(),
        savedStations: [] as StationDefinition[],
        stationConfigs: {} as StationConfigMap,
        preferences: null,
        unavailable: true,
      },
      { status: 503 },
    );
  }

  try {
    await ensureUserRow(userId);
    const state = await readCloudState(userId);
    return NextResponse.json(state);
  } catch (err) {
    console.error("[api/user/sync] GET failed:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch user sync state",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/user/sync
 * Upsert memory presets, saved stations, and/or the JSONB preference slice.
 * A body containing `preferences` alone (no memoryPresets / savedStations) is valid.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database unavailable", unavailable: true },
      { status: 503 },
    );
  }

  let body: SyncPostBody;
  try {
    body = (await request.json()) as SyncPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasMemory = body.memoryPresets !== undefined;
  const hasSaved = body.savedStations !== undefined;
  const hasPreferences = body.preferences !== undefined;
  const marketingOptIn = parseMarketingOptIn(body.marketingOptIn);
  if (!isUserSyncPostBodyValid(body) && marketingOptIn === undefined) {
    return NextResponse.json(
      { error: "Provide memoryPresets, savedStations, and/or preferences" },
      { status: 400 },
    );
  }

  try {
    await ensureUserRow(userId, marketingOptIn);

    if (hasMemory) {
      await upsertMemoryPresets(
        userId,
        normalizeMemoryPresets(body.memoryPresets),
        normalizeStationConfigsInput(body.stationConfigs),
      );
    }

    if (hasSaved) {
      await upsertSavedStations(userId, normalizeSavedStations(body.savedStations));
    }

    if (hasPreferences) {
      const preferences = normalizeCloudPreferences(body.preferences);
      if (preferences) {
        await upsertCloudPreferences(userId, preferences);
      }
    }

    const state = await readCloudState(userId);
    // Merge helper keeps the response shape stable for clients that round-trip.
    return NextResponse.json({
      memoryPresets: state.memoryPresets,
      savedStations: mergeSavedStationLists(state.savedStations, []),
      stationConfigs: state.stationConfigs,
      preferences: state.preferences,
    });
  } catch (err) {
    console.error("[api/user/sync] POST failed:", err);
    return NextResponse.json(
      {
        error: "Failed to sync user state",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
