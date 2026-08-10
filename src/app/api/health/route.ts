import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextResponse } from "next/server";
import postgres from "postgres";

export const dynamic = "force-dynamic";

type ServiceStatus =
  | "connected"
  | "configured"
  | "not_configured"
  | "missing"
  | "error";

type HealthServices = {
  database: ServiceStatus;
  openai: ServiceStatus;
  clerk: ServiceStatus;
};

type HealthPayload = {
  status: "ok" | "error";
  timestamp: string;
  services: HealthServices;
};

function isConfigured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Fast Postgres probe via Drizzle + postgres.js.
 * Uses a short-lived single connection so health checks do not share the app pool.
 */
async function probeDatabase(databaseUrl: string): Promise<"connected" | "error"> {
  const client = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
  });

  try {
    const db = drizzle(client);
    await db.execute(sql`select 1`);
    return "connected";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/health] Database probe failed:", message);
    return "error";
  } finally {
    try {
      await client.end({ timeout: 2 });
    } catch {
      // Ignore teardown failures on a probe client.
    }
  }
}

/**
 * GET /api/health
 * Lightweight production monitor: Postgres reachability (when configured) plus
 * essential API key presence. Returns 200 when healthy, 503 when a critical
 * dependency check fails.
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  const services: HealthServices = {
    database: "not_configured",
    openai: "missing",
    clerk: "missing",
  };

  let criticalOk = true;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    services.database = await probeDatabase(databaseUrl);
    if (services.database !== "connected") {
      criticalOk = false;
    }
  }

  if (isConfigured(process.env.OPENAI_API_KEY)) {
    services.openai = "configured";
  } else {
    services.openai = "missing";
    criticalOk = false;
  }

  if (isConfigured(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    services.clerk = "configured";
  } else {
    services.clerk = "missing";
    criticalOk = false;
  }

  const payload: HealthPayload = {
    status: criticalOk ? "ok" : "error",
    timestamp,
    services,
  };

  return NextResponse.json(payload, { status: criticalOk ? 200 : 503 });
}
