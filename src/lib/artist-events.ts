import type { LocalConcertEvent } from "@/types/dj";

type TicketmasterEvent = {
  name?: string;
  dates?: { start?: { localDate?: string; dateTBD?: boolean } };
  _embedded?: {
    venues?: { name?: string; city?: { name?: string } }[];
  };
};

type TicketmasterResponse = {
  _embedded?: { events?: TicketmasterEvent[] };
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { value: LocalConcertEvent | null; expiresAt: number }>();

function cacheKey(artist: string, lat: number, lng: number): string {
  return `${artist.toLowerCase()}::${lat.toFixed(1)}::${lng.toFixed(1)}`;
}

function formatDateLabel(isoDate: string): string {
  try {
    const date = new Date(`${isoDate}T12:00:00`);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function parseEvent(event: TicketmasterEvent, artist: string): LocalConcertEvent | null {
  const localDate = event.dates?.start?.localDate;
  if (!localDate || event.dates?.start?.dateTBD) return null;

  const eventDate = new Date(`${localDate}T12:00:00`);
  const now = new Date();
  const threeMonthsOut = new Date(now);
  threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);

  if (eventDate < now || eventDate > threeMonthsOut) return null;

  const venue = event._embedded?.venues?.[0];
  const venueName = venue?.name?.trim();
  const city = venue?.city?.name?.trim();
  if (!venueName || !city) return null;

  return {
    artist,
    venue: venueName,
    city,
    dateLabel: formatDateLabel(localDate),
  };
}

export async function findNearbyArtistEvent(
  artist: string,
  lat: number,
  lng: number,
): Promise<LocalConcertEvent | null> {
  const apiKey = process.env.TICKETMASTER_API_KEY?.trim();
  if (!apiKey) return null;

  const key = cacheKey(artist, lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    keyword: artist,
    latlong: `${lat},${lng}`,
    radius: "150",
    unit: "miles",
    sort: "date,asc",
    size: "10",
    classificationName: "music",
  });

  try {
    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const data = (await res.json()) as TicketmasterResponse;
    const normArtist = artist.toLowerCase();

    for (const event of data._embedded?.events ?? []) {
      const name = event.name?.toLowerCase() ?? "";
      if (!name.includes(normArtist.split(/\s+/)[0] ?? normArtist)) continue;

      const parsed = parseEvent(event, artist);
      if (parsed) {
        cache.set(key, { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS });
        return parsed;
      }
    }

    cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  } catch (error) {
    console.warn("[artist-events] Ticketmaster lookup failed:", error);
    cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }
}
