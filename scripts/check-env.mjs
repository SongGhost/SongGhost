#!/usr/bin/env node
/**
 * Validate Phase 5 required environment variables.
 *
 * Loads `.env` then `.env.local` (local overrides), then overlays `process.env`,
 * checks each required key against the same rules as `src/lib/env.ts`,
 * and prints pass/fail without echoing secret values.
 *
 * Usage:
 *   npm run check-env
 *   node scripts/check-env.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ROOT = process.cwd();

const nonEmptyString = z.string().trim().min(1, "Must be a non-empty string");

const httpOrHttpsUrl = z
  .string()
  .trim()
  .min(1, "Must be a non-empty string")
  .url("Must be a valid URL")
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be an http:// or https:// URL" },
  );

const postgresConnectionUrl = z
  .string()
  .trim()
  .min(1, "Must be a non-empty string")
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      } catch {
        return false;
      }
    },
    {
      message:
        "Must be a valid postgres connection URL (postgres:// or postgresql://)",
    },
  );

/** Treat missing/blank as unset; validate only when a value is present. */
function optionalWhenBlank(schema) {
  return z
    .union([schema, z.literal(""), z.undefined()])
    .transform((value) =>
      value === undefined || value === "" ? undefined : value,
    );
}

/** Mirrors `phase5EnvSchema` in `src/lib/env.ts`. */
const phase5EnvSchema = z.object({
  DATABASE_URL: optionalWhenBlank(postgresConnectionUrl),
  R2_ACCOUNT_ID: optionalWhenBlank(nonEmptyString),
  R2_ACCESS_KEY_ID: optionalWhenBlank(nonEmptyString),
  R2_SECRET_ACCESS_KEY: optionalWhenBlank(nonEmptyString),
  R2_BUCKET_NAME: optionalWhenBlank(nonEmptyString),
  NEXT_PUBLIC_R2_CDN_URL: optionalWhenBlank(httpOrHttpsUrl),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: nonEmptyString,
  CLERK_SECRET_KEY: nonEmptyString,
});

const PHASE5_ENV_KEYS = [
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "NEXT_PUBLIC_R2_CDN_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
];

const PHASE5_OPTIONAL_ENV_KEYS = new Set([
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "NEXT_PUBLIC_R2_CDN_URL",
]);

/**
 * Minimal dotenv parser (KEY=VALUE, optional quotes, # comments).
 * Does not expand variables or print values.
 */
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return { loaded: false, vars: {} };

  const text = readFileSync(filePath, "utf8");
  const vars = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const cleaned = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;

    const key = cleaned.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return { loaded: true, vars };
}

function loadEnvFiles() {
  const fromFiles = {};
  const sources = [];

  // Precedence matches Next.js: process.env > .env.local > .env
  for (const name of [".env", ".env.local"]) {
    const filePath = resolve(ROOT, name);
    const { loaded, vars } = parseEnvFile(filePath);
    if (!loaded) {
      sources.push(`${name} (not found)`);
      continue;
    }
    sources.push(name);
    Object.assign(fromFiles, vars);
  }

  return { env: { ...fromFiles, ...process.env }, sources };
}

function checkField(key, value) {
  const fieldSchema = phase5EnvSchema.shape[key];
  const result = fieldSchema.safeParse(value);
  const optional = PHASE5_OPTIONAL_ENV_KEYS.has(key);

  if (result.success) {
    const unset =
      value === undefined || String(value).trim() === "";
    if (optional && unset) {
      return { ok: true, message: "optional (unset)", optional };
    }
    return { ok: true, message: "ok", optional };
  }

  if (value === undefined || String(value).trim() === "") {
    return { ok: false, message: "Missing or empty", optional };
  }

  return {
    ok: false,
    message: result.error.issues[0]?.message ?? "Invalid value",
    optional,
  };
}

function main() {
  console.log("SongGhost Phase 5 environment check\n");

  const { env, sources } = loadEnvFiles();
  console.log(`Sources: ${sources.join(", ")}\n`);

  let passed = 0;
  let failed = 0;
  let optionalUnset = 0;

  for (const key of PHASE5_ENV_KEYS) {
    const { ok, message, optional } = checkField(key, env[key]);
    if (ok) {
      const mark = message.includes("unset") ? "○" : "✓";
      console.log(`${mark} ${key} — ${message}`);
      passed += 1;
      if (optional && message.includes("unset")) optionalUnset += 1;
    } else {
      console.log(`✗ ${key} — ${message}`);
      failed += 1;
    }
  }

  const requiredCount = PHASE5_ENV_KEYS.length - PHASE5_OPTIONAL_ENV_KEYS.size;
  console.log(
    `\n${passed} passed, ${failed} failed (${requiredCount} required, ${PHASE5_OPTIONAL_ENV_KEYS.size} optional; ${optionalUnset} optional unset)`,
  );

  if (failed > 0) {
    console.log(
      "\nAdd the missing/invalid variables to `.env.local` (never commit secrets).",
    );
    process.exit(1);
  }

  console.log("\nAll Phase 5 required environment variables are set.");
  process.exit(0);
}

main();
