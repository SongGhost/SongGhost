import { z } from "zod";

/**
 * Phase 5 required environment variables (Postgres, Cloudflare R2, Clerk).
 * Call `getPhase5Env()` / `parsePhase5Env()` when infrastructure code needs them —
 * do not parse at module load so earlier phases keep running without these keys.
 */

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

export const phase5EnvSchema = z.object({
  DATABASE_URL: postgresConnectionUrl,
  R2_ACCOUNT_ID: nonEmptyString,
  R2_ACCESS_KEY_ID: nonEmptyString,
  R2_SECRET_ACCESS_KEY: nonEmptyString,
  R2_BUCKET_NAME: nonEmptyString,
  NEXT_PUBLIC_R2_CDN_URL: httpOrHttpsUrl,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: nonEmptyString,
  CLERK_SECRET_KEY: nonEmptyString,
});

export type Phase5Env = z.infer<typeof phase5EnvSchema>;

export const PHASE5_ENV_KEYS = [
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "NEXT_PUBLIC_R2_CDN_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
] as const satisfies ReadonlyArray<keyof Phase5Env>;

export type Phase5EnvKey = (typeof PHASE5_ENV_KEYS)[number];

export type EnvFieldResult =
  | { key: Phase5EnvKey; ok: true }
  | { key: Phase5EnvKey; ok: false; message: string };

/** Validate a single Phase 5 env key without exposing the raw value. */
export function checkPhase5EnvField(
  key: Phase5EnvKey,
  value: string | undefined,
): EnvFieldResult {
  const fieldSchema = phase5EnvSchema.shape[key];
  const result = fieldSchema.safeParse(value);

  if (result.success) {
    return { key, ok: true };
  }

  const message =
    value === undefined || value.trim() === ""
      ? "Missing or empty"
      : (result.error.issues[0]?.message ?? "Invalid value");

  return { key, ok: false, message };
}

/** Per-key results for UI / scripts (never includes secret values). */
export function auditPhase5Env(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): EnvFieldResult[] {
  return PHASE5_ENV_KEYS.map((key) => checkPhase5EnvField(key, env[key]));
}

export function parsePhase5Env(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Phase5Env {
  return phase5EnvSchema.parse(env);
}

export function getPhase5Env(): Phase5Env {
  return parsePhase5Env(process.env);
}

export function safeParsePhase5Env(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
  return phase5EnvSchema.safeParse(env);
}
