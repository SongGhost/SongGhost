#!/usr/bin/env npx tsx
/**
 * Print the opted-in marketing list (marketing_opt_in = true).
 * Same filter and cap as GET /api/admin/marketing-list.
 * Read-only. Does not send email.
 *
 * Usage:
 *   npx tsx scripts/export-marketing-list.ts
 *   npx tsx scripts/export-marketing-list.ts --csv
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../src/lib/db/schema";

/** Soft cap so a large opted-in table cannot dump unbounded output. */
const LIST_CAP = 10_000;

function fail(message: string): never {
  console.error(`export-marketing-list: ${message}`);
  process.exit(1);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main(): Promise<void> {
  const csv = process.argv.includes("--csv");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail("DATABASE_URL is not configured");
  }

  const client = postgres(databaseUrl, { prepare: false });
  const db = drizzle(client);

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

    const list = rows.map((row) => ({
      id: row.id,
      email: row.email,
      marketingOptInAt: row.marketingOptInAt
        ? row.marketingOptInAt.toISOString()
        : null,
    }));

    if (csv) {
      const lines = ["id,email,marketingOptInAt"];
      for (const row of list) {
        lines.push(
          [csvCell(row.id), csvCell(row.email), csvCell(row.marketingOptInAt ?? "")].join(
            ",",
          ),
        );
      }
      process.stdout.write(lines.join("\n") + (lines.length ? "\n" : ""));
    } else {
      process.stdout.write(
        `${JSON.stringify({ users: list, cap: LIST_CAP, truncated: list.length >= LIST_CAP }, null, 2)}\n`,
      );
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main();
