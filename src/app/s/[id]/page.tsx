"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, Mic2, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  getValidSpotifyAccessToken,
  searchSpotifyTrackUri,
} from "@/lib/player/spotifyRemote";
import { getYouTubeThumbnail } from "@/lib/youtube";

const SPOTIFY_LAUNCH_URI_COUNT = 30;

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
 * Gates on Spotify Premium / Apple Music, then hydrates webOrchestrator.
 */
export default function SharedStudioMixPage() {
  const params = useParams<{ id: string }>();
  const studioId = typeof params?.id === "string" ? params.id : "";

  const {
    isConnected,
    isConnecting,
    activeProvider,
    connectSpotify,
    connectApple,
    setDjVolume,
  } = useMusicSource();
  const isSpotifyConnected = activeProvider === "spotify";
  const isAppleMusicConnected = activeProvider === "apple_music";
  const hasStreamingSession =
    isConnected && (isSpotifyConnected || isAppleMusicConnected);

  const { setActivePersonaId } = useUserPreferences();
  const { getStudioMix, saveStudioMix } = useStudioStations();
  const {
    companionActive,
    companionNowPlaying,
    companionPlayback,
    companionNotice,
    dismissCompanionNotice,
    launchStation,
    launchCompanionTrack,
    setCompanionPersona,
    setCompanionDjTuning,
    setCompanionScriptContext,
    loadStudioManifestBreaks,
    startSpotifyPlaybackMonitor,
    beginStationLaunchLock,
  } = useWebOrchestrator();

  const hydratedIdRef = useRef<string | null>(null);
  const getStudioMixRef = useRef(getStudioMix);
  const saveStudioMixRef = useRef(saveStudioMix);
  getStudioMixRef.current = getStudioMix;
  saveStudioMixRef.current = saveStudioMix;

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [showNoAccountFallback, setShowNoAccountFallback] = useState(false);
  const [isTuningIn, setIsTuningIn] = useState(false);
  const [hasTunedIn, setHasTunedIn] = useState(false);
  const [tuneError, setTuneError] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState({
    title: "Waiting to tune in…",
    artist: "",
    youtubeId: "",
  });

  // Resolve route id → published station manifest (API, then local cache).
  useEffect(() => {
    if (!studioId) {
      setLoadState({ status: "error", message: "Missing station id." });
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
          const local = getStudioMixRef.current(studioId);
          if (local?.manifest) {
            if (!cancelled) {
              setLoadState({ status: "ready", manifest: local.manifest });
            }
            return;
          }
          throw new Error(data.error ?? "Station not found");
        }

        if (!cancelled) {
          saveStudioMixRef.current(data.manifest);
          setLoadState({ status: "ready", manifest: data.manifest });
        }
      } catch (err) {
        if (!cancelled) {
          const local = getStudioMixRef.current(studioId);
          if (local?.manifest) {
            setLoadState({ status: "ready", manifest: local.manifest });
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
  }, [studioId]);

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

  const heroTitle = ready
    ? `${ready.name} — Curated by ${creatorName}`
    : "Studio Mix";

  /**
   * Once the recipient is authenticated, hydrate webOrchestrator with the
   * published queue, break cues (script context), and embedded djConfig.
   */
  useEffect(() => {
    if (!hasStreamingSession) {
      hydratedIdRef.current = null;
      return;
    }
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

    // Arm authored break cues (pre-rendered audioUrl / customText+voiceId).
    loadStudioManifestBreaks({
      tracks: ready.tracks.map((track) => ({
        title: track.title,
        artist: track.artist,
        youtubeId: track.youtubeId,
      })),
      djBreaks: ready.djBreaks,
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
        djConfig: {
          personaId: djConfig.personaId,
          energy: djConfig.energy,
          sarcasm: djConfig.sarcasm,
          djVolume: djConfig.djVolume,
        },
        cues: ready.djBreaks.map((cue) => ({
          trackIndex: cue.trackIndex,
          cuePointSec: cue.cuePointSec,
          kind: cue.kind,
          timing: cue.timing,
          audioUrl: cue.audioUrl ? "[set]" : undefined,
          customText: cue.customText ? "[set]" : undefined,
          voiceId: cue.voiceId ? "[set]" : undefined,
        })),
      });
    }
  }, [
    djConfig.djVolume,
    djConfig.energy,
    djConfig.personaId,
    djConfig.sarcasm,
    hasStreamingSession,
    loadStudioManifestBreaks,
    personaId,
    ready,
    setActivePersonaId,
    setCompanionDjTuning,
    setCompanionPersona,
    setCompanionScriptContext,
    setDjVolume,
    station,
  ]);

  // Mirror live companion metadata into the local now-playing strip.
  useEffect(() => {
    if (!companionNowPlaying?.title) return;
    setNowPlaying((prev) => ({
      title: companionNowPlaying.title,
      artist: companionNowPlaying.artist,
      youtubeId: companionNowPlaying.youtubeId ?? prev.youtubeId,
    }));
  }, [companionNowPlaying]);

  const isPlaybackActive = Boolean(
    hasTunedIn &&
      (companionPlayback?.isPlaying ||
        companionActive ||
        isTuningIn),
  );

  const tuneIn = useCallback(async () => {
    if (!station || !ready || !hasStreamingSession || isTuningIn) return;

    primeAudioOnGesture();
    setTuneError(null);
    setIsTuningIn(true);
    setHasTunedIn(true);

    const lead = ready.tracks[0];
    if (!lead) {
      setTuneError("This station has no tracks.");
      setIsTuningIn(false);
      return;
    }

    const seed = {
      trackId: lead.youtubeId || `${lead.artist}:${lead.title}`,
      title: lead.title,
      artist: lead.artist,
    };

    const scriptContext = {
      recentHistory: [] as { title: string; artist: string }[],
      upcomingQueue: ready.tracks.slice(1).map((track) => ({
        title: track.title,
        artist: track.artist,
      })),
    };

    // Re-arm break cues immediately before launch in case the orchestrator
    // was recreated after the hydrate effect.
    loadStudioManifestBreaks({
      tracks: ready.tracks.map((track) => ({
        title: track.title,
        artist: track.artist,
        youtubeId: track.youtubeId,
      })),
      djBreaks: ready.djBreaks,
    });

    try {
      if (activeProvider === "spotify") {
        const token = await getValidSpotifyAccessToken();
        if (!token) {
          setTuneError("Spotify session expired — reconnect to tune in.");
          setIsTuningIn(false);
          return;
        }

        const stationTracks = ready.tracks.slice(0, SPOTIFY_LAUNCH_URI_COUNT);
        const resolved = await Promise.all(
          stationTracks.map((track) =>
            searchSpotifyTrackUri(token, track.title, track.artist),
          ),
        );
        const uris = resolved.filter((uri): uri is string => Boolean(uri));

        if (uris.length === 0) {
          setTuneError("Could not match this playlist on Spotify.");
          setIsTuningIn(false);
          return;
        }

        beginStationLaunchLock(uris);
        startSpotifyPlaybackMonitor({
          onTrackEnded: (ended) => {
            // Shared playlist pages rely on Spotify's URI list + registerTrack
            // for mid-queue hops; when the SDK stalls after the last URI, log
            // so Connect / Web Playback gaps are visible in TRACE.
            console.log(
              "[LinerLore TRACE] Shared station track ended — awaiting next URI / registerTrack",
              {
                spotifyId: ended?.spotifyId ?? null,
                title: ended?.title ?? null,
              },
            );
          },
          onTrackChange: (track) => {
            setNowPlaying({
              title: track.title,
              artist: track.artist,
              youtubeId: track.youtubeId ?? "",
            });
          },
        });
        const result = await launchStation({
          uri: uris,
          personaId,
          seed: { ...seed, spotifyUri: uris[0] },
          withDjBreak: true,
          scriptContext,
        });

        if (!result.uri) {
          setTuneError(
            companionNotice ??
              "Could not start Spotify playback. Open Spotify on a device and try again.",
          );
        }
      } else {
        // Apple Music: arm companion DJ break over the active MusicKit session.
        await launchCompanionTrack({
          personaId,
          seed,
          withDjBreak: true,
          scriptContext,
        });
      }
    } catch (err) {
      setTuneError(
        err instanceof Error ? err.message : "Failed to tune in",
      );
    } finally {
      setIsTuningIn(false);
    }
  }, [
    activeProvider,
    beginStationLaunchLock,
    companionNotice,
    hasStreamingSession,
    isTuningIn,
    launchCompanionTrack,
    launchStation,
    loadStudioManifestBreaks,
    personaId,
    ready,
    startSpotifyPlaybackMonitor,
    station,
  ]);

  const albumArt =
    ready?.coverImageUrl ||
    (nowPlaying.youtubeId ? getYouTubeThumbnail(nowPlaying.youtubeId) : "");

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
            href="/studio"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover"
          >
            Start Free Trial
          </Link>
        </div>
      </div>
    );
  }

  // Connection gate — Spotify Premium / Apple Music required to receive the show.
  // Never render player controls or attempt media playback until connected.
  if (!hasStreamingSession && ready) {
    // State 2: playful graceful fallback after "I don't have an account".
    if (showNoAccountFallback) {
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
          <main className="relative mx-auto w-full max-w-lg rounded-2xl border border-accent/25 bg-[#121214]/95 px-6 py-10 text-center shadow-[0_0_48px_rgba(41, 146, 207,0.12)] sm:px-8">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-accent/80">
              SongHost
            </p>
            <h1 className="mt-4 font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              Radio Silence… For Now 📻
            </h1>
            <p className="mx-auto mt-5 max-w-md font-sans text-base italic leading-relaxed text-zinc-400">
              Because SongHost streams full-length music alongside custom AI DJ
              commentary, it requires an active Spotify Premium or Apple Music
              account to play. Go grab an account (or borrow a friend&apos;s!),
              come back to this link, and your host will be on standby waiting
              for you.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <Link
                href="/studio"
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-6 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition-colors hover:bg-accent-hover"
              >
                Start Building Your Own Station
              </Link>
              <button
                type="button"
                onClick={() => setShowNoAccountFallback(false)}
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline"
              >
                Back to connect options
              </button>
            </div>
          </main>
        </div>
      );
    }

    // State 1: unauthenticated gate (default).
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
        <main className="relative mx-auto w-full max-w-lg text-center">
          {albumArt ? (
            <div
              className="mx-auto mb-8 h-40 w-40 overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900 shadow-[0_0_56px_rgba(41, 146, 207,0.18)]"
              style={{
                backgroundImage: `url(${albumArt})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
              aria-hidden="true"
            />
          ) : (
            <div className="mx-auto mb-8 flex h-40 w-40 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10">
              <Radio className="h-10 w-10 text-accent" aria-hidden="true" />
            </div>
          )}

          <h1 className="font-sans text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl sm:leading-snug">
            {heroTitle}
          </h1>
          <p className="mx-auto mt-4 max-w-md font-sans text-base italic leading-relaxed text-zinc-400">
            Connect a paid streaming account to listen to this custom mix and DJ
            breaks.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              disabled={isConnecting}
              onClick={() => void connectSpotify()}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#1DB954] px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-[#1ed760] disabled:opacity-60"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">🟢</span>
              )}
              Connect Spotify Premium
            </button>
            <button
              type="button"
              disabled={isConnecting}
              onClick={() => void connectApple()}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/15 bg-zinc-100 px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-white disabled:opacity-60"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">🍎</span>
              )}
              Connect Apple Music
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowNoAccountFallback(true)}
            className="mt-6 font-mono text-[11px] text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline"
          >
            I don&apos;t have a paid streaming account
          </button>
        </main>
      </div>
    );
  }

  // Authenticated active player view
  return (
    <div className="relative min-h-screen bg-[#09090b] text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(41, 146, 207,0.18), transparent 55%), radial-gradient(ellipse 50% 35% at 15% 90%, rgba(39,39,42,0.85), transparent 50%)",
        }}
      />

      <main
        className={[
          "relative mx-auto w-full max-w-2xl px-4 pt-10 sm:px-6 sm:pt-16",
          isPlaybackActive ? "pb-32 sm:pb-36" : "pb-16",
        ].join(" ")}
      >
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
              {activeProvider
                ? ` · ${activeProvider === "spotify" ? "Spotify" : "Apple Music"}`
                : ""}
            </p>
          )}
        </header>

        {station && ready && (
          <div className="space-y-8">
            <div className="flex flex-col items-center gap-5">
              <div
                className="h-36 w-36 overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900 shadow-[0_0_48px_rgba(41, 146, 207,0.12)] sm:h-44 sm:w-44"
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

              {(hasTunedIn || companionPlayback?.isPlaying) && (
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
                onClick={() => void tuneIn()}
                disabled={isTuningIn || Boolean(companionPlayback?.isPlaying)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accent px-8 py-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-950 shadow-[0_0_32px_var(--brand-accent-glow)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:bg-accent/80"
              >
                {isTuningIn ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Tuning in…
                  </>
                ) : companionPlayback?.isPlaying || hasTunedIn ? (
                  "On Air"
                ) : (
                  "▶ TUNE IN NOW"
                )}
              </button>

              {(tuneError || companionNotice) && (
                <p className="max-w-sm text-center font-sans text-sm text-red-300" role="alert">
                  {tuneError ?? companionNotice}
                  {companionNotice && !tuneError && (
                    <button
                      type="button"
                      onClick={dismissCompanionNotice}
                      className="ml-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500 underline hover:text-zinc-300"
                    >
                      Dismiss
                    </button>
                  )}
                </p>
              )}
            </div>

            <section aria-labelledby="track-list-heading">
              <div className="mb-3 flex items-center gap-2">
                <Radio
                  className="h-3.5 w-3.5 text-accent/80"
                  aria-hidden="true"
                />
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
                            Cue {Math.round(row.cue.cuePointSec)}s
                            {row.cue.kind
                              ? ` · ${row.cue.kind.replace(/_/g, " ")}`
                              : ""}
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
                            isCurrent ? "text-accent" : "text-zinc-200",
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
          </div>
        )}
      </main>

      {/* Viral onboarding banner — only while playback is active */}
      {isPlaybackActive && (
        <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-accent/25 bg-[#0c0c0f]/95 px-4 py-3 shadow-[0_-8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md sm:px-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-center font-sans text-sm leading-snug text-zinc-300 sm:text-left">
              Created with SongHost — Build your own AI radio station.
            </p>
            <Link
              href="/studio"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover"
            >
              Start Free Trial
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}
