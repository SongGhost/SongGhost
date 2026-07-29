"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalConcertEvent } from "@/types/dj";

export type ListenerLocation = {
  lat: number;
  lng: number;
  city?: string;
};

const STORAGE_KEY = "songghost-listener-location";

function readCachedLocation(): ListenerLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ListenerLocation;
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedLocation(location: ListenerLocation) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(location));
}

async function reverseGeocodeCity(lat: number, lng: number): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      address?: { city?: string; town?: string; village?: string; state?: string };
    };
    const addr = data.address;
    return addr?.city ?? addr?.town ?? addr?.village ?? addr?.state;
  } catch {
    return undefined;
  }
}

export function useListenerLocation() {
  const [location, setLocation] = useState<ListenerLocation | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "granted" | "denied">("idle");
  const requestedRef = useRef(false);

  useEffect(() => {
    const cached = readCachedLocation();
    if (cached) {
      setLocation(cached);
      setStatus("granted");
    }
  }, []);

  const requestLocation = useCallback(() => {
    if (requestedRef.current || typeof navigator === "undefined" || !navigator.geolocation) {
      return;
    }
    requestedRef.current = true;
    setStatus("pending");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const next: ListenerLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        next.city = await reverseGeocodeCity(next.lat, next.lng);
        writeCachedLocation(next);
        setLocation(next);
        setStatus("granted");
      },
      () => {
        setStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600_000 },
    );
  }, []);

  return { location, status, requestLocation };
}

export async function fetchArtistLocalEvent(
  artist: string,
  location: ListenerLocation,
): Promise<LocalConcertEvent | null> {
  try {
    const params = new URLSearchParams({
      artist,
      lat: String(location.lat),
      lng: String(location.lng),
    });
    const res = await fetch(`/api/artist-events?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { event?: LocalConcertEvent | null };
    return data.event ?? null;
  } catch {
    return null;
  }
}
