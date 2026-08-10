import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { db, getDb, userUsageLimits } from "@/lib/db";
import {
  FREE_MONTHLY_BREAK_LIMIT,
  USAGE_PERIOD_MS,
} from "@/lib/usage/constants";

export { FREE_MONTHLY_BREAK_LIMIT, USAGE_PERIOD_MS };

/** Product subscription tier used by billing + Free-tier break metering. */
export type SubscriptionTier = "free" | "pro";

export type DjBreakUsageSnapshot = {
  breakCount: number;
  /** `null` means unlimited (Pro). */
  limit: number | null;
  daysUntilReset: number;
  periodStart: string;
  tier: SubscriptionTier;
};

export function coerceSubscriptionTier(raw: unknown): SubscriptionTier {
  if (typeof raw !== "string") return "free";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "pro") return "pro";
  return "free";
}

export function isDatabaseConfigured(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

export function daysUntilPeriodReset(periodStart: Date, now = new Date()): number {
  const resetAt = periodStart.getTime() + USAGE_PERIOD_MS;
  const remainingMs = resetAt - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

export function isPeriodExpired(periodStart: Date, now = new Date()): boolean {
  return now.getTime() - periodStart.getTime() >= USAGE_PERIOD_MS;
}

/**
 * Resolve Free vs Pro from Clerk `unsafeMetadata.tier`.
 * Optional `bodyTier` lets DevTierToggle override for local testing.
 */
export async function resolveListenerTier(
  bodyTier?: unknown,
): Promise<SubscriptionTier> {
  if (bodyTier != null) return coerceSubscriptionTier(bodyTier);

  try {
    const user = await currentUser();
    if (user?.unsafeMetadata?.tier != null) {
      return coerceSubscriptionTier(user.unsafeMetadata.tier);
    }
  } catch (err) {
    console.warn("[usage] Clerk auth unavailable for tier check", err);
  }

  return "free";
}

type UsageRow = {
  breakCount: number;
  periodStart: Date;
  updatedAt: Date;
};

/**
 * Load (or create) the usage row, resetting the counter when the 30-day
 * window has elapsed.
 */
export async function getOrResetUsageRow(userId: string): Promise<UsageRow> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(userUsageLimits)
    .where(eq(userUsageLimits.userId, userId))
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(userUsageLimits)
      .values({
        userId,
        breakCount: 0,
        periodStart: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: userUsageLimits.userId })
      .returning();

    if (created) {
      return {
        breakCount: created.breakCount,
        periodStart: created.periodStart,
        updatedAt: created.updatedAt,
      };
    }

    const [race] = await db
      .select()
      .from(userUsageLimits)
      .where(eq(userUsageLimits.userId, userId))
      .limit(1);
    if (!race) {
      throw new Error("Failed to create user_usage_limits row");
    }
    return {
      breakCount: race.breakCount,
      periodStart: race.periodStart,
      updatedAt: race.updatedAt,
    };
  }

  if (isPeriodExpired(existing.periodStart, now)) {
    const [reset] = await db
      .update(userUsageLimits)
      .set({
        breakCount: 0,
        periodStart: now,
        updatedAt: now,
      })
      .where(eq(userUsageLimits.userId, userId))
      .returning();

    return {
      breakCount: reset?.breakCount ?? 0,
      periodStart: reset?.periodStart ?? now,
      updatedAt: reset?.updatedAt ?? now,
    };
  }

  return {
    breakCount: existing.breakCount,
    periodStart: existing.periodStart,
    updatedAt: existing.updatedAt,
  };
}

export async function buildUsageSnapshot(
  userId: string,
  tier: SubscriptionTier,
): Promise<DjBreakUsageSnapshot> {
  const row = await getOrResetUsageRow(userId);
  const limit = tier === "pro" ? null : FREE_MONTHLY_BREAK_LIMIT;
  return {
    breakCount: row.breakCount,
    limit,
    daysUntilReset: daysUntilPeriodReset(row.periodStart),
    periodStart: row.periodStart.toISOString(),
    tier,
  };
}

/**
 * Free-tier gate for `/api/generate-script`.
 * Returns a 403 response when the monthly allowance is exhausted.
 */
export async function enforceFreeTierBreakQuota(
  userId: string | null | undefined,
  tier: SubscriptionTier,
): Promise<NextResponse | null> {
  if (!userId || tier === "pro") return null;
  if (!isDatabaseConfigured()) {
    console.warn(
      "[usage] DATABASE_URL unset — skipping Free-tier DJ break quota enforcement",
    );
    return null;
  }

  try {
    const row = await getOrResetUsageRow(userId);
    if (row.breakCount >= FREE_MONTHLY_BREAK_LIMIT) {
      return NextResponse.json(
        {
          error: "QUOTA_EXCEEDED",
          message: "Monthly free DJ breaks limit reached.",
        },
        { status: 403 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[usage] Quota check failed, allowing request:", message);
  }

  return null;
}

/** Increment the Free-tier counter after a successful script generation. */
export async function incrementFreeTierBreakCount(
  userId: string | null | undefined,
  tier: SubscriptionTier,
): Promise<void> {
  if (!userId || tier !== "free") return;
  if (!isDatabaseConfigured()) return;

  try {
    const row = await getOrResetUsageRow(userId);
    const now = new Date();
    await db
      .update(userUsageLimits)
      .set({
        breakCount: row.breakCount + 1,
        updatedAt: now,
      })
      .where(eq(userUsageLimits.userId, userId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[usage] Failed to increment breakCount:", message);
  }
}
