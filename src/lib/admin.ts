import { auth } from "@clerk/nextjs/server";
import { count, eq, sum } from "drizzle-orm";
import { db, users, userSavedStations, userUsageLimits } from "@/lib/db";

/** Estimated LLM+TTS unit cost per voiced DJ break (USD). */
export const ESTIMATED_BREAK_UNIT_COST_USD = 0.0039;

export type AdminStats = {
  users: number;
  proSubscribers: number;
  totalBreaks: number;
  estimatedSpend: number;
  savedStations: number;
};

type SessionMetadata = {
  role?: unknown;
};

/**
 * Returns true when the current Clerk session belongs to a platform admin.
 * Authorization: `userId` listed in `ADMIN_USER_IDS` (comma-separated) OR
 * `sessionClaims.metadata.role === "admin"`.
 */
export async function verifyAdminAccess(): Promise<boolean> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return false;

  const adminIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (adminIds.includes(userId)) return true;

  const metadata = sessionClaims?.metadata as SessionMetadata | undefined;
  if (metadata?.role === "admin") return true;

  return false;
}

/** Aggregate platform metrics for the owner ops dashboard. */
export async function getAdminStats(): Promise<AdminStats> {
  const [[userRow], [proRow], [breaksRow], [stationsRow]] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(users).where(eq(users.tier, "pro")),
    db.select({ value: sum(userUsageLimits.breakCount) }).from(userUsageLimits),
    db.select({ value: count() }).from(userSavedStations),
  ]);

  const totalBreaks = Number(breaksRow?.value ?? 0) || 0;
  const estimatedSpend =
    Math.round(totalBreaks * ESTIMATED_BREAK_UNIT_COST_USD * 100) / 100;

  return {
    users: userRow?.value ?? 0,
    proSubscribers: proRow?.value ?? 0,
    totalBreaks,
    estimatedSpend,
    savedStations: stationsRow?.value ?? 0,
  };
}
