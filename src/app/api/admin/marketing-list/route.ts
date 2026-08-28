import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { verifyAdminAccess } from "@/lib/admin";
import { db, users } from "@/lib/db";
import { isDatabaseConfigured } from "@/lib/usage/dj-breaks";

export const dynamic = "force-dynamic";

/**
 * Soft cap so a large opted-in table cannot dump unbounded JSON.
 * Same cap as `scripts/export-marketing-list.ts`.
 */
const LIST_CAP = 10_000;

export type MarketingListEntry = {
  id: string;
  email: string;
  marketingOptInAt: string | null;
};

/**
 * GET /api/admin/marketing-list
 * Read-only list of users with `marketing_opt_in = true`.
 * Returns `{ id, email, marketingOptInAt }` only — no other PII.
 * 401 when there is no session; 403 when the session is not an admin.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        marketingOptInAt: users.marketingOptInAt,
      })
      .from(users)
      .where(eq(users.marketingOptIn, true))
      .limit(LIST_CAP);

    const optedInUsers: MarketingListEntry[] = rows.map((row) => ({
      id: row.id,
      email: row.email,
      marketingOptInAt: row.marketingOptInAt
        ? row.marketingOptInAt.toISOString()
        : null,
    }));

    return NextResponse.json({
      users: optedInUsers,
      cap: LIST_CAP,
      truncated: optedInUsers.length >= LIST_CAP,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/admin/marketing-list] Failed to load list:", message);
    return NextResponse.json(
      { error: "Failed to load marketing list" },
      { status: 500 },
    );
  }
}
