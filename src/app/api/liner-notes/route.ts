import { NextResponse } from "next/server";
import {
  lookupITunesAlbum,
  lookupITunesTrack,
  upgradeITunesArtworkUrl,
} from "@/lib/itunes";

export const dynamic = "force-dynamic";

type LinerNotesRequest = {
  title?: string;
  artist?: string;
  album?: string;
  releaseYear?: number;
  label?: string;
};

function cleanLabel(copyright: string | undefined): string | null {
  if (!copyright?.trim()) return null;
  // Strip leading years / © marks: "℗ 1977 Warner Bros. Records" → "Warner Bros. Records"
  return (
    copyright
      .replace(/^[©℗]\s*/u, "")
      .replace(/^\d{4}\s*/u, "")
      .replace(/^P\s+/u, "")
      .trim() || null
  );
}

/**
 * Track liner notes: iTunes sleeve metadata + a short AI lore paragraph.
 * Falls back to seeded year/label when the LLM or catalog is unavailable.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LinerNotesRequest;
    const title = body.title?.trim();
    const artist = body.artist?.trim();

    if (!title || !artist) {
      return NextResponse.json(
        { error: "title and artist are required" },
        { status: 400 },
      );
    }

    let releaseYear: number | null =
      typeof body.releaseYear === "number" && Number.isFinite(body.releaseYear)
        ? body.releaseYear
        : null;
    let label: string | null = body.label?.trim() || null;
    let genre: string | null = null;
    let artworkUrl: string | null = null;

    const song = await lookupITunesTrack(artist, title).catch(() => null);
    if (song) {
      if (song.releaseYear && !releaseYear) releaseYear = song.releaseYear;
      if (song.primaryGenreName) genre = song.primaryGenreName;
      if (song.collectionId) {
        const lookup = await lookupITunesAlbum(song.collectionId).catch(() => null);
        const album = lookup?.album;
        if (album) {
          if (!label) label = cleanLabel(album.copyright);
          if (!releaseYear && album.releaseYear) releaseYear = album.releaseYear;
          if (!genre && album.primaryGenreName) genre = album.primaryGenreName;
          if (album.coverArtUrl) artworkUrl = album.coverArtUrl;
        }
      }
    }

    let lore =
      `${title} by ${artist}` +
      (releaseYear ? ` (${releaseYear})` : "") +
      " — a cut worth sitting with. Sleeve notes are thin on this one, but the groove still speaks.";

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
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
                content:
                  "You write short, vivid liner-note lore for a music listening app. " +
                  "2–4 sentences, no bullet lists, no 'fun fact' openers. " +
                  "Only use widely established recording history — never invent studio lore, " +
                  "personnel, chart positions, or anecdotes. If unsure, stay atmospheric and factual " +
                  "about era/genre/artist reputation. Return plain text only.",
              },
              {
                role: "user",
                content: [
                  `Song: ${title}`,
                  `Artist: ${artist}`,
                  body.album ? `Album: ${body.album}` : null,
                  releaseYear ? `Year: ${releaseYear}` : null,
                  label ? `Label: ${label}` : null,
                  genre ? `Genre: ${genre}` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
            max_tokens: 220,
            temperature: 0.7,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const text = data.choices?.[0]?.message?.content?.trim();
          if (text) lore = text;
        }
      } catch {
        // Keep the fallback paragraph — drawer still renders metadata.
      }
    }

    return NextResponse.json({
      releaseYear,
      label,
      genre,
      lore,
      artworkUrl: artworkUrl ? (upgradeITunesArtworkUrl(artworkUrl) ?? artworkUrl) : null,
    });
  } catch (err) {
    console.error("[liner-notes]", err);
    return NextResponse.json({ error: "Failed to load liner notes" }, { status: 500 });
  }
}
