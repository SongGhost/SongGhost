import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  real,
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-user memory dial slots (exactly 1–6 in product logic). */
export const userMemorySlots = pgTable("user_memory_slots", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  slotNumber: integer("slot_number").notNull(),
  stationConfig: jsonb("station_config").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserMemorySlot = typeof userMemorySlots.$inferSelect;
export type CachedLoreBreak = typeof cachedLoreBreaks.$inferSelect;
