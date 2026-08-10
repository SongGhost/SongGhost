import type { Metadata } from "next";
import { cache } from "react";
import PublicStationPlayer from "@/components/player/PublicStationPlayer";
import {
  buildPublicStationDescription,
  buildPublicStationTitle,
  resolvePublicStation,
  type PublicStation,
} from "@/lib/station/public-station";

type PageParams = { id: string };
type PageProps = {
  params: Promise<PageParams> | PageParams;
};

async function readId(params: PageProps["params"]): Promise<string> {
  const resolved = await Promise.resolve(params);
  return typeof resolved?.id === "string" ? resolved.id.trim() : "";
}

/** Dedupes `generateMetadata` + page render lookups in the same RSC request. */
const loadStation = cache(async (id: string): Promise<PublicStation | null> => {
  if (!id) return null;
  try {
    return await resolvePublicStation(id);
  } catch (err) {
    console.error("[s/[id]] resolvePublicStation failed:", err);
    return null;
  }
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const id = await readId(params);
  const station = await loadStation(id);

  if (!station) {
    return {
      title: "Station not found — SongHost",
      description: "This SongHost station link is invalid or no longer available.",
      openGraph: {
        title: "Station not found — SongHost",
        description:
          "This SongHost station link is invalid or no longer available.",
        siteName: "SongHost",
        type: "website",
      },
      twitter: {
        card: "summary",
        title: "Station not found — SongHost",
        description:
          "This SongHost station link is invalid or no longer available.",
      },
    };
  }

  const title = buildPublicStationTitle(station);
  const baseDescription = buildPublicStationDescription(station);
  // Studio shares need Spotify Premium or Apple Music for full playback.
  const description =
    station.source === "studio"
      ? `${baseDescription} Requires an active Spotify Premium or Apple Music account for full playback.`
      : baseDescription;
  const images = station.coverImageUrl
    ? [{ url: station.coverImageUrl, alt: `${station.name} cover art` }]
    : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "SongHost",
      type: "website",
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      images: station.coverImageUrl ? [station.coverImageUrl] : undefined,
    },
  };
}

/**
 * Public station permalink — OpenGraph metadata + SongHost player pre-load.
 */
export default async function SharedStationPage({ params }: PageProps) {
  const id = await readId(params);
  const station = await loadStation(id);

  return (
    <PublicStationPlayer stationId={id} initialStation={station} />
  );
}
