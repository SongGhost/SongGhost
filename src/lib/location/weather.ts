/**
 * Server-side IP geolocation + brief weather for DJ atmosphere prompts.
 *
 * Failures always resolve to `null` so script generation never depends on
 * external weather providers being healthy.
 */

export type BriefWeather = {
  city: string;
  state: string;
  tempF: number;
  condition: string;
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

type GeoResult = {
  city: string;
  state: string;
  lat: number;
  lon: number;
};

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

/**
 * Resolve a brief local weather snapshot for the given client IP.
 * Returns `null` on private IPs, timeouts, or provider failures.
 */
export async function getBriefWeather(
  ipAddress: string,
): Promise<BriefWeather | null> {
  if (!isUsablePublicIp(ipAddress)) return null;

  const geo = await geolocateIp(ipAddress.trim());
  if (!geo) return null;

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
 * Race weather resolution against a hard deadline so LLM generation is never delayed.
 * Defaults to 800ms as used by `/api/generate-script`.
 */
export async function getBriefWeatherWithin(
  ipAddress: string | null | undefined,
  deadlineMs = 800,
): Promise<BriefWeather | null> {
  if (!ipAddress || !isUsablePublicIp(ipAddress)) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getBriefWeather(ipAddress),
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
