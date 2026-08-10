/**
 * Server-side geolocation + brief weather for DJ atmosphere prompts.
 *
 * Resolution order for place:
 *   1. Explicit listener `homeCity` (VPN-safe Broadcast City preference)
 *   2. IP geolocation fallback when home city is blank
 *
 * Time-of-day / weekday always come from the client's timezone headers so
 * clock references stay accurate even when the egress IP is elsewhere.
 *
 * Failures always resolve to `null` weather so script generation never depends
 * on external weather providers being healthy.
 */

export type BriefWeather = {
  city: string;
  state: string;
  tempF: number;
  condition: string;
};

export type ClientTimeOfDay = "morning" | "afternoon" | "evening" | "late_night";

/** Clock context derived solely from the client's IANA timezone (never VPN IP). */
export type ClientClockContext = {
  timeOfDay: ClientTimeOfDay;
  dayOfWeek: string;
  timeZone: string | null;
};

export type BriefWeatherRequest = {
  /** Listener Broadcast City preference — wins over IP when non-empty. */
  homeCity?: string | null;
  /** Caller IP for geo fallback when `homeCity` is blank. */
  ipAddress?: string | null;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 5_000;

type CacheEntry = { value: BriefWeather; expiresAt: number };

const weatherCache = new Map<string, CacheEntry>();

/** Pull the caller IP from reverse-proxy headers (first `x-forwarded-for` hop). */
export function extractClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const cfConnecting = headers.get("cf-connecting-ip")?.trim();
  if (cfConnecting) return cfConnecting;

  return null;
}

/**
 * Read the listener's IANA timezone from request headers.
 * Prefer the client-stamped `x-client-timezone` so VPN egress cannot skew daypart.
 */
export function extractClientTimeZone(headers: Headers): string | null {
  const candidates = [
    headers.get("x-client-timezone"),
    headers.get("x-timezone"),
    headers.get("x-vercel-ip-timezone"),
  ];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value || value.length > 80) continue;
    if (!/^[A-Za-z0-9_+\-\/]+$/.test(value)) continue;
    try {
      // Validate IANA zone — throws RangeError for unknowns.
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return value;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function hourToTimeOfDay(hour: number): ClientTimeOfDay {
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 16) return "afternoon";
  if (hour >= 17 && hour <= 20) return "evening";
  return "late_night";
}

function readLocalClockParts(
  now: Date,
  timeZone: string | null,
): { hour: number; dayOfWeek: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hour: "numeric",
      hourCycle: "h23",
      weekday: "long",
    }).formatToParts(now);
    const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
    const dayOfWeek = parts.find((p) => p.type === "weekday")?.value ?? "";
    if (Number.isFinite(hour) && dayOfWeek) {
      return { hour, dayOfWeek };
    }
  } catch {
    // Invalid zone — fall through to host clock.
  }

  return {
    hour: now.getHours(),
    dayOfWeek:
      ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        now.getDay()
      ] ?? "Today",
  };
}

/**
 * Resolve `timeOfDay` + `dayOfWeek` from client timezone headers.
 * Always preferred over IP-derived locale clocks (VPN safeguard).
 */
export function resolveClientClock(
  headers: Headers,
  now: Date = new Date(),
): ClientClockContext {
  const timeZone = extractClientTimeZone(headers);
  const { hour, dayOfWeek } = readLocalClockParts(now, timeZone);
  return {
    timeOfDay: hourToTimeOfDay(hour),
    dayOfWeek,
    timeZone,
  };
}

function isUsablePublicIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (!value || value === "unknown" || value === "::1" || value === "127.0.0.1") {
    return false;
  }
  if (value.startsWith("10.") || value.startsWith("192.168.") || value.startsWith("fc") || value.startsWith("fd")) {
    return false;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return false;
  return true;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** WMO weather interpretation codes → short on-air condition labels. */
function wmoCodeToCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rainy";
  if (code >= 71 && code <= 77) return "Snowy";
  if (code >= 80 && code <= 82) return "Rainy";
  if (code >= 85 && code <= 86) return "Snowy";
  if (code >= 95 && code <= 99) return "Stormy";
  return "Fair";
}

type IpApiCoResponse = {
  error?: boolean;
  reason?: string;
  city?: string | null;
  region?: string | null;
  region_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type IpApiComResponse = {
  status?: string;
  city?: string;
  region?: string;
  regionName?: string;
  lat?: number;
  lon?: number;
};

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
};

type OpenMeteoGeoResult = {
  name?: string;
  admin1?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
};

type OpenMeteoGeoResponse = {
  results?: OpenMeteoGeoResult[];
};

type GeoResult = {
  city: string;
  state: string;
  lat: number;
  lon: number;
};

/** Split `"Salt Lake City, UT"` into city + optional region hint. */
function parseHomeCityQuery(raw: string): { city: string; regionHint: string } {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const comma = trimmed.indexOf(",");
  if (comma <= 0) return { city: trimmed, regionHint: "" };
  return {
    city: trimmed.slice(0, comma).trim(),
    regionHint: trimmed.slice(comma + 1).trim(),
  };
}

function regionMatches(admin1: string | undefined, hint: string): boolean {
  if (!hint) return true;
  if (!admin1) return false;
  const a = admin1.trim().toLowerCase();
  const h = hint.trim().toLowerCase();
  if (!a || !h) return false;
  return a === h || a.startsWith(h) || h.startsWith(a) || a.includes(h) || h.includes(a);
}

/** Geocode an explicit Broadcast City via Open-Meteo (no IP involved). */
async function geocodeHomeCity(homeCity: string): Promise<GeoResult | null> {
  const { city, regionHint } = parseHomeCityQuery(homeCity);
  if (!city) return null;

  const data = await fetchJsonWithTimeout<OpenMeteoGeoResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}`
      + `&count=8&language=en&format=json`,
    PROVIDER_TIMEOUT_MS,
  );
  const results = data?.results;
  if (!Array.isArray(results) || results.length === 0) return null;

  const ranked = [...results].sort((a, b) => {
    const aMatch = regionMatches(a.admin1, regionHint) ? 0 : 1;
    const bMatch = regionMatches(b.admin1, regionHint) ? 0 : 1;
    return aMatch - bMatch;
  });

  const pick = ranked.find(
    (r) =>
      typeof r.latitude === "number"
      && typeof r.longitude === "number"
      && typeof r.name === "string"
      && r.name.trim()
      && (!regionHint || regionMatches(r.admin1, regionHint)),
  ) ?? ranked.find(
    (r) =>
      typeof r.latitude === "number"
      && typeof r.longitude === "number"
      && typeof r.name === "string"
      && r.name.trim(),
  );

  if (!pick || typeof pick.latitude !== "number" || typeof pick.longitude !== "number") {
    return null;
  }

  return {
    city: pick.name!.trim(),
    state: (pick.admin1 || regionHint || "").trim(),
    lat: pick.latitude,
    lon: pick.longitude,
  };
}

async function geolocateIp(ipAddress: string): Promise<GeoResult | null> {
  const ipapi = await fetchJsonWithTimeout<IpApiCoResponse>(
    `https://ipapi.co/${encodeURIComponent(ipAddress)}/json/`,
    PROVIDER_TIMEOUT_MS,
  );
  if (
    ipapi
    && !ipapi.error
    && typeof ipapi.city === "string"
    && ipapi.city.trim()
    && typeof ipapi.latitude === "number"
    && typeof ipapi.longitude === "number"
  ) {
    const state =
      (typeof ipapi.region_code === "string" && ipapi.region_code.trim())
      || (typeof ipapi.region === "string" && ipapi.region.trim())
      || "";
    return {
      city: ipapi.city.trim(),
      state,
      lat: ipapi.latitude,
      lon: ipapi.longitude,
    };
  }

  // Fallback: ip-api.com (HTTP free tier) if ipapi.co is unavailable.
  const ipApi = await fetchJsonWithTimeout<IpApiComResponse>(
    `http://ip-api.com/json/${encodeURIComponent(ipAddress)}?fields=status,city,region,regionName,lat,lon`,
    PROVIDER_TIMEOUT_MS,
  );
  if (
    ipApi?.status === "success"
    && typeof ipApi.city === "string"
    && ipApi.city.trim()
    && typeof ipApi.lat === "number"
    && typeof ipApi.lon === "number"
  ) {
    return {
      city: ipApi.city.trim(),
      state: (ipApi.region || ipApi.regionName || "").trim(),
      lat: ipApi.lat,
      lon: ipApi.lon,
    };
  }

  return null;
}

async function fetchOpenMeteo(
  lat: number,
  lon: number,
): Promise<{ tempF: number; condition: string } | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}`
    + `&longitude=${lon}`
    + `&current=temperature_2m,weather_code`
    + `&temperature_unit=fahrenheit`;

  const data = await fetchJsonWithTimeout<OpenMeteoResponse>(url, PROVIDER_TIMEOUT_MS);
  const temp = data?.current?.temperature_2m;
  const code = data?.current?.weather_code;
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;

  return {
    tempF: Math.round(temp),
    condition: wmoCodeToCondition(typeof code === "number" ? code : -1),
  };
}

function cacheKeyForCity(city: string, state: string): string {
  return `${city.trim().toLowerCase()}|${state.trim().toLowerCase()}`;
}

function readCityCache(city: string, state: string): BriefWeather | null {
  const key = cacheKeyForCity(city, state);
  const hit = weatherCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    weatherCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCityCache(value: BriefWeather): void {
  weatherCache.set(cacheKeyForCity(value.city, value.state), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function weatherForGeo(geo: GeoResult): Promise<BriefWeather | null> {
  const cached = readCityCache(geo.city, geo.state);
  if (cached) return cached;

  const weather = await fetchOpenMeteo(geo.lat, geo.lon);
  if (!weather) return null;

  const brief: BriefWeather = {
    city: geo.city,
    state: geo.state,
    tempF: weather.tempF,
    condition: weather.condition,
  };
  writeCityCache(brief);
  return brief;
}

/**
 * Resolve a brief local weather snapshot.
 * Prefers explicit `homeCity`; falls back to IP geo when blank.
 * Returns `null` on private IPs, timeouts, or provider failures.
 */
export async function getBriefWeather(
  request: BriefWeatherRequest | string,
): Promise<BriefWeather | null> {
  const options: BriefWeatherRequest =
    typeof request === "string" ? { ipAddress: request } : request;

  const homeCity = options.homeCity?.trim();
  if (homeCity) {
    const geo = await geocodeHomeCity(homeCity);
    if (geo) {
      const result = await weatherForGeo(geo);
      console.log("[TELEMETRY: Weather Resolution]", {
        source: homeCity ? "homeCity" : "IP",
        result,
      });
      return result;
    }
    // Geocode failed — still try IP so atmosphere isn't totally blank.
  }

  const ip = options.ipAddress?.trim();
  if (!ip || !isUsablePublicIp(ip)) {
    console.log("[TELEMETRY: Weather Resolution]", {
      source: homeCity ? "homeCity" : "IP",
      result: null,
    });
    return null;
  }

  const geo = await geolocateIp(ip);
  if (!geo) {
    console.log("[TELEMETRY: Weather Resolution]", {
      source: homeCity ? "homeCity" : "IP",
      result: null,
    });
    return null;
  }
  const result = await weatherForGeo(geo);
  console.log("[TELEMETRY: Weather Resolution]", {
    source: homeCity ? "homeCity" : "IP",
    result,
  });
  return result;
}

/**
 * Race weather resolution against a hard deadline so LLM generation is never delayed.
 * Defaults to 800ms as used by `/api/generate-script`.
 */
export async function getBriefWeatherWithin(
  request: BriefWeatherRequest | string | null | undefined,
  deadlineMs = 800,
): Promise<BriefWeather | null> {
  if (request == null) return null;

  const normalized: BriefWeatherRequest =
    typeof request === "string" ? { ipAddress: request } : request;

  const hasHome = Boolean(normalized.homeCity?.trim());
  const hasIp =
    Boolean(normalized.ipAddress)
    && isUsablePublicIp(normalized.ipAddress!);
  if (!hasHome && !hasIp) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getBriefWeather(normalized),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Format a brief snapshot for prompt injection, e.g. `72°F and clear skies`. */
export function formatWeatherForPrompt(weather: BriefWeather): string {
  const condition = weather.condition.trim().toLowerCase();
  const skies =
    condition === "clear" || condition === "sunny" ? "clear skies"
    : condition === "partly cloudy" ? "partly cloudy skies"
    : condition === "overcast" ? "overcast skies"
    : condition;
  return `${weather.tempF}°F and ${skies}`;
}

export function formatLocationForPrompt(weather: BriefWeather): string {
  if (weather.state) return `${weather.city}, ${weather.state}`;
  return weather.city;
}

/** Test helper — clears the in-memory city cache. */
export function clearWeatherCache(): void {
  weatherCache.clear();
}
