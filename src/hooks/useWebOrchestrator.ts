"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMusicSource } from "@/context/MusicSourceContext";
import { getPersonaById } from "@/data/personas";
import type { PersonaId } from "@/data/personas";
import {
  createWebOrchestrator,
  type BreakFrequency,
  type DjScriptContext,
  type OrchestratorProvider,
  type OrchestratorTrackInput,
  type OrchestratorTrackRef,
  type RunDjBreakResult,
  type WebOrchestrator,
} from "@/lib/player/webOrchestrator";
import {
  getSpotifyPlayerQueue,
  getValidSpotifyAccessToken,
  SPOTIFY_NEAR_END_MS,
  subscribeSpotifyPlaybackState,
  type SpotifyPlaybackState,
  type SpotifyTrack,
} from "@/lib/player/spotifyRemote";

export type { BreakFrequency, DjScriptContext, OrchestratorTrackRef };

export const DJ_BREAK_STATUS_TITLE = "ON AIR — DJ BREAK IN PROGRESS";
export const NO_ACTIVE_DEVICE_NOTICE =
  "Please open and start playing Spotify on your device";

export type CompanionTrackSeed = {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  mode?: string;
  /** Cached Spotify URI when already resolved. */
  spotifyUri?: string | null;
};

export type CompanionNowPlaying = {
  title: string;
  artist: string;
  album?: string;
  albumArtUrl?: string;
  uri?: string;
  youtubeId?: string;
};

type UseWebOrchestratorResult = {
  /** True when Spotify or Apple Music is connected as the companion source. */
  companionActive: boolean;
  /** True while lore audio is playing over the companion stream. */
  isDjBreakInProgress: boolean;
  /** Non-blocking UI notice (e.g. Spotify has no active device). */
  companionNotice: string | null;
  dismissCompanionNotice: () => void;
  /**
   * Live Spotify metadata from the playback-state subscription.
   * Prefer this for the deck title/artist so the UI matches the remote stream.
   */
  companionNowPlaying: CompanionNowPlaying | null;
  /**
   * Force Spotify onto the station's selected track URI, then optionally run
   * the opening DJ break. Call from every Launch Radio path.
   */
  launchCompanionTrack: (input: {
    personaId: PersonaId | string;
    seed: CompanionTrackSeed;
    /** When false, play the URI without a DJ break (queue advances). Default true. */
    withDjBreak?: boolean;
    scriptContext?: DjScriptContext;
  }) => Promise<{ uri: string | null; dj: RunDjBreakResult | null }>;
  /**
   * Companion DJ break: Spotify Duck–Talk–Swell, Apple Pause–Talk–Play.
   * No-ops (returns null) when no companion is connected.
   */
  runCompanionDjBreak: (input: {
    personaId: PersonaId | string;
    seed?: CompanionTrackSeed | null;
    /** Last 1–2 played + next 1–2 queued for script recaps/teasers. */
    scriptContext?: DjScriptContext;
  }) => Promise<RunDjBreakResult | null>;
  /**
   * Warm generate-script / TTS for an upcoming queue track during the
   * near-end window so autopilot Duck–Talk–Swell starts immediately.
   */
  prefetchCompanionDjBreak: (input: {
    personaId: PersonaId | string;
    seed: CompanionTrackSeed;
    scriptContext?: DjScriptContext;
  }) => Promise<void>;
  /** Configure companion break cadence (`every_track` | `spaced`). */
  setCompanionBreakFrequency: (frequency: BreakFrequency) => void;
  /**
   * Legacy numeric gap used with `spaced` cadence.
   * Pass `0` to mute live-fallback breaks (music_only).
   */
  setCompanionDjPacingFrequency: (pacing: number) => void;
  /** Update recentHistory / upcomingQueue used by generate-script. */
  setCompanionScriptContext: (context: DjScriptContext) => void;
  /** True when the next track advance should get a voiced DJ break. */
  willCompanionBreakOnNextTrack: () => boolean;
  /**
   * Resolve the next track Spotify will play (live queue), falling back to
   * the supplied LinerLore station-queue candidates.
   */
  resolvePrefetchTarget: (stationUpcoming: CompanionTrackSeed[]) => Promise<{
    seed: CompanionTrackSeed | null;
    upcomingQueue: OrchestratorTrackRef[];
    source: "spotify_queue" | "station_queue" | "none";
  }>;
  /**
   * Start (or restart) the Spotify playback-state listener.
   * - `onNearEnd`: last ~15s — prefetch the next track's DJ break.
   * - `onTrackEnded`: standalone queue advance only. When Spotify is connected
   *   and driving playback this is skipped — Spotify advances its own queue
   *   and `registerTrack` on the next playing id runs DJ breaks.
   * - Track transitions: `player_state_changed` (poll stand-in) calls
   *   `registerTrack(newTrackId)` when Spotify starts the next song.
   */
  startSpotifyPlaybackMonitor: (handlers: {
    onNearEnd?: () => void;
    onTrackEnded: () => void;
    onTrackChange?: (track: CompanionNowPlaying) => void;
  }) => void;
  /** Stop the Spotify playback-state listener. */
  stopSpotifyPlaybackMonitor: () => void;
};

function toOrchestratorProvider(
  provider: "spotify" | "apple",
): OrchestratorProvider {
  return provider === "apple" ? "apple_music" : "spotify";
}

function toCompanionNowPlaying(track: SpotifyTrack): CompanionNowPlaying {
  return {
    title: track.name,
    artist: track.artists.join(", "),
    album: track.album,
    albumArtUrl: track.albumArtUrl,
    uri: track.uri,
  };
}

/**
 * Glue hook: MusicSourceContext → WebOrchestrator companion DJ breaks,
 * Spotify play-on-launch, and continuous playback-state sync / auto-advance.
 *
 * Keeps callback props on refs so parent re-renders cannot remount the
 * orchestrator mid-break or re-trigger network work from unstable deps.
 */
export function useWebOrchestrator(): UseWebOrchestratorResult {
  const { activeProvider, isConnected } = useMusicSource();
  const [isDjBreakInProgress, setIsDjBreakInProgress] = useState(false);
  const [companionNotice, setCompanionNotice] = useState<string | null>(null);
  const [companionNowPlaying, setCompanionNowPlaying] =
    useState<CompanionNowPlaying | null>(null);

  const orchestratorRef = useRef<WebOrchestrator | null>(null);
  const orchestratorProviderRef = useRef<OrchestratorProvider | null>(null);
  const activeProviderRef = useRef(activeProvider);
  const isConnectedRef = useRef(isConnected);
  const playbackStopRef = useRef<(() => void) | null>(null);
  const nearEndUriRef = useRef<string | null>(null);
  const endedUriRef = useRef<string | null>(null);
  const onNearEndRef = useRef<(() => void) | null>(null);
  const onTrackEndedRef = useRef<(() => void) | null>(null);
  const onTrackChangeRef = useRef<
    ((track: CompanionNowPlaying) => void) | null
  >(null);
  const advancingRef = useRef(false);
  /** Last Spotify track id handed to `registerTrack` (lock-reset debounce). */
  const registeredTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeProviderRef.current = activeProvider;
    isConnectedRef.current = isConnected;
  }, [activeProvider, isConnected]);

  const dismissCompanionNotice = useCallback(() => {
    setCompanionNotice(null);
  }, []);

  const stopSpotifyPlaybackMonitor = useCallback(() => {
    playbackStopRef.current?.();
    playbackStopRef.current = null;
    nearEndUriRef.current = null;
    endedUriRef.current = null;
    advancingRef.current = false;
    registeredTrackIdRef.current = null;
  }, []);

  const tearDownOrchestrator = useCallback(() => {
    stopSpotifyPlaybackMonitor();
    orchestratorRef.current?.clearDjPrefetch();
    orchestratorRef.current?.resetBreakSession();
    orchestratorRef.current?.stopDjAudio();
    orchestratorRef.current = null;
    orchestratorProviderRef.current = null;
    setIsDjBreakInProgress(false);
    setCompanionNowPlaying(null);
  }, [stopSpotifyPlaybackMonitor]);

  useEffect(() => {
    if (!isConnected || !activeProvider) {
      tearDownOrchestrator();
    }
  }, [isConnected, activeProvider, tearDownOrchestrator]);

  useEffect(() => () => tearDownOrchestrator(), [tearDownOrchestrator]);

  const ensureOrchestrator = useCallback(async (): Promise<WebOrchestrator | null> => {
    const provider = activeProviderRef.current;
    if (!provider || !isConnectedRef.current) return null;

    let spotifyAccessToken: string | undefined;
    if (provider === "spotify") {
      const token = await getValidSpotifyAccessToken();
      if (!token) return null;
      spotifyAccessToken = token;
    }

    const expectedProvider = toOrchestratorProvider(provider);

    // Reuse the live orchestrator so autopilot DJ prefetch survives across
    // queue advances. resolveSpotifyToken() always refreshes the access token.
    if (
      orchestratorRef.current &&
      orchestratorProviderRef.current === expectedProvider
    ) {
      return orchestratorRef.current;
    }

    orchestratorRef.current?.clearDjPrefetch();
    orchestratorRef.current?.stopDjAudio();
    orchestratorRef.current = createWebOrchestrator({
      provider: expectedProvider,
      spotifyAccessToken,
      onNoActiveDevice: () => {
        setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
        setIsDjBreakInProgress(false);
      },
      onDjStart: () => {
        setIsDjBreakInProgress(true);
      },
      onDjEnd: () => {
        setIsDjBreakInProgress(false);
      },
      onError: () => {
        setIsDjBreakInProgress(false);
      },
    });
    orchestratorProviderRef.current = expectedProvider;

    return orchestratorRef.current;
  }, []);

  const resolveTrackInput = useCallback(
    async (
      orchestrator: WebOrchestrator,
      personaId: PersonaId | string,
      seed?: CompanionTrackSeed | null,
    ): Promise<OrchestratorTrackInput | null> => {
      const persona = getPersonaById(personaId);
      const voiceId = persona?.elevenLabsVoiceId;
      if (!voiceId) return null;

      // Prefer the launch/queue seed so lore matches the track about to play.
      // Live Spotify metadata often lags URI handoff and would script the
      // previous song (e.g. whatever was playing before People Are Strange).
      if (seed?.trackId && seed.title && seed.artist) {
        return {
          trackId: seed.trackId,
          title: seed.title,
          artist: seed.artist,
          album: seed.album,
          voiceId,
          personaId: persona?.id ?? String(personaId),
          mode: seed.mode,
        };
      }

      const live = await orchestrator.getCurrentlyPlayingTrack().catch((err) => {
        console.error("[LinerLore TRACE ERROR]", err);
        return null;
      });
      if (live) {
        if ("artists" in live) {
          return {
            trackId: live.id,
            title: live.name,
            artist: live.artists.join(", "),
            album: live.album,
            voiceId,
            personaId: persona?.id ?? String(personaId),
            mode: seed?.mode,
          };
        }
        return {
          trackId: live.id,
          title: live.name,
          artist: live.artistName,
          album: live.albumName,
          voiceId,
          personaId: persona?.id ?? String(personaId),
          mode: seed?.mode,
        };
      }

      return null;
    },
    [],
  );

  const runCompanionDjBreak = useCallback(
    async (input: {
      personaId: PersonaId | string;
      seed?: CompanionTrackSeed | null;
      scriptContext?: DjScriptContext;
    }): Promise<RunDjBreakResult | null> => {
      try {
        const orchestrator = await ensureOrchestrator();
        if (!orchestrator) return null;

        const track = await resolveTrackInput(
          orchestrator,
          input.personaId,
          input.seed,
        );
        if (!track) return null;

        // New trackId → clear sticky isBreakInProgress / AudioContext locks
        // before Duck–Talk–Swell so Track 2+ is never blocked by Track 1.
        if (track.trackId && track.trackId !== registeredTrackIdRef.current) {
          registeredTrackIdRef.current = track.trackId;
          orchestrator.registerTrack(track.trackId);
        }

        const result = await orchestrator.runDjBreak(track, input.scriptContext);

        if (result.ok === false && result.reason === "NO_ACTIVE_DEVICE") {
          setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
          setIsDjBreakInProgress(false);
          return result;
        }

        if (result.ok === false) {
          setIsDjBreakInProgress(false);
        }

        return result;
      } catch (err) {
        // Companion breaks must never surface as unhandled exceptions to the
        // station launch path — Spotify idle / network blips stay non-blocking.
        console.error("[LinerLore TRACE ERROR]", err);
        setIsDjBreakInProgress(false);
        return null;
      }
    },
    [ensureOrchestrator, resolveTrackInput],
  );

  const prefetchCompanionDjBreak = useCallback(
    async (input: {
      personaId: PersonaId | string;
      seed: CompanionTrackSeed;
      scriptContext?: DjScriptContext;
    }): Promise<void> => {
      try {
        const orchestrator = await ensureOrchestrator();
        if (!orchestrator) return;

        const track = await resolveTrackInput(
          orchestrator,
          input.personaId,
          input.seed,
        );
        if (!track) return;

        await orchestrator.prefetchDjBreak(track, input.scriptContext);
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }
    },
    [ensureOrchestrator, resolveTrackInput],
  );

  const setCompanionBreakFrequency = useCallback(
    (frequency: BreakFrequency) => {
      void ensureOrchestrator().then((orchestrator) => {
        if (!orchestrator) return;
        orchestrator.setBreakFrequency(frequency);
        // every_track → always due. Spaced pacing is set by the caller
        // (default 2, or 0 for music_only) via setCompanionDjPacingFrequency.
        if (frequency === "every_track") {
          orchestrator.setDjPacingFrequency(1);
        }
      });
    },
    [ensureOrchestrator],
  );

  const setCompanionDjPacingFrequency = useCallback(
    (pacing: number) => {
      void ensureOrchestrator().then((orchestrator) => {
        orchestrator?.setDjPacingFrequency(pacing);
      });
    },
    [ensureOrchestrator],
  );

  const setCompanionScriptContext = useCallback((context: DjScriptContext) => {
    orchestratorRef.current?.setScriptContext(context);
  }, []);

  const willCompanionBreakOnNextTrack = useCallback((): boolean => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return true;
    return orchestrator.willBreakOnNextTrack();
  }, []);

  const resolvePrefetchTarget = useCallback(
    async (
      stationUpcoming: CompanionTrackSeed[],
    ): Promise<{
      seed: CompanionTrackSeed | null;
      upcomingQueue: OrchestratorTrackRef[];
      source: "spotify_queue" | "station_queue" | "none";
    }> => {
      // Prefer Spotify's live player queue so prefetched lore matches the
      // exact song the remote player will advance into.
      try {
        const token = await getValidSpotifyAccessToken();
        if (token) {
          const liveQueue = await getSpotifyPlayerQueue(token);
          const spotifyNext = liveQueue?.queue?.[0];
          if (spotifyNext) {
            const seed: CompanionTrackSeed = {
              trackId: spotifyNext.id,
              title: spotifyNext.name,
              artist: spotifyNext.artists.join(", "),
              album: spotifyNext.album,
              spotifyUri: spotifyNext.uri,
            };
            const upcomingQueue = liveQueue.queue.slice(1, 3).map((t) => ({
              title: t.name,
              artist: t.artists.join(", "),
            }));
            return { seed, upcomingQueue, source: "spotify_queue" };
          }
        }
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
      }

      // Single-URI plays leave Spotify's queue empty — use LinerLore's station queue.
      const seed = stationUpcoming[0] ?? null;
      if (!seed) {
        return { seed: null, upcomingQueue: [], source: "none" };
      }
      return {
        seed,
        upcomingQueue: stationUpcoming.slice(1, 3).map((t) => ({
          title: t.title,
          artist: t.artist,
        })),
        source: "station_queue",
      };
    },
    [],
  );

  const launchCompanionTrack = useCallback(
    async (input: {
      personaId: PersonaId | string;
      seed: CompanionTrackSeed;
      withDjBreak?: boolean;
      scriptContext?: DjScriptContext;
    }): Promise<{ uri: string | null; dj: RunDjBreakResult | null }> => {
      const withDjBreak = input.withDjBreak !== false;

      if (!isConnectedRef.current || activeProviderRef.current !== "spotify") {
        // Apple (or disconnected): keep the prior DJ-only launch behavior.
        const dj = withDjBreak
          ? await runCompanionDjBreak({
              personaId: input.personaId,
              seed: input.seed,
              scriptContext: input.scriptContext,
            })
          : null;
        return { uri: null, dj };
      }

      try {
        const orchestrator = await ensureOrchestrator();
        if (!orchestrator) return { uri: null, dj: null };

        const played = await orchestrator.playCatalogTrack({
          title: input.seed.title,
          artist: input.seed.artist,
          uri: input.seed.spotifyUri,
        });

        if (!played.ok) {
          if (played.reason === "NO_ACTIVE_DEVICE") {
            setCompanionNotice(NO_ACTIVE_DEVICE_NOTICE);
          }
          return { uri: null, dj: null };
        }

        // Do not clear nearEnd/ended URI guards here. Spotify may still report
        // the previous item (or 204) until play(B) lands; resetting would let
        // autopilot double-advance. Guards arm again when a new URI appears.

        setCompanionNowPlaying({
          title: input.seed.title,
          artist: input.seed.artist,
          album: input.seed.album,
          uri: played.uri,
          youtubeId: input.seed.trackId,
        });

        let dj: RunDjBreakResult | null = null;
        if (withDjBreak) {
          dj = await runCompanionDjBreak({
            personaId: input.personaId,
            seed: { ...input.seed, spotifyUri: played.uri },
            scriptContext: input.scriptContext,
          });
        }

        return { uri: played.uri, dj };
      } catch (error) {
        console.error("[LinerLore TRACE ERROR]", error);
        console.warn("[useWebOrchestrator] launchCompanionTrack failed:", error);
        return { uri: null, dj: null };
      }
    },
    [ensureOrchestrator, runCompanionDjBreak],
  );

  const handlePlaybackState = useCallback((state: SpotifyPlaybackState) => {
    if (state.track) {
      // A new playing URI means the previous end-guard can release.
      if (
        state.track.isPlaying &&
        state.track.uri !== endedUriRef.current &&
        !state.isEnded
      ) {
        advancingRef.current = false;
      }

      // New trackId registered → reset break/audio locks so Tracks 2+ can fire.
      // Skip while a break is mid-flight so a Spotify id mismatch cannot abort
      // the live Duck–Talk–Swell (seed may use youtubeId; poll uses Spotify id).
      const liveTrackId = state.track.id?.trim() || null;
      if (
        liveTrackId &&
        liveTrackId !== registeredTrackIdRef.current &&
        state.track.isPlaying &&
        !state.isEnded &&
        !orchestratorRef.current?.isRunning
      ) {
        registeredTrackIdRef.current = liveTrackId;
        orchestratorRef.current?.registerTrack(liveTrackId);
        setIsDjBreakInProgress(false);
      }

      const now = toCompanionNowPlaying(state.track);
      setCompanionNowPlaying(now);
      onTrackChangeRef.current?.(now);
    }

    if (!state.track) return;

    // Prefetch window (~15s): warm the next track's DJ lore once per URI.
    if (state.isNearEnd && nearEndUriRef.current !== state.track.uri) {
      nearEndUriRef.current = state.track.uri;
      onNearEndRef.current?.();
    }

    // Completion: once per URI. Spotify mode must not push the station queue.
    if (!state.isEnded) return;
    if (endedUriRef.current === state.track.uri) return;
    if (advancingRef.current) return;

    endedUriRef.current = state.track.uri;
    advancingRef.current = true;

    // Track ended → drop sticky break locks so the next song's Duck–Talk–Swell
    // is not blocked by a hung Track-1 TTS / volume-ramp promise.
    orchestratorRef.current?.releaseBreakLocks();
    setIsDjBreakInProgress(false);

    const isSpotifyConnected =
      activeProviderRef.current === "spotify" && isConnectedRef.current;
    // This handler only runs under the Spotify playback monitor.
    const isSpotifyPlaybackActive = isSpotifyConnected;

    // When Spotify is connected and driving playback, do NOT actively push
    // station queue tracks. Let Spotify's SDK advance its own queue naturally;
    // the playing-track branch above calls registerTrack(newTrackId) on the
    // next song (remote stand-in for Web Playback SDK player_state_changed).
    if (isSpotifyPlaybackActive || isSpotifyConnected) {
      console.log(
        "[LinerLore TRACE] Track ended in Spotify mode — skipping LinerLore active queue advance, waiting for Spotify SDK event.",
        { uri: state.track.uri, title: state.track.name },
      );
      return;
    }

    // Standard LinerLore Standalone Queue logic below:
    console.log("[LinerLore TRACE] Autopilot track ended — advancing queue", {
      uri: state.track.uri,
      title: state.track.name,
    });
    onTrackEndedRef.current?.();
  }, []);

  const startSpotifyPlaybackMonitor = useCallback(
    (handlers: {
      onNearEnd?: () => void;
      onTrackEnded: () => void;
      onTrackChange?: (track: CompanionNowPlaying) => void;
    }) => {
      stopSpotifyPlaybackMonitor();

      if (activeProviderRef.current !== "spotify" || !isConnectedRef.current) {
        return;
      }

      onNearEndRef.current = handlers.onNearEnd ?? null;
      onTrackEndedRef.current = handlers.onTrackEnded;
      onTrackChangeRef.current = handlers.onTrackChange ?? null;

      const subscription = subscribeSpotifyPlaybackState(
        getValidSpotifyAccessToken,
        handlePlaybackState,
        { intervalMs: 2000, nearEndMs: SPOTIFY_NEAR_END_MS },
      );
      playbackStopRef.current = subscription.stop;
    },
    [handlePlaybackState, stopSpotifyPlaybackMonitor],
  );

  return {
    companionActive: Boolean(isConnected && activeProvider),
    isDjBreakInProgress,
    companionNotice,
    dismissCompanionNotice,
    companionNowPlaying,
    launchCompanionTrack,
    runCompanionDjBreak,
    prefetchCompanionDjBreak,
    setCompanionBreakFrequency,
    setCompanionDjPacingFrequency,
    setCompanionScriptContext,
    willCompanionBreakOnNextTrack,
    resolvePrefetchTarget,
    startSpotifyPlaybackMonitor,
    stopSpotifyPlaybackMonitor,
  };
}
