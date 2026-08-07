import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getPhase5Env } from "@/lib/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | undefined;
let dbInstance: Database | undefined;

/**
 * Lazy Drizzle client — `getPhase5Env()` runs on first use so earlier phases
 * can import route modules without requiring `DATABASE_URL` at module load.
 */
export function getDb(): Database {
  if (!dbInstance) {
    const { DATABASE_URL } = getPhase5Env();
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not configured — Postgres features are unavailable",
      );
    }
    client = postgres(DATABASE_URL, { prepare: false });
    dbInstance = drizzle(client, { schema });
  }
  return dbInstance;
}

/** Convenience export; same lazy singleton as `getDb()`. */
export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(getDb()) : value;
  },
});

export * from "./schema";
