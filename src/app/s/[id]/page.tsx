"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, Pause, Play, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import BrandHeader from "@/components/layout/Header";
import { useMusicSource } from "@/context/MusicSourceContext";
import { DEFAULT_PERSONA, getPersonaById, type PersonaId } from "@/data/personas";
import { useStudioStations } from "@/hooks/useStudioStations";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import {
  normalizeStudioDjConfig,
  studioManifestToStation,
  type StudioStationManifest,
} from "@/lib/studio/manifest";
import { getYouTubeThumbnail } from "@/lib/youtube";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: StudioStationManifest };

/**
 * Shared SongHost Studio Mix player — hydrates a published station by id.
 */
export default function SharedStudioMixPage() {
  const params = useParams<{ id: string }>();
  const studioId = typeof params?.id === "string" ? params.id : "";
  const { setDjVolume } = useMusicSource();
  const { getStudioMix, saveStudioMix } = useStudioStations();
  const playerRef = useRef<AudioPlayerHandle>(null);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [nowPlaying, setNowPlaying] = useState({
    title: "Loading mix…",
    artist: "SongHost Studio",
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

      const local = getStudioMix(studioId);
      if (local?.manifest) {
        if (!cancelled) {
          setLoadState({ status: "ready", manifest: local.manifest });
        }
        return;
      }

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
          throw new Error(data.error ?? "Studio mix not found");
        }

        if (!cancelled) {
          saveStudioMix(data.manifest);
          setLoadState({ status: "ready", manifest: data.manifest });
        }
      } catch (err) {
        if (!cancelled) {
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
  const hostName = getPersonaById(personaId)?.name ?? "Host";

  useEffect(() => {
    if (!ready) return;
    setDjVolume(djConfig.djVolume);
    const lead = ready.tracks[0];
    if (lead) {
      setNowPlaying({
        title: lead.title,
        artist: lead.artist,
        youtubeId: lead.youtubeId ?? "",
      });
    }
  }, [djConfig.djVolume, ready, setDjVolume]);

  const togglePlay = useCallback(() => {
    primeAudioOnGesture();
    setIsPlaying((prev) => !prev);
  }, []);

  const albumArt = nowPlaying.youtubeId
    ? getYouTubeThumbnail(nowPlaying.youtubeId)
    : "";

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(196,136,42,0.22), transparent 55%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(39,39,42,0.9), transparent 50%)",
        }}
      />

      <div className="relative border-b border-zinc-800/80 px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <BrandHeader
            actions={
              <Link
                href="/"
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-amber-400"
              >
                ← Home
              </Link>
            }
          />
        </div>
      </div>

      <main className="relative mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-zinc-950/90 to-zinc-950 px-5 py-6 shadow-[0_0_40px_rgba(245,158,11,0.12)] sm:px-8 sm:py-8">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-amber-400">
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            SongHost Studio Mix
          </p>
          <h1 className="mt-3 font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {ready?.name ?? (loadState.status === "loading" ? "Loading…" : "Studio Mix")}
          </h1>
          <p className="mt-2 max-w-xl font-sans text-sm leading-relaxed text-zinc-400">
            {ready?.description ??
              "A curated digital stream with embedded host settings and authored breaks."}
          </p>
          {ready && (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Hosted by {hostName} · {ready.tracks.length} track
              {ready.tracks.length === 1 ? "" : "s"}
              {ready.djBreaks.length > 0
                ? ` · ${ready.djBreaks.length} break${ready.djBreaks.length === 1 ? "" : "s"}`
                : ""}
            </p>
          )}
        </div>

        {loadState.status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 font-mono text-xs uppercase tracking-widest text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading mix…
          </div>
        )}

        {loadState.status === "error" && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-6 text-center">
            <p className="font-sans text-sm text-red-300" role="alert">
              {loadState.message}
            </p>
            <Link
              href="/studio"
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-widest text-amber-400 hover:text-amber-300"
            >
              Open SongHost Studio
            </Link>
          </div>
        )}

        {station && ready && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-[#121215]/90 p-4 sm:p-5">
              <div
                className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-900 sm:h-24 sm:w-24"
                style={
                  albumArt
                    ? {
                        backgroundImage: `url(${albumArt})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-base font-semibold text-zinc-100">
                  {nowPlaying.title}
                </p>
                <p className="truncate font-sans text-sm text-zinc-500">
                  {nowPlaying.artist}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-amber-400"
                  >
                    {isPlaying ? (
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {isPlaying ? "Pause" : "Play Mix"}
                  </button>
                  <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    Vol
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(volume * 100)}
                      onChange={(e) => setVolume(Number(e.target.value) / 100)}
                      className="volume-range h-1.5 w-24 rounded-lg accent-amber-500"
                      aria-label="Mix volume"
                    />
                  </label>
                </div>
              </div>
            </div>

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
                queueGeneration={1}
                onTrackChange={(track) => {
                  setNowPlaying({
                    title: track.title,
                    artist: track.artist,
                    youtubeId: track.youtubeId,
                  });
                }}
                onPlayingChange={setIsPlaying}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
