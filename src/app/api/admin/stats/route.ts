import { NextResponse } from "next/server";
import { getAdminStats, verifyAdminAccess } from "@/lib/admin";
import { isDatabaseConfigured } from "@/lib/usage/dj-breaks";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats
 * Owner-only platform metrics: accounts, Pro subs, DJ break volume,
 * estimated API spend, and saved stations. Returns 403 when unauthorized.
 */
export async function GET() {
  const isAdmin = await verifyAdminAccess();
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database is not configured" },
      { status: 503 },
    );
  }

  try {
    const stats = await getAdminStats();
    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/admin/stats] Failed to load admin stats:", message);
    return NextResponse.json(
      { error: "Failed to load admin stats" },
      { status: 500 },
    );
  }
}
