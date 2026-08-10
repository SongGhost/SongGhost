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

export const dynamic = "force-dynamic";

/** Extras parked alongside a memory dial slot (columns hold id/name). */
type MemorySlotConfigJson = {
  frequency: number;
  accentColor: string;
  personaId?: string;
  savedAt: string;
  stationConfig?: StationConfig;
};

type SyncPostBody = {
  memoryPresets?: unknown;
  savedStations?: unknown;
  stationConfigs?: unknown;
};

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
    Array.isArray(station.tracks)
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
    out.push({ ...entry, id, name: entry.name.trim() });
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

  const config =
    typeof row.stationConfig === "object" && row.stationConfig !== null
      ? (row.stationConfig as Partial<MemorySlotConfigJson>)
      : {};

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
  return preset;
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

async function ensureUserRow(userId: string): Promise<void> {
  const clerkUser = await currentUser();
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress?.trim() ||
    clerkUser?.emailAddresses?.[0]?.emailAddress?.trim() ||
    `${userId}@users.clerk`;

  await db
    .insert(users)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: users.id });
}

async function readCloudState(userId: string): Promise<{
  memoryPresets: MemoryPresetList;
  savedStations: StationDefinition[];
}> {
  const [slotRows, stationRows] = await Promise.all([
    db.select().from(userMemorySlots).where(eq(userMemorySlots.userId, userId)),
    db.select().from(userSavedStations).where(eq(userSavedStations.userId, userId)),
  ]);

  const memoryPresets = createEmptyMemoryPresets();
  for (const row of slotRows) {
    const preset = memoryPresetFromRow(row);
    if (!preset) continue;
    memoryPresets[row.slotIndex] = preset;
  }

  const savedStations: StationDefinition[] = [];
  for (const row of stationRows) {
    const station = savedStationFromRow(row);
    if (station) savedStations.push(station);
  }

  return {
    memoryPresets: normalizeMemoryPresets(memoryPresets),
    savedStations,
  };
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
    const stationConfig: MemorySlotConfigJson = {
      frequency: preset.frequency,
      accentColor: preset.accentColor,
      savedAt: preset.savedAt,
      ...(preset.personaId ? { personaId: preset.personaId } : {}),
      ...(override ? { stationConfig: override } : {}),
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
 * Return the signed-in listener's cloud memory slots (1–6) and saved stations.
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
 * Upsert memory presets and/or saved stations from client localStorage.
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
  if (!hasMemory && !hasSaved) {
    return NextResponse.json(
      { error: "Provide memoryPresets and/or savedStations" },
      { status: 400 },
    );
  }

  try {
    await ensureUserRow(userId);

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

    const state = await readCloudState(userId);
    // Merge helper keeps the response shape stable for clients that round-trip.
    return NextResponse.json({
      memoryPresets: state.memoryPresets,
      savedStations: mergeSavedStationLists(state.savedStations, []),
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
