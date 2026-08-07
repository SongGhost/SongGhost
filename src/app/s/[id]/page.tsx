"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, Mic2, Play, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import { useMusicSource } from "@/context/MusicSourceContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { DEFAULT_PERSONA, getPersonaById, type PersonaId } from "@/data/personas";
import { useStudioStations } from "@/hooks/useStudioStations";
import { useWebOrchestrator } from "@/hooks/useWebOrchestrator";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import {
  BREAK_TIMING_OPTIONS,
  normalizeStudioDjConfig,
  studioManifestToStation,
  type StudioDjBreakCue,
  type StudioStationManifest,
} from "@/lib/studio/manifest";
import { getYouTubeThumbnail } from "@/lib/youtube";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: StudioStationManifest };

type PlaylistRow =
  | { type: "track"; index: number; title: string; artist: string }
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

function buildPlaylistRows(manifest: StudioStationManifest): PlaylistRow[] {
  const breaksByTrack = new Map<number, StudioDjBreakCue[]>();
  const unassigned: StudioDjBreakCue[] = [];

  for (const cue of manifest.djBreaks) {
    if (
      typeof cue.trackIndex === "number" &&
      cue.trackIndex >= 0 &&
      cue.trackIndex < manifest.tracks.length
    ) {
      const list = breaksByTrack.get(cue.trackIndex) ?? [];
      list.push(cue);
      breaksByTrack.set(cue.trackIndex, list);
    } else {
      unassigned.push(cue);
    }
  }

  const rows: PlaylistRow[] = [];
  manifest.tracks.forEach((track, index) => {
    rows.push({
      type: "track",
      index,
      title: track.title,
      artist: track.artist,
    });
    const after = breaksByTrack.get(index);
    if (after) {
      for (const cue of after) {
        rows.push({ type: "break", cue });
      }
    }
  });

  for (const cue of unassigned) {
    rows.push({ type: "break", cue });
  }

  return rows;
}

/**
 * Public recipient player for a shared SongHost Studio mix.
 * Hydrates webOrchestrator from the published station manifest.
 */
export default function SharedStudioMixPage() {
  const params = useParams<{ id: string }>();
  const studioId = typeof params?.id === "string" ? params.id : "";
  const { setDjVolume } = useMusicSource();
  const { setActivePersonaId } = useUserPreferences();
  const { getStudioMix, saveStudioMix } = useStudioStations();
  const {
    setCompanionPersona,
    setCompanionDjTuning,
    setCompanionScriptContext,
  } = useWebOrchestrator();
  const playerRef = useRef<AudioPlayerHandle>(null);
  const hydratedIdRef = useRef<string | null>(null);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasTunedIn, setHasTunedIn] = useState(false);
  const [volume] = useState(0.85);
  const [nowPlaying, setNowPlaying] = useState({
    title: "Waiting to tune in…",
    artist: "",
    youtubeId: "",
  });

  useEffect(() => {
    if (!studioId) {
      setLoadState({ status: "error", message: "Missing studio mix id." });
      return;
    }

    let cancelled = false;

    async function hydrate() {
      setLoadState({ status: "loading" });

      try {
        const res = await fetch(
          `/api/studio/save-station?id=${encodeURIComponent(studioId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          manifest?: StudioStationManifest;
          error?: string;
        };

        if (!res.ok || !data.manifest) {
          // Fall back to a locally cached mix (same browser that published).
          const local = getStudioMix(studioId);
          if (local?.manifest) {
            if (!cancelled) {
              setLoadState({ status: "ready", manifest: local.manifest });
            }
            return;
          }
          throw new Error(data.error ?? "Studio mix not found");
        }

        if (!cancelled) {
          saveStudioMix(data.manifest);
          setLoadState({ status: "ready", manifest: data.manifest });
        }
      } catch (err) {
        if (!cancelled) {
          const local = getStudioMix(studioId);
          if (local?.manifest) {
            setLoadState({ status: "ready", manifest: local.manifest });
            return;
          }
          setLoadState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load studio mix",
          });
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [getStudioMix, saveStudioMix, studioId]);

  const ready =
    loadState.status === "ready" ? loadState.manifest : null;

  const djConfig = useMemo(
    () =>
      ready
        ? normalizeStudioDjConfig(ready.djConfig, DEFAULT_PERSONA.id)
        : normalizeStudioDjConfig(undefined),
    [ready],
  );

  const station = useMemo(
    () => (ready ? studioManifestToStation({ ...ready, djConfig }) : null),
    [djConfig, ready],
  );

  const personaId = djConfig.personaId as PersonaId;
  const creatorName = getPersonaById(personaId)?.name ?? "a SongHost curator";
  const playlistRows = useMemo(
    () => (ready ? buildPlaylistRows(ready) : []),
    [ready],
  );

  /**
   * Hydrate webOrchestrator with the published queue, break cues (as upcoming
   * script context), and embedded djConfig (persona / volume / energy).
   */
  useEffect(() => {
    if (!ready || !station) return;
    if (hydratedIdRef.current === ready.id) return;
    hydratedIdRef.current = ready.id;

    setDjVolume(djConfig.djVolume);
    setActivePersonaId(personaId);
    setCompanionPersona(personaId);
    setCompanionDjTuning({
      mood: djConfig.energy,
      personality: djConfig.sarcasm,
    });

    const upcomingQueue = ready.tracks.map((track) => ({
      title: track.title,
      artist: track.artist,
    }));
    setCompanionScriptContext({
      recentHistory: [],
      upcomingQueue,
    });

    const lead = ready.tracks[0];
    if (lead) {
      setNowPlaying({
        title: lead.title,
        artist: lead.artist,
        youtubeId: lead.youtubeId ?? "",
      });
    }

    if (ready.djBreaks.length > 0) {
      console.log("[SongHost] Recipient player hydrated studio breaks", {
        stationId: ready.id,
        breakCount: ready.djBreaks.length,
        cues: ready.djBreaks.map((cue) => ({
          trackIndex: cue.trackIndex,
          cuePointSec: cue.cuePointSec,
          kind: cue.kind,
          timing: cue.timing,
        })),
      });
    }
  }, [
    djConfig.djVolume,
    djConfig.energy,
    djConfig.sarcasm,
    personaId,
    ready,
    setActivePersonaId,
    setCompanionDjTuning,
    setCompanionPersona,
    setCompanionScriptContext,
    setDjVolume,
    station,
  ]);

  const tuneIn = useCallback(() => {
    if (!station || !ready) return;
    primeAudioOnGesture();
    setHasTunedIn(true);
    setIsPlaying(true);
  }, [ready, station]);

  const albumArt = nowPlaying.youtubeId
    ? getYouTubeThumbnail(nowPlaying.youtubeId)
    : "";

  const heroTitle = ready
    ? `${ready.name} — Curated by ${creatorName}`
    : loadState.status === "loading"
      ? "Loading mix…"
      : "Studio Mix";

  return (
    <div className="relative min-h-screen bg-[#09090b] text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(196,136,42,0.18), transparent 55%), radial-gradient(ellipse 50% 35% at 15% 90%, rgba(39,39,42,0.85), transparent 50%)",
        }}
      />

      <main className="relative mx-auto w-full max-w-2xl px-4 pb-28 pt-10 sm:px-6 sm:pb-32 sm:pt-16">
        {/* Unbranded hero */}
        <header className="mb-10 text-center sm:mb-12">
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl sm:leading-snug">
            {heroTitle}
          </h1>
          {ready?.description && (
            <p className="mx-auto mt-3 max-w-lg font-sans text-sm leading-relaxed text-zinc-500">
              {ready.description}
            </p>
          )}
          {ready && (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              {ready.tracks.length} track
              {ready.tracks.length === 1 ? "" : "s"}
              {ready.djBreaks.length > 0
                ? ` · ${ready.djBreaks.length} custom break${ready.djBreaks.length === 1 ? "" : "s"}`
                : ""}
            </p>
          )}
        </header>

        {loadState.status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-20 font-mono text-xs uppercase tracking-widest text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading station…
          </div>
        )}

        {loadState.status === "error" && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-8 text-center">
            <p className="font-sans text-sm text-red-300" role="alert">
              {loadState.message}
            </p>
            <Link
              href="/studio"
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-widest text-amber-400 hover:text-amber-300"
            >
              Create My Station
            </Link>
          </div>
        )}

        {station && ready && (
          <div className="space-y-8">
            <div className="flex flex-col items-center gap-5">
              <div
                className="h-36 w-36 overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900 shadow-[0_0_48px_rgba(196,136,42,0.12)] sm:h-44 sm:w-44"
                style={
                  albumArt
                    ? {
                        backgroundImage: `url(${albumArt})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
                aria-hidden={!albumArt}
              />

              {(hasTunedIn || isPlaying) && (
                <div className="min-w-0 text-center">
                  <p className="truncate font-sans text-base font-semibold text-zinc-100">
                    {nowPlaying.title}
                  </p>
                  <p className="truncate font-sans text-sm text-zinc-500">
                    {nowPlaying.artist}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={tuneIn}
                disabled={isPlaying}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-amber-500 px-8 py-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-950 shadow-[0_0_32px_rgba(245,158,11,0.35)] transition-colors hover:bg-amber-400 disabled:cursor-default disabled:bg-amber-500/80"
              >
                {isPlaying ? (
                  "On Air"
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    Tune In Now
                  </>
                )}
              </button>
            </div>

            {/* Track listing with DJ break indicators */}
            <section aria-labelledby="track-list-heading">
              <div className="mb-3 flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-amber-500/80" aria-hidden="true" />
                <h2
                  id="track-list-heading"
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500"
                >
                  Track listing
                </h2>
              </div>
              <ol className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#0e0e11]/80">
                {playlistRows.map((row, rowIndex) => {
                  if (row.type === "break") {
                    return (
                      <li
                        key={`break-${rowIndex}-${row.cue.cuePointSec}`}
                        className="flex items-center gap-3 border-t border-amber-500/15 bg-amber-500/[0.06] px-4 py-2.5"
                      >
                        <Mic2
                          className="h-3.5 w-3.5 shrink-0 text-amber-400"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-amber-300/90">
                            {breakLabel(row.cue)}
                          </p>
                          <p className="font-mono text-[10px] text-zinc-600">
                            Cue {Math.round(row.cue.cuePointSec)}s
                            {row.cue.kind ? ` · ${row.cue.kind.replace(/_/g, " ")}` : ""}
                          </p>
                        </div>
                      </li>
                    );
                  }

                  const isCurrent =
                    hasTunedIn &&
                    nowPlaying.title === row.title &&
                    nowPlaying.artist === row.artist;

                  return (
                    <li
                      key={`track-${row.index}`}
                      className={[
                        "flex items-start gap-3 px-4 py-3",
                        rowIndex > 0 ? "border-t border-white/[0.05]" : "",
                        isCurrent ? "bg-white/[0.03]" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className="w-6 shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-zinc-600">
                        {String(row.index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={[
                            "truncate font-sans text-sm font-medium",
                            isCurrent ? "text-amber-200" : "text-zinc-200",
                          ].join(" ")}
                        >
                          {row.title}
                        </p>
                        <p className="truncate font-sans text-xs text-zinc-500">
                          {row.artist}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <div className="sr-only">
              <AudioPlayer
                ref={playerRef}
                stationId={station.id}
                songTitle={nowPlaying.title}
                artistName={nowPlaying.artist}
                personaId={personaId}
                stationName={station.name}
                vibePrompt={djConfig.customDirectives}
                isPlaying={isPlaying}
                volume={volume}
                stationQueueMode
                stationTracks={station.tracks}
                queueGeneration={hasTunedIn ? 1 : 0}
                onTrackChange={(track) => {
                  setNowPlaying({
                    title: track.title,
                    artist: track.artist,
                    youtubeId: track.youtubeId,
                  });
                  setCompanionScriptContext({
                    recentHistory: [
                      { title: track.title, artist: track.artist },
                    ],
                    upcomingQueue: ready.tracks
                      .slice(
                        Math.max(
                          0,
                          ready.tracks.findIndex(
                            (t) =>
                              t.title === track.title &&
                              t.artist === track.artist,
                          ) + 1,
                        ),
                      )
                      .map((t) => ({ title: t.title, artist: t.artist })),
                  });
                }}
                onPlayingChange={setIsPlaying}
              />
            </div>
          </div>
        )}
      </main>

      {/* Viral onboarding banner */}
      <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-500/25 bg-[#0c0c0f]/95 px-4 py-3 shadow-[0_-8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-center font-sans text-sm leading-snug text-zinc-300 sm:text-left">
            Enjoying this show? Build your own dynamic radio station with{" "}
            <span className="font-semibold text-amber-300">SongHost</span>.
          </p>
          <Link
            href="/studio"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-amber-500/25 hover:text-amber-200"
          >
            Create My Station
          </Link>
        </div>
      </aside>
    </div>
  );
}
