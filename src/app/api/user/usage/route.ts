import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  buildUsageSnapshot,
  isDatabaseConfigured,
  resolveListenerTier,
} from "@/lib/usage/dj-breaks";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/usage
 * Returns the authenticated listener's rolling 30-day DJ break meter:
 * `breakCount`, Free/Pro `limit` (null = unlimited), and `daysUntilReset`.
 * Auto-resets `breakCount` when `periodStart` is older than 30 days.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tier = await resolveListenerTier();

  if (!isDatabaseConfigured()) {
    return NextResponse.json({
      breakCount: 0,
      // Unlimited for Free and Pro — break-cap enforcement is disabled.
      limit: null,
      daysUntilReset: 30,
      periodStart: new Date().toISOString(),
      tier,
      metering: "local_only",
    });
  }

  try {
    const snapshot = await buildUsageSnapshot(userId, tier);
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/user/usage] Failed to load usage:", message);
    return NextResponse.json(
      { error: "Failed to load usage meter" },
      { status: 500 },
    );
  }
}
