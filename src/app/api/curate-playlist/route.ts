import { NextResponse } from "next/server";
import { getPersonaById, type PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";
import { resolveTrackVideoId } from "@/lib/youtube-search";

type CuratedPlaylist = {
  name: string;
  description: string;
  personaId: PersonaId;
  accentColor: string;
  tracks: StationTrack[];
};

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert music curator for a retro FM radio app. Given a user prompt, return a JSON object with:
- "name": short station name (max 40 chars)
- "description": one-line vibe description
- "personaId": one of: madison, wolfman, groovy_greg, studio_val, hype_jay, cyber_anya, chill_maya, smooth_duke
- "accentColor": hex color matching the vibe (e.g. #F2AD4A)
- "tracks": array of exactly 10 objects with "title" and "artist" (real, well-known songs matching the prompt)

Return ONLY valid JSON, no markdown.`,
          },
          {
            role: "user",
            content: prompt.trim(),
          },
        ],
        max_tokens: 800,
        temperature: 0.85,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: `OpenAI error: ${error}` }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return NextResponse.json({ error: "No playlist generated" }, { status: 502 });
    }

    const parsed = JSON.parse(raw) as {
      name?: string;
      description?: string;
      personaId?: string;
      accentColor?: string;
      tracks?: { title: string; artist: string }[];
    };

    const persona = getPersonaById(parsed.personaId ?? "madison");
    const resolvedTracks: StationTrack[] = [];

    for (const track of parsed.tracks ?? []) {
      if (!track.title || !track.artist) continue;
      const youtubeId = await resolveTrackVideoId(track.artist, track.title);
      if (youtubeId) {
        resolvedTracks.push({ youtubeId, title: track.title, artist: track.artist });
      }
    }

    if (resolvedTracks.length === 0) {
      return NextResponse.json(
        { error: "Could not resolve playable tracks for this playlist. Try a different prompt." },
        { status: 422 },
      );
    }

    const result: CuratedPlaylist = {
      name: parsed.name ?? "AI Curated Mix",
      description: parsed.description ?? prompt.trim(),
      personaId: (persona?.id ?? "madison") as PersonaId,
      accentColor: parsed.accentColor ?? "#F2AD4A",
      tracks: resolvedTracks,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("curate-playlist error:", error);
    return NextResponse.json({ error: "Failed to curate playlist" }, { status: 500 });
  }
}
