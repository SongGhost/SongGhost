"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { BookmarkPlus, Loader2, Mic2, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { DEFAULT_PERSONA, getPersonaById, type PersonaId } from "@/data/personas";
import type { Station } from "@/data/stations";
import { useStudioStations } from "@/hooks/useStudioStations";
import {
  BREAK_TIMING_OPTIONS,
  normalizeStudioDjConfig,
  resolveStudioBreakSessionTrigger,
  studioManifestToStation,
  type StudioDjBreakCue,
  type StudioStationManifest,
} from "@/lib/studio/manifest";
import type { PublicStation } from "@/lib/station/public-station";
import { MEMORY_PRESET_COUNT } from "@/types/station";
import { getYouTubeThumbnail } from "@/lib/youtube";

export type PublicStationPlayerProps = {
  stationId: string;
  /** Server-resolved payload from `generateMetadata` / RSC fetch. */
  initialStation?: PublicStation | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; publicStation: PublicStation };

type PlaylistRow =
  | { type: "now_playing"; title: string; artist: string }
  | { type: "upcoming"; label: string; subtitle: string }
  | { type: "break"; cue: StudioDjBreakCue };

function breakLabel(cue: StudioDjBreakCue): string {
  if (cue.label?.trim()) return cue.label.trim();
  if (cue.timing) {
    const timing = BREAK_TIMING_OPTIONS.find((opt) => opt.id === cue.timing);
    if (timing) return timing.label;
  }
  if (cue.kind === "call_in") return "Caller break";
  if (cue.kind === "stinger") return "Station ID";
  if (cue.kind === "song_intro") return "Song intro";
  return "DJ break";
}

function buildPlaylistRows(
  manifest: StudioStationManifest,
  nowPlaying?: { title: string; artist: string } | null,
): PlaylistRow[] {
  const rows: PlaylistRow[] = [];
  if (nowPlaying?.title) {
    rows.push({
      type: "now_playing",
      title: nowPlaying.title,
      artist: nowPlaying.artist,
    });
  }
  rows.push({
    type: "upcoming",
    label: "Up Next: Smart Station Stream",
    subtitle: "Smart Station Stream",
  });
  rows.push({
    type: "upcoming",
    label: "Later in the Stream",
    subtitle: "Smart Station Stream",
  });

  for (const cue of manifest.djBreaks ?? []) {
    if (cue.kind === "call_in" || cue.audioUrl || cue.customText) {
      rows.push({ type: "break", cue });
    }
  }
  return rows;
}

function publicFromLocalManifest(
  manifest: StudioStationManifest,
): PublicStation {
  const djConfig = normalizeStudioDjConfig(
    manifest.djConfig,
    DEFAULT_PERSONA.id,
  );
  const normalized = { ...manifest, djConfig };
  const station = studioManifestToStation(normalized);
  return {
    id: normalized.id,
    name: normalized.name,
    description: normalized.description?.trim() || station.description,
    coverImageUrl: normalized.coverImageUrl?.trim() || null,
    hostPersonaId: djConfig.personaId,
    hostName: getPersonaById(djConfig.personaId)?.name ?? "SongHost",
    seedArtists: normalized.seedArtists?.length
      ? normalized.seedArtists
      : station.tracks
          .map((track) => track.artist)
          .filter(Boolean)
          .filter((artist, index, all) => all.indexOf(artist) === index)
          .slice(0, 4),
    genres: normalized.seedGenres?.length ? normalized.seedGenres : ["Studio mix"],
    source: "studio",
    station,
    studioManifest: normalized,
  };
}

/**
 * Public shared-station player for `/s/[id]`.
 * Shared blueprints launch a DirectStream statutory session via `/?station=`.
 */
export default function PublicStationPlayer({
  stationId,
  initialStation = null,
}: PublicStationPlayerProps) {
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const {
    memoryPresets,
    saveStation,
    parkMemoryPreset,
  } = useUserPreferences();
  const { getStudioMix, saveStudioMix } = useStudioStations();
  const getStudioMixRef = useRef(getStudioMix);
  const saveStudioMixRef = useRef(saveStudioMix);
  getStudioMixRef.current = getStudioMix;
  saveStudioMixRef.current = saveStudioMix;

  const [loadState, setLoadState] = useState<LoadState>(() =>
    initialStation
      ? { status: "ready", publicStation: initialStation }
      : { status: "loading" },
  );
  const [saveToast, setSaveToast] = useState<string | null>(null);

  useEffect(() => {
    if (!stationId) {
      setLoadState({ status: "error", message: "Missing station id." });
      return;
    }

    if (initialStation && initialStation.id === stationId) {
      if (initialStation.studioManifest) {
        saveStudioMixRef.current(initialStation.studioManifest);
      }
      setLoadState({ status: "ready", publicStation: initialStation });
      return;
    }

    let cancelled = false;

    async function hydrate() {
      setLoadState({ status: "loading" });

      try {
        const res = await fetch(
          `/api/station/${encodeURIComponent(stationId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          station?: PublicStation | null;
          error?: string | null;
        };

        if (res.ok && data.station) {
          if (!cancelled) {
            if (data.station.studioManifest) {
              saveStudioMixRef.current(data.station.studioManifest);
            }
            setLoadState({ status: "ready", publicStation: data.station });
          }
          return;
        }

        const local = getStudioMixRef.current(stationId);
        if (local?.manifest) {
          if (!cancelled) {
            setLoadState({
              status: "ready",
              publicStation: publicFromLocalManifest(local.manifest),
            });
          }
          return;
        }

        throw new Error(data.error ?? "Station not found");
      } catch (err) {
        if (!cancelled) {
          const local = getStudioMixRef.current(stationId);
          if (local?.manifest) {
            setLoadState({
              status: "ready",
              publicStation: publicFromLocalManifest(local.manifest),
            });
            return;
          }
          setLoadState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load station",
          });
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [stationId, initialStation]);

  useEffect(() => {
    if (!saveToast) return;
    const id = window.setTimeout(() => setSaveToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [saveToast]);

  const publicStation =
    loadState.status === "ready" ? loadState.publicStation : null;
  const ready = publicStation?.studioManifest ?? null;
  const playableStation: Station | null = publicStation?.station ?? null;

  const djConfig = useMemo(
    () =>
      ready
        ? normalizeStudioDjConfig(ready.djConfig, DEFAULT_PERSONA.id)
        : normalizeStudioDjConfig(
            undefined,
            publicStation?.hostPersonaId ?? DEFAULT_PERSONA.id,
          ),
    [ready, publicStation?.hostPersonaId],
  );

  const personaId = (djConfig.personaId ||
    publicStation?.hostPersonaId ||
    DEFAULT_PERSONA.id) as PersonaId;
  const creatorName =
    publicStation?.hostName ??
    getPersonaById(personaId)?.name ??
    "a SongHost curator";
  const playlistRows = useMemo(
    () => (ready ? buildPlaylistRows(ready) : []),
    [ready],
  );

  const heroTitle = publicStation
    ? `${publicStation.name} — Curated by ${creatorName}`
    : "SongHost Station";

  const handleSaveToMyRadio = useCallback(() => {
    if (!playableStation) return;

    saveStation(playableStation);

    const emptyIndex = memoryPresets.findIndex((preset) => preset == null);
    if (emptyIndex < 0) {
      setSaveToast("All 6 memory presets are full — clear a slot first");
      return;
    }

    const slot = emptyIndex + 1;
    parkMemoryPreset(
      slot,
      {
        stationId: playableStation.id,
        stationName: playableStation.name,
        frequency: playableStation.frequency,
        accentColor: playableStation.accentColor,
        personaId: playableStation.defaultPersonaId,
      },
      playableStation,
    );
    setSaveToast(`Saved to memory preset ${slot} of ${MEMORY_PRESET_COUNT}`);
  }, [memoryPresets, parkMemoryPreset, playableStation, saveStation]);

  const saveToMyRadioButton = (
    <div className="flex flex-col items-center gap-2">
      {authLoaded && isSignedIn ? (
        <button
          type="button"
          onClick={handleSaveToMyRadio}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-6 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
        >
          <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
          Save to My Radio
        </button>
      ) : (
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-6 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent transition hover:bg-accent/25"
          >
            <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
            Sign in to Save
          </button>
        </SignInButton>
      )}
    </div>
  );

  const listenHref = publicStation
    ? `/?station=${encodeURIComponent(publicStation.id)}`
    : "/";

  const albumArt =
    publicStation?.coverImageUrl ||
    ready?.coverImageUrl ||
    (playableStation?.youtubeVideoId
      ? getYouTubeThumbnail(playableStation.youtubeVideoId)
      : "");

  const saveToastNode = saveToast ? (
    <p
      role="status"
      className="pointer-events-none fixed bottom-20 left-1/2 z-[100] -translate-x-1/2 rounded-md border border-white/10 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-200 shadow-lg backdrop-blur-sm"
    >
      {saveToast}
    </p>
  ) : null;

  if (loadState.status === "loading") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[#09090b] text-zinc-100">
        <div
          className="pointer-events-none fixed inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(41, 146, 207,0.22), transparent 55%)",
          }}
        />
        <div
          className="relative flex flex-col items-center gap-4"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="h-10 w-10 animate-spin text-accent drop-shadow-[0_0_12px_rgba(41, 146, 207,0.55)]"
            aria-hidden="true"
          />
          <p className="font-mono text-xs font-bold uppercase tracking-[0.28em] text-zinc-100">
            Loading station…
          </p>
        </div>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[#09090b] px-4 text-zinc-100">
        <div
          className="pointer-events-none fixed inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 70% 45% at 50% 0%, rgba(127,29,29,0.25), transparent 55%)",
          }}
        />
        <div className="relative w-full max-w-md rounded-2xl border border-red-500/35 bg-[#120a0a]/95 px-6 py-10 text-center shadow-[0_0_48px_rgba(127,29,29,0.25)]">
          <p className="font-mono text-5xl font-bold tracking-tight text-red-400">
            404
          </p>
          <h1 className="mt-4 font-sans text-xl font-semibold text-zinc-50">
            Station not found
          </h1>
          <p className="mt-2 font-sans text-sm text-zinc-400" role="alert">
            {loadState.message}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            Invalid or expired station id
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover"
          >
            Back to SongHost
          </Link>
        </div>
      </div>
    );
  }

  if (!publicStation) {
    return null;
  }

  const featuring =
    publicStation.seedArtists.length > 0
      ? publicStation.seedArtists.join(", ")
      : publicStation.genres.join(", ");

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#09090b] px-4 text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-90"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(41, 146, 207,0.22), transparent 55%), radial-gradient(ellipse 50% 35% at 15% 90%, rgba(39,39,42,0.85), transparent 50%)",
        }}
      />
      <main className="relative mx-auto w-full max-w-lg pb-16 text-center">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-accent/80">
          SongHost
        </p>
        {albumArt ? (
          <div
            className="mx-auto mb-8 mt-6 h-40 w-40 overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900 shadow-[0_0_56px_rgba(41, 146, 207,0.18)]"
            style={{
              backgroundImage: `url(${albumArt})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            aria-hidden="true"
          />
        ) : (
          <div className="mx-auto mb-8 mt-6 flex h-40 w-40 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10">
            <Radio className="h-10 w-10 text-accent" aria-hidden="true" />
          </div>
        )}

        <h1 className="font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl sm:leading-snug">
          {heroTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-md font-sans text-base leading-relaxed text-zinc-400">
          Hosted by {creatorName}. A custom AI radio station featuring {featuring}.
        </p>
        <p className="mx-auto mt-2 max-w-md font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          Live statutory stream
        </p>

        <div className="mt-8 flex flex-col items-stretch gap-3 sm:items-center">
          <Link
            href={listenHref}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accent px-8 py-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-950 shadow-[0_0_32px_var(--brand-accent-glow)] transition-colors hover:bg-accent-hover"
          >
            ▶ Listen on SongHost
          </Link>
          {saveToMyRadioButton}
        </div>

        {playlistRows.length > 0 && (
          <section className="mt-10 text-left" aria-labelledby="stream-list-heading">
            <div className="mb-3 flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-accent/80" aria-hidden="true" />
              <h2
                id="stream-list-heading"
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500"
              >
                On this stream
              </h2>
            </div>
            <ol className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#0e0e11]/80">
              {playlistRows.map((row, rowIndex) => {
                if (row.type === "break") {
                  const trigger = resolveStudioBreakSessionTrigger(row.cue);
                  return (
                    <li
                      key={`break-${rowIndex}-${row.cue.cuePointSec}`}
                      className="flex items-center gap-3 border-t border-accent/15 bg-accent/[0.06] px-4 py-2.5"
                    >
                      <Mic2
                        className="h-3.5 w-3.5 shrink-0 text-accent"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-accent/90">
                          {breakLabel(row.cue)}
                        </p>
                        <p className="font-mono text-[10px] text-zinc-600">
                          {trigger.replace(/_/g, " ")}
                          {row.cue.kind ? ` · ${row.cue.kind.replace(/_/g, " ")}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                }

                if (row.type === "now_playing") {
                  return (
                    <li
                      key="now-playing"
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      <span className="w-6 shrink-0 pt-0.5 font-mono text-[10px] text-accent">
                        ▶
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-sans text-sm font-medium text-accent">
                          {row.title}
                        </p>
                        <p className="truncate font-sans text-xs text-zinc-500">
                          {row.artist}
                        </p>
                      </div>
                    </li>
                  );
                }

                return (
                  <li
                    key={`upcoming-${rowIndex}`}
                    className={[
                      "flex items-start gap-3 px-4 py-3",
                      rowIndex > 0 ? "border-t border-white/[0.05]" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="w-6 shrink-0 pt-0.5 font-mono text-[10px] text-zinc-600">
                      {rowIndex === 0 ? "…" : "·"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-sans text-sm font-medium text-zinc-500">
                        {row.label}
                      </p>
                      <p className="truncate font-sans text-xs text-zinc-600">
                        {row.subtitle}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </main>
      {saveToastNode}
    </div>
  );
}
