import { NextResponse } from "next/server";
import { resolvePublicStation } from "@/lib/station/public-station";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

async function readId(params: RouteContext["params"]): Promise<string> {
  const resolved = await Promise.resolve(params);
  return typeof resolved?.id === "string" ? resolved.id.trim() : "";
}

/**
 * GET `/api/station/[id]` — public station metadata + configuration.
 * Resolves from built-in catalog, Postgres `user_saved_stations`, or R2 studio manifests.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const id = await readId(context.params);
    if (!id) {
      return NextResponse.json(
        { station: null, error: "Missing station id" },
        { status: 400 },
      );
    }

    const station = await resolvePublicStation(id);
    if (!station) {
      return NextResponse.json(
        { station: null, error: "Station not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ station, error: null });
  } catch (err) {
    console.error("[api/station] GET failed:", err);
    return NextResponse.json(
      {
        station: null,
        error: "Failed to load station",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
