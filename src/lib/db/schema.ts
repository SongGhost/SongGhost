import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Clerk-backed account row — `id` is the Clerk user id. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  /** Product subscription tier synced from Stripe webhooks (`free` | `pro`). */
  tier: text("tier").notNull().default("free"),
  /**
   * Cross-device listener settings (persona, Host Studio, stationConfigs,
   * hostRetention, lastStationId). Memory dials and saved stations stay in
   * their own tables — this blob is NOT written to Clerk unsafeMetadata.
   */
  preferences: jsonb("preferences"),
  /** Explicit marketing-email opt-in. Default false — never assume consent. */
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  /** Set when consent is first granted or the opt-in value changes. */
  marketingOptInAt: timestamp("marketing_opt_in_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-user memory dial slots (product buttons 1–6 → `slotIndex` 0–5).
 * `stationConfig` holds MemoryPreset extras (frequency, accent, persona, savedAt)
 * plus any parked StationConfig override snapshot.
 */
export const userMemorySlots = pgTable(
  "user_memory_slots",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Zero-based dial index (0–5). */
    slotIndex: integer("slot_index").notNull(),
    stationId: text("station_id").notNull(),
    stationName: text("station_name").notNull(),
    stationConfig: jsonb("station_config").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_memory_slots_user_slot_uidx").on(table.userId, table.slotIndex),
  ],
);

/**
 * Listener-saved stations / playlists synced per Clerk account.
 * `stationConfig` stores the Station Profile JSON (seeds + StationConfig).
 * Frozen listener-ordered playlists are not persisted here.
 */
export const userSavedStations = pgTable(
  "user_saved_stations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stationId: text("station_id").notNull(),
    stationName: text("station_name").notNull(),
    stationConfig: jsonb("station_config").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_saved_stations_user_station_uidx").on(table.userId, table.stationId),
  ],
);

/**
 * Rolling 30-day DJ break meter per Clerk user (Phase 5C Free-tier quotas).
 * `periodStart` anchors the window; `/api/user/usage` and `/api/generate-script`
 * reset `breakCount` when the period is older than 30 days.
 */
export const userUsageLimits = pgTable("user_usage_limits", {
  userId: text("user_id").primaryKey(),
  breakCount: integer("break_count").notNull().default(0),
  periodStart: timestamp("period_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * SoundExchange Reports of Use (37 CFR § 370) — one row per DirectStream
 * performance that has been on-air longer than 30 seconds.
 * `userId` is nullable so guest streams still generate a statutory record.
 * Do not cascade-delete: account removal must not erase ROU history.
 */
export const userPlayLogs = pgTable(
  "user_play_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    isrc: text("isrc"),
    trackTitle: text("track_title").notNull(),
    artistName: text("artist_name").notNull(),
    albumTitle: text("album_title"),
    durationSec: real("duration_sec"),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
    playSessionId: text("play_session_id").notNull(),
  },
  (table) => [
    uniqueIndex("user_play_logs_play_session_uidx").on(table.playSessionId),
    index("user_play_logs_played_at_idx").on(table.playedAt),
    index("user_play_logs_isrc_idx").on(table.isrc),
  ],
);

/**
 * Cached lore TTS clips keyed by track + ElevenLabs voice.
 * Check-cache-first pipeline in `/api/generate-script` reads/writes this table.
 */
export const cachedLoreBreaks = pgTable(
  "cached_lore_breaks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    trackId: text("track_id").notNull(),
    voiceId: text("voice_id").notNull(),
    scriptText: text("script_text").notNull(),
    audioUrl: text("audio_url").notNull(),
    durationSec: real("duration_sec").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cached_lore_breaks_track_voice_uidx").on(table.trackId, table.voiceId),
  ],
);

/**
 * Canonical music-lore fact graph (Phase 7 Anti-Repetition Fact Engine).
 * Stable string ids (e.g. `fact_floyd_01`) are referenced by `user_lore_history`.
 */
export const loreFacts = pgTable("lore_facts", {
  id: text("id").primaryKey(),
  artistId: text("artist_id"),
  albumId: text("album_id"),
  trackId: text("track_id"),
  factText: text("fact_text").notNull(),
  /** e.g. `studio_lore`, `sample_origin`, `historical_context` */
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-listener served-fact ledger keyed by Clerk `userId`.
 * Negative-prompt injection reads this to avoid repeating trivia topics.
 */
export const userLoreHistory = pgTable(
  "user_lore_history",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    factId: text("fact_id")
      .notNull()
      .references(() => loreFacts.id, { onDelete: "cascade" }),
    servedAt: timestamp("served_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_lore_history_user_id_idx").on(table.userId),
    index("user_lore_history_user_fact_idx").on(table.userId, table.factId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserMemorySlot = typeof userMemorySlots.$inferSelect;
export type NewUserMemorySlot = typeof userMemorySlots.$inferInsert;
export type UserSavedStation = typeof userSavedStations.$inferSelect;
export type NewUserSavedStation = typeof userSavedStations.$inferInsert;
export type UserUsageLimit = typeof userUsageLimits.$inferSelect;
export type NewUserUsageLimit = typeof userUsageLimits.$inferInsert;
export type UserPlayLog = typeof userPlayLogs.$inferSelect;
export type NewUserPlayLog = typeof userPlayLogs.$inferInsert;
export type CachedLoreBreak = typeof cachedLoreBreaks.$inferSelect;
export type LoreFact = typeof loreFacts.$inferSelect;
export type NewLoreFact = typeof loreFacts.$inferInsert;
export type UserLoreHistory = typeof userLoreHistory.$inferSelect;
export type NewUserLoreHistory = typeof userLoreHistory.$inferInsert;
