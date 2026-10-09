import { NextResponse } from "next/server";
import type { PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";
import { matchPersonaForArtist } from "@/lib/artist-radio";
import {
  parseMixNeighborParam,
  parseStoredPoolParam,
  type MixPoolName,
  type NeighborhoodCast,
  type PreviousCast,
} from "@/lib/artist-mix";
import {
  curatorPromptTarget,
  parsePreviousTitles,
  withNeighborhoodDescription,
} from "@/lib/curate-playlist";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import { parseFailedYoutubeIds } from "@/lib/failed-youtube-ids";
import { neighborhoodPoolIsFresh, suggestSceneArtists } from "@/lib/mix-neighbors";
import {
  buildMixedNeighborhood,
  buildSceneNeighborhood,
  type PlannedSlot,
} from "@/lib/neighborhood-launch";

/** Each prompt is built fresh. Responses stay uncached. */
export const dynamic = "force-dynamic";

type CuratedPlaylist = {
  name: string;
  description: string;
  personaId: PersonaId;
  accentColor: string;
  tracks: StationTrack[];
  tailPlan?: PlannedSlot[];
  pool?: MixPoolName[];
  cast?: NeighborhoodCast;
};

function parsePlan(value: unknown): PlannedSlot[] {
  if (!Array.isArray(value)) return [];
  const out: PlannedSlot[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const artist = "artist" in row && typeof row.artist === "string" ? row.artist.trim() : "";
    const title = "title" in row && typeof row.title === "string" ? row.title.trim() : "";
    if (!artist || !title) continue;
    const alt =
      "alt" in row && Array.isArray(row.alt)
        ? row.alt.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
    out.push({ artist, title, ...(alt.length ? { alt } : {}) });
  }
  return out;
}

function previousFromBody(body: Record<string, unknown>, previousTitles: { artist: string }[]): PreviousCast {
  const close = parseMixNeighborParam(
    Array.isArray(body.lastClose) ? (body.lastClose as string[]).join("|") : "",
  );
  const peer = parseMixNeighborParam(
    Array.isArray(body.lastPeer) ? (body.lastPeer as string[]).join("|") : "",
  );
  const deep = parseMixNeighborParam(
    Array.isArray(body.lastDeep) ? (body.lastDeep as string[]).join("|") : "",
  );
  const used = new Set<string>();
  for (const name of [...close, ...peer, ...deep, ...previousTitles.map((row) => row.artist)]) {
    if (name.trim()) used.add(name.trim());
  }
  return { close, peer, deep, used: [...used] };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const beat = body.beat === 2 || body.beat === "2" ? "2" : "1";
    const excludeYoutubeIds = parseFailedYoutubeIds(body.excludeYoutubeIds);

    if (beat === "2") {
      const launched = await buildSceneNeighborhood({
        pool: [],
        beat: "2",
        plan: parsePlan(body.plan),
        excludeYoutubeIds,
      });
      return NextResponse.json({ tracks: launched.tracks, beat: 2 });
    }

    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const previousTitles = parsePreviousTitles(body.previousTitles);
    const previous = previousFromBody(body, previousTitles);
    const target = curatorPromptTarget(prompt);
    const clientPool = parseStoredPoolParam(
      typeof body.pool === "string" ? body.pool : JSON.stringify(body.pool ?? []),
    );
    const poolAt = typeof body.poolAt === "number" ? body.poolAt : Number(body.poolAt);

    let tracks: StationTrack[] = [];
    let tailPlan: PlannedSlot[] = [];
    let pool: MixPoolName[] = [];
    let cast: NeighborhoodCast = { close: [], peer: [], deep: [] };
    let name = prompt.slice(0, 40);
    let personaId: PersonaId = resolveDjIdForQuery(prompt);

    if (target.kind === "artist") {
      const cached = neighborhoodPoolIsFresh(clientPool, poolAt)
        ? { names: clientPool, at: poolAt }
        : null;
      const launched = await buildMixedNeighborhood({
        artistName: target.artist,
        previous,
        previousNames: previous.used ?? [],
        excludeYoutubeIds,
        poolDeps: cached ? { cached } : undefined,
      });
      tracks = launched.tracks;
      tailPlan = launched.tailPlan;
      pool = launched.pool;
      cast = launched.cast;
      name = `${target.artist} Radio`.slice(0, 40);
      personaId = matchPersonaForArtist(target.artist, tracks);
    } else {
      const names = await suggestSceneArtists(prompt, previous.used ?? []);
      pool = names.map((artist) => ({ name: artist }));
      const launched = await buildSceneNeighborhood({
        pool,
        previous,
        excludeYoutubeIds,
      });
      tracks = launched.tracks;
      tailPlan = launched.tailPlan;
      cast = launched.cast;
      personaId = resolveDjIdForQuery(prompt);
    }

    if (tracks.length === 0) {
      return NextResponse.json(
        { error: "No real songs fit this prompt. Nothing was invented to fill the list." },
        { status: 422 },
      );
    }

    const result: CuratedPlaylist = {
      name: name || "AI Curated Mix",
      description: withNeighborhoodDescription(prompt, tracks.length),
      personaId,
      accentColor: "#F2AD4A",
      tracks,
      tailPlan,
      pool,
      cast,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("curate-playlist error:", error);
    return NextResponse.json({ error: "Failed to curate playlist" }, { status: 500 });
  }
}
