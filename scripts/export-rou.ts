#!/usr/bin/env npx tsx
/**
 * Monthly SoundExchange Report of Use (37 CFR § 370.4).
 *
 * Reads Postgres `user_play_logs` and writes a headerless ASCII pipe-delimited
 * file. Actual Total Performances (ATP) is COUNT(*) per recording.
 *
 * Usage:
 *   npx tsx scripts/export-rou.ts --month 2026-08
 *   npx tsx scripts/export-rou.ts --from 2026-08-01 --to 2026-08-31
 *   npm run export-rou -- --month 2026-08 --out ./rou
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { and, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { userPlayLogs } from "../src/lib/db/schema";

const TRANSMISSION_CATEGORY = "A";
const DEFAULT_SERVICE_NAME = "SongHost";

type CliOptions = {
  from: Date;
  to: Date;
  outDir: string;
  serviceName: string;
};

type PlayLogRow = {
  isrc: string | null;
  trackTitle: string;
  artistName: string;
  albumTitle: string | null;
};

type RouGroup = {
  key: string;
  isrc: string;
  artistName: string;
  trackTitle: string;
  albumTitle: string;
  atp: number;
};

function fail(message: string): never {
  console.error(`export-rou: ${message}`);
  process.exit(1);
}

function parseIsoDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) fail(`Invalid ${label}: ${value}`);
  return date;
}

function parseMonth(value: string): { from: Date; to: Date } {
  if (!/^\d{4}-\d{2}$/.test(value)) fail("--month must be YYYY-MM");
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    fail(`Invalid --month: ${value}`);
  }
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from, to };
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseArgs(argv: string[]): CliOptions {
  let month: string | undefined;
  let fromRaw: string | undefined;
  let toRaw: string | undefined;
  let outDir = resolve(process.cwd(), "rou");
  const serviceName =
    process.env.ROU_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--month" && next) {
      month = next;
      i += 1;
    } else if (arg === "--from" && next) {
      fromRaw = next;
      i += 1;
    } else if (arg === "--to" && next) {
      toRaw = next;
      i += 1;
    } else if (arg === "--out" && next) {
      outDir = resolve(process.cwd(), next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx tsx scripts/export-rou.ts --month YYYY-MM [--out ./rou]\n" +
          "       npx tsx scripts/export-rou.ts --from YYYY-MM-DD --to YYYY-MM-DD",
      );
      process.exit(0);
    }
  }

  if (month) {
    const range = parseMonth(month);
    return { ...range, outDir, serviceName };
  }
  if (fromRaw && toRaw) {
    const from = parseIsoDate(fromRaw, "--from");
    const to = parseIsoDate(toRaw, "--to");
    if (to <= from) fail("--to must be after --from");
    return { from, to, outDir, serviceName };
  }
  fail("Pass --month YYYY-MM or --from YYYY-MM-DD --to YYYY-MM-DD");
}

function groupKey(row: PlayLogRow): string {
  const isrc = row.isrc?.trim().toUpperCase();
  if (isrc) return `isrc:${isrc}`;
  return [
    row.artistName.trim().toLowerCase(),
    row.trackTitle.trim().toLowerCase(),
    (row.albumTitle ?? "").trim().toLowerCase(),
  ].join("|");
}

function caret(value: string): string {
  return `^${value.replace(/\^/g, "")}^`;
}

function formatRow(serviceName: string, group: RouGroup): string {
  return [
    caret(serviceName),
    caret(TRANSMISSION_CATEGORY),
    caret(group.artistName),
    caret(group.trackTitle),
    caret(group.isrc),
    String(group.atp),
  ].join("|");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail("DATABASE_URL is not configured");
  }

  const client = postgres(databaseUrl, { prepare: false });
  const db = drizzle(client);

  try {
    const rows = await db
      .select({
        isrc: userPlayLogs.isrc,
        trackTitle: userPlayLogs.trackTitle,
        artistName: userPlayLogs.artistName,
        albumTitle: userPlayLogs.albumTitle,
      })
      .from(userPlayLogs)
      .where(
        and(
          gte(userPlayLogs.playedAt, options.from),
          lt(userPlayLogs.playedAt, options.to),
        ),
      );

    const groups = new Map<string, RouGroup>();
    for (const row of rows) {
      const key = groupKey(row);
      const existing = groups.get(key);
      if (existing) {
        existing.atp += 1;
        continue;
      }
      groups.set(key, {
        key,
        isrc: row.isrc?.trim().toUpperCase() ?? "",
        artistName: row.artistName.trim(),
        trackTitle: row.trackTitle.trim(),
        albumTitle: row.albumTitle?.trim() ?? "",
        atp: 1,
      });
    }

    const lines = [...groups.values()]
      .sort((a, b) => a.artistName.localeCompare(b.artistName) || a.trackTitle.localeCompare(b.trackTitle))
      .map((group) => formatRow(options.serviceName, group));

    const fileName = `${options.serviceName.replace(/\s+/g, "")}${yyyymmdd(options.from)}-${yyyymmdd(options.to)}.txt`;
    const filePath = resolve(options.outDir, fileName);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, lines.join("\r\n") + (lines.length ? "\r\n" : ""), "utf8");

    const missingIsrc = [...groups.values()].filter((group) => !group.isrc).length;
    console.log(`Wrote ${filePath}`);
    console.log(`  performances: ${rows.length}`);
    console.log(`  recordings:   ${groups.size}`);
    console.log(`  missing ISRC: ${missingIsrc}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main();
