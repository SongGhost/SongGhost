import { z } from "zod";

/**
 * Phase 5 environment variables (Postgres, Cloudflare R2, Clerk).
 * Call `getPhase5Env()` / `parsePhase5Env()` when infrastructure code needs them —
 * do not parse at module load so earlier phases keep running without these keys.
 *
 * DATABASE_URL and R2 keys are optional so local/dev can run without infra.
 * Clerk keys remain required when Phase 5 auth env is parsed.
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

/**
 * Accept undefined / blank as unset; when a value is present, run `schema`.
 * Keeps local `.env` files from crashing on omitted infra keys.
 */
function optionalWhenBlank<T extends z.ZodType<string>>(schema: T) {
  return z
    .union([schema, z.literal(""), z.undefined()])
    .transform((value): string | undefined =>
      value === undefined || value === "" ? undefined : value,
    );
}

export const phase5EnvSchema = z.object({
  DATABASE_URL: optionalWhenBlank(postgresConnectionUrl),
  R2_ACCOUNT_ID: optionalWhenBlank(nonEmptyString),
  R2_ACCESS_KEY_ID: optionalWhenBlank(nonEmptyString),
  R2_SECRET_ACCESS_KEY: optionalWhenBlank(nonEmptyString),
  R2_BUCKET_NAME: optionalWhenBlank(nonEmptyString),
  NEXT_PUBLIC_R2_CDN_URL: optionalWhenBlank(httpOrHttpsUrl),
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

/** Infra keys that may be omitted in local/dev (validated only when set). */
export const PHASE5_OPTIONAL_ENV_KEYS = [
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "NEXT_PUBLIC_R2_CDN_URL",
] as const satisfies ReadonlyArray<Phase5EnvKey>;

export type Phase5OptionalEnvKey = (typeof PHASE5_OPTIONAL_ENV_KEYS)[number];

export type EnvFieldResult =
  | { key: Phase5EnvKey; ok: true; optional?: boolean }
  | { key: Phase5EnvKey; ok: false; message: string; optional?: boolean };

export function isPhase5OptionalEnvKey(key: Phase5EnvKey): boolean {
  return (PHASE5_OPTIONAL_ENV_KEYS as readonly string[]).includes(key);
}

/** Validate a single Phase 5 env key without exposing the raw value. */
export function checkPhase5EnvField(
  key: Phase5EnvKey,
  value: string | undefined,
): EnvFieldResult {
  const fieldSchema = phase5EnvSchema.shape[key];
  const result = fieldSchema.safeParse(value);
  const optional = isPhase5OptionalEnvKey(key);

  if (result.success) {
    return { key, ok: true, optional };
  }

  const message =
    value === undefined || value.trim() === ""
      ? "Missing or empty"
      : (result.error.issues[0]?.message ?? "Invalid value");

  return { key, ok: false, message, optional };
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
