import type { LocalConcertEvent } from "@/types/dj";

type TicketmasterEvent = {
  name?: string;
  dates?: { start?: { localDate?: string; dateTBD?: boolean } };
  _embedded?: {
    venues?: { name?: string; city?: { name?: string } }[];
    /** Ticketmaster's artist entities — more reliable than the event title */
    attractions?: { name?: string }[];
  };
};

type TicketmasterResponse = {
  _embedded?: { events?: TicketmasterEvent[] };
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { value: LocalConcertEvent | null; expiresAt: number }>();

/** Warn once per process rather than on every track */
let missingKeyWarned = false;

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;

/**
 * Strip leading articles and punctuation so "The Doors" matches "Doors" and vice versa.
 * Without this, first-word matching on "The …" bands matches almost any event.
 */
export function normalizeArtistName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(LEADING_ARTICLE, "")
    .trim();
}

/** Prefer Ticketmaster's attraction entities, falling back to the event title. */
export function eventMatchesArtist(event: TicketmasterEvent, artist: string): boolean {
  const target = normalizeArtistName(artist);
  if (!target) return false;

  const candidates = [
    ...(event._embedded?.attractions?.map((attraction) => attraction.name) ?? []),
    event.name,
  ];

  return candidates.some((candidate) => {
    if (!candidate) return false;
    const normalized = normalizeArtistName(candidate);
    if (!normalized) return false;
    return normalized === target || normalized.includes(target);
  });
}

function cacheKey(artist: string, lat: number, lng: number): string {
  return `${normalizeArtistName(artist)}::${lat.toFixed(1)}::${lng.toFixed(1)}`;
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
  if (!apiKey) {
    if (!missingKeyWarned) {
      missingKeyWarned = true;
      console.warn(
        "[artist-events] TICKETMASTER_API_KEY is not set — local concert mentions are disabled.",
      );
    }
    return null;
  }

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

    for (const event of data._embedded?.events ?? []) {
      if (!eventMatchesArtist(event, artist)) continue;

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
