"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SmartSearchBar from "@/components/search/SmartSearchBar";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import ControlDeck from "@/components/ControlDeck";
import BroadcastHistoryDrawer from "@/components/history/BroadcastHistoryDrawer";
import MemoryToolbar from "@/components/MemoryToolbar";
import AlbumLinerNotes from "@/components/player/AlbumLinerNotes";
import AmbientCanvas from "@/components/player/AmbientCanvas";
import DevTierToggle from "@/components/DevTierToggle";
import HostSettingsModal from "@/components/player/HostSettingsModal";
import ProUpgradeModal from "@/components/player/ProUpgradeModal";
import LinerNotesDrawer from "@/components/player/LinerNotesDrawer";
import QueueModal from "@/components/QueueModal";
import StationCarousel from "@/components/StationCarousel";
import HeavyRotationShelf from "@/components/dashboard/HeavyRotationShelf";
import StudioMixesShelf from "@/components/studio/StudioMixesShelf";
import ShareStationModal from "@/components/station/ShareStationModal";
import ScriptTeleprompter from "@/components/teleprompter/ScriptTeleprompter";
import TrackFeedbackControls from "@/components/TrackFeedbackControls";
import { DECADE_STATIONS, GENRE_STATIONS, getStationById } from "@/data/stations";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { useListenerLocation } from "@/hooks/useListenerLocation";
import { useStudioStations } from "@/hooks/useStudioStations";
import {
  DJ_BREAK_STATUS_TITLE,
  useWebOrchestrator,
} from "@/hooks/useWebOrchestrator";
import {
  studioManifestToStation,
  type StudioMixShelfItem,
} from "@/lib/studio/manifest";
import {
  isAudioUnlockPending,
  markAudioUnlockRequested,
  primeAudioOnGesture,
} from "@/lib/audio-unlock";
import {
  handlePlayPause,
  primeSilentAudioAnchor,
} from "@/components/player/WebPlayer";
import { getPersonaById } from "@/data/personas";
import { type Station, type StationTrack } from "@/data/stations";
import type { AlbumRadioResult } from "@/lib/album-radio";
import type { ArtistRadioResult } from "@/lib/artist-radio";
import {
  isHeavyRotationStation,
  type HeavyRotationArtist,
  type HeavyRotationResult,
} from "@/lib/heavy-rotation";
import { trackIdentity } from "@/lib/queue/builder";
import { isSavedStationId } from "@/lib/saved-stations";
import {
  isSongRadioStation,
  type SongRadioResult,
} from "@/lib/song-radio";
import { spotifyUriForQueueTrack } from "@/lib/player/webOrchestrator";
import { formatStationMetaTag } from "@/lib/station-meta";
import {
  deserializeStationPreset,
  readPresetTokenFromSearch,
  stripPresetFromUrl,
  type ShareableStationInput,
} from "@/lib/station/serializer";
import {
  banTrack,
  EMPTY_TRACK_FEEDBACK,
  isFavoriteTrack,
  loadTrackFeedback,
  toggleFavoriteTrack,
} from "@/lib/user/feedback";
import { loadPinnedStations, togglePinStation } from "@/lib/user/preferences";
import {
  beginSpotifyAuth,
  captureSpotifyTokensFromUrl,
  getCurrentlyPlaying,
  getValidSpotifyAccessToken,
  searchSpotifyTrackUri,
} from "@/lib/player/spotifyRemote";
import type {
  DjMode,
  DjScriptContext,
  OrchestratorTrackRef,
} from "@/hooks/useWebOrchestrator";
import { getYouTubeThumbnail } from "@/lib/youtube";
import { ListMusic, Music2 } from "lucide-react";
import type { PersonaId } from "@/data/personas";
import {
  DEFAULT_DJ_TUNING,
  djModeToPace,
  djPaceToMode,
  type DjTuningSettings,
} from "@/types/dj";
import {
  findAlbumTrackIndex,
  resolveStationSettings,
  type ChatterPacing,
  type EraLock,
  type MemoryPreset,
  type StationConfig,
} from "@/types/station";
import { nextVisualizerMode } from "@/types/visuals";
import type { TtsProvider } from "@/types/voice";

const IDLE_NOW_PLAYING = {
  title: "Ready to Tune In",
  artist: "Select a station or search for music",
  albumArt: "",
  youtubeId: "",
};

const DEFAULT_ACCENT = "#2992cf";

/**
 * Spotify `play({ uris })` queue depth on station launch. Matches artist-radio's
 * payload size so genre/decade/artist handoffs all seed a full Connect queue.
 */
const SPOTIFY_LAUNCH_URI_COUNT = 30;

export default function Home() {
  const {
    activePersonaId,
    setActivePersonaId,
    preferredVoice,
    djPacingFrequency,
    incrementSongCounter,
    resetSongCounter,
    addToPlayHistory,
    toggleLikedTrack,
    isTrackLiked,
    savedStations,
    saveCustomStation,
    deleteCustomStation,
    visualizerMode,
    setVisualizerMode,
    chatterPacing,
    setChatterPacing,
    commentaryFormat,
    memoryPresets,
    saveMemoryPreset,
    clearPreset,
    stationConfigs,
    setStationConfig,
  } = useUserPreferences();
  const { isPro, isFree, tier: subscriptionTier } = useTier();

  const {
    mixes: studioMixes,
    removeStudioMix,
  } = useStudioStations();

  const studioStations = useMemo(
    () =>
      studioMixes
        .filter((mix) => mix.manifest)
        .map((mix) => studioManifestToStation(mix.manifest!)),
    [studioMixes],
  );

  const [pinnedStationIds, setPinnedStationIds] = useState<string[]>([]);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [linerNotesOpen, setLinerNotesOpen] = useState(false);
  /**
   * Mirror of the persisted feedback store. Held in state only so the deck's
   * thumbs-up re-renders on a change — the queue reads the store directly,
   * because it has to see a ban the moment it is recorded rather than on the
   * next render.
   */
  const [trackFeedback, setTrackFeedback] = useState(EMPTY_TRACK_FEEDBACK);
  const [queueGeneration, setQueueGeneration] = useState(0);
  const [queueState, setQueueState] = useState<{ queue: StationTrack[]; currentIndex: number }>({
    queue: [],
    currentIndex: 0,
  });
  /**
   * False while `useStationQueue` is still fetching the genre/decade catalog.
   * Spotify handoff must wait — otherwise launchStation only sees the seed opener.
   */
  const [queueReady, setQueueReady] = useState(false);
  const [stationSeedTracks, setStationSeedTracks] = useState<StationTrack[]>([]);

  const [shareStation, setShareStation] = useState<ShareableStationInput | null>(null);
  const [activeStation, setActiveStation] = useState<Station | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [artistRadioMode, setArtistRadioMode] = useState(false);
  /** Spotify Heavy Rotation shelf — top artists + ready-to-play station payload. */
  const [heavyRotationArtists, setHeavyRotationArtists] = useState<
    HeavyRotationArtist[]
  >([]);
  const [heavyRotationResult, setHeavyRotationResult] =
    useState<HeavyRotationResult | null>(null);
  const [heavyRotationLoading, setHeavyRotationLoading] = useState(false);
  const [heavyRotationLaunching, setHeavyRotationLaunching] = useState(false);
  const [heavyRotationError, setHeavyRotationError] = useState<string | null>(null);
  const [heavyRotationNeedsConnect, setHeavyRotationNeedsConnect] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(IDLE_NOW_PLAYING);
  /** Companion DJ mode — synced to webOrchestrator.setDjMode. */
  const [djMode, setDjMode] = useState<DjMode>("balanced");
  /** DJ Tuning Console — session-local station settings (survives re-renders). */
  const [djTuning, setDjTuning] = useState<DjTuningSettings>(DEFAULT_DJ_TUNING);
  const [djSettingsOpen, setDjSettingsOpen] = useState(false);
  /** Permalink token pending apply; `undefined` until the URL has been read. */
  const pendingPresetTokenRef = useRef<string | null | undefined>(undefined);
  const permalinkHydratedRef = useRef(false);
  const permalinkMissesRef = useRef(0);

  const ttsProvider: TtsProvider = isPro ? "elevenlabs" : "openai";
  const playerRef = useRef<AudioPlayerHandle>(null);
  const activePersona = getPersonaById(activePersonaId);
  const { location: listenerLocation, requestLocation } = useListenerLocation();
  const {
    companionActive,
    isDjBreakInProgress,
    status: orchestratorStatus,
    companionNotice,
    dismissCompanionNotice,
    companionNowPlaying,
    companionPlayback,
    spotifyRemote,
    playTrack,
    launchStation,
    launchSeededSongRadio,
    launchCompanionTrack,
    runCompanionDjBreak,
    prefetchCompanionDjBreak,
    setCompanionDjMode,
    setCompanionDjPacingFrequency,
    setCompanionDjTuning,
    setCompanionScriptContext,
    willCompanionBreakOnNextTrack,
    triggerBreakNow,
    skipActiveBreak,
    resolvePrefetchTarget,
    startSpotifyPlaybackMonitor,
    stopSpotifyPlaybackMonitor,
    isLaunchingStation,
    beginStationLaunchLock,
    clearStationLaunchLock,
  } = useWebOrchestrator();
  const launchCompanionTrackRef = useRef(launchCompanionTrack);
  const runCompanionDjBreakRef = useRef(runCompanionDjBreak);
  const prefetchCompanionDjBreakRef = useRef(prefetchCompanionDjBreak);
  const resolvePrefetchTargetRef = useRef(resolvePrefetchTarget);
  const willCompanionBreakOnNextTrackRef = useRef(willCompanionBreakOnNextTrack);
  const setCompanionScriptContextRef = useRef(setCompanionScriptContext);
  const launchStationRef = useRef(launchStation);
  const launchSeededSongRadioRef = useRef(launchSeededSongRadio);
  const beginStationLaunchLockRef = useRef(beginStationLaunchLock);
  const clearStationLaunchLockRef = useRef(clearStationLaunchLock);
  const isLaunchingStationRef = useRef(isLaunchingStation);
  const spotifyRemoteRef = useRef(spotifyRemote);
  launchCompanionTrackRef.current = launchCompanionTrack;
  runCompanionDjBreakRef.current = runCompanionDjBreak;
  prefetchCompanionDjBreakRef.current = prefetchCompanionDjBreak;
  resolvePrefetchTargetRef.current = resolvePrefetchTarget;
  willCompanionBreakOnNextTrackRef.current = willCompanionBreakOnNextTrack;
  setCompanionScriptContextRef.current = setCompanionScriptContext;
  launchStationRef.current = launchStation;
  launchSeededSongRadioRef.current = launchSeededSongRadio;
  beginStationLaunchLockRef.current = beginStationLaunchLock;
  clearStationLaunchLockRef.current = clearStationLaunchLock;
  isLaunchingStationRef.current = isLaunchingStation;
  spotifyRemoteRef.current = spotifyRemote;
  const queueStateRef = useRef(queueState);
  queueStateRef.current = queueState;
  const activePersonaIdRef = useRef(activePersonaId);
  activePersonaIdRef.current = activePersonaId;
  const stationModeRef = useRef<string | undefined>(undefined);
  /** Session-scoped recently finished tracks for DJ recap context. */
  const sessionPlayedRef = useRef<OrchestratorTrackRef[]>([]);
  const lastDeckTrackRef = useRef<OrchestratorTrackRef | null>(null);
  /**
   * Queues an explicit Spotify companion handoff for the launch that just
   * called `beginStationSession`. Once the live queue opener is ready,
   * `launchCompanionTrack` → `webOrchestrator.runDjBreak` (TRACE 2–5).
   */
  const pendingOrchestratorHandoffRef = useRef<{
    personaId: PersonaId | string;
    mode?: string;
    /** Must match the post-launch `queueGeneration` before Spotify play. */
    queueGeneration: number;
  } | null>(null);

  const handoffToWebOrchestrator = useCallback(
    (personaId: PersonaId | string, mode?: string) => {
      if (!companionActive) return;
      console.log(
        "[LinerLore TRACE 1b] Handoff to webOrchestrator for Spotify track",
      );
      // Lock deck metadata immediately so stale Spotify polls cannot flash the
      // previous station's title/art while URI search runs.
      beginStationLaunchLockRef.current();
      pendingOrchestratorHandoffRef.current = {
        personaId,
        mode,
        queueGeneration: queueGeneration + 1,
      };
    },
    [companionActive, queueGeneration],
  );

  const connectSpotify = useCallback(() => {
    void beginSpotifyAuth()
      .then((authorizeUrl) => {
        window.location.assign(authorizeUrl);
      })
      .catch((error) => {
        console.error("Spotify connect failed:", error);
      });
  }, []);

  const loadHeavyRotation = useCallback(async () => {
    setHeavyRotationLoading(true);
    setHeavyRotationError(null);

    try {
      const token = await getValidSpotifyAccessToken();
      if (!token) {
        setHeavyRotationNeedsConnect(true);
        setHeavyRotationArtists([]);
        setHeavyRotationResult(null);
        return;
      }

      setHeavyRotationNeedsConnect(false);
      const res = await fetch("/api/user/top-tracks?limit=5&time_range=medium_term", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        setHeavyRotationNeedsConnect(true);
        setHeavyRotationArtists([]);
        setHeavyRotationResult(null);
        setHeavyRotationError(
          res.status === 403
            ? "Reconnect Spotify to enable Heavy Rotation (user-top-read)."
            : "Spotify session expired — reconnect to load Your Station.",
        );
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setHeavyRotationArtists([]);
        setHeavyRotationResult(null);
        setHeavyRotationError(body?.error ?? "Could not load Heavy Rotation");
        return;
      }

      const data = (await res.json()) as HeavyRotationResult;
      setHeavyRotationArtists(data.artists ?? []);
      setHeavyRotationResult(data);
    } catch (err) {
      console.error("[SongGhost] heavyRotation load failed:", err);
      setHeavyRotationArtists([]);
      setHeavyRotationResult(null);
      setHeavyRotationError("Could not load Heavy Rotation");
    } finally {
      setHeavyRotationLoading(false);
    }
  }, []);

  // Deferred to the client: reading storage during render would not match the
  // markup the server streamed.
  useEffect(() => {
    setTrackFeedback(loadTrackFeedback());
    setPinnedStationIds(loadPinnedStations());
    captureSpotifyTokensFromUrl();
    void loadHeavyRotation();
  }, [loadHeavyRotation]);

  /**
   * Preset, studio, and saved stations (including serialized Artist / Song /
   * Curator radio payloads written into savedStations on park/save).
   */
  const findTunableStation = useCallback(
    (stationId: string): Station | null =>
      savedStations.find((station) => station.id === stationId) ??
      studioStations.find((station) => station.id === stationId) ??
      getStationById(stationId) ??
      null,
    [savedStations, studioStations],
  );

  const activeSettings = activeStation
    ? resolveStationSettings(
        activeStation,
        stationConfigs[activeStation.id],
        chatterPacing,
        commentaryFormat,
      )
    : null;
  stationModeRef.current = activeSettings?.mode;

  const resolveHostId = useCallback(
    (station: Station): PersonaId =>
      (stationConfigs[station.id]?.hostPersonaId as PersonaId | undefined) ??
      station.defaultPersonaId,
    [stationConfigs],
  );

  const resolveEraLockFor = useCallback(
    (station: Station): EraLock => stationConfigs[station.id]?.eraLock ?? "all",
    [stationConfigs],
  );

  const ensureListening = useCallback(() => {
    markAudioUnlockRequested();
    primeAudioOnGesture();
    // Must run inside the Play / Launch Station gesture — keeps Android Chrome
    // from suspending Web Audio / timers when the tab is backgrounded.
    primeSilentAudioAnchor();
    setIsPlaying(true);
    requestLocation();
    playerRef.current?.unlockAudio();
  }, [requestLocation]);

  useLayoutEffect(() => {
    if (!isAudioUnlockPending() || !isPlaying) return;
    if (!sessionActive) return;
    playerRef.current?.unlockAudio();
  }, [sessionActive, isPlaying, queueGeneration]);

  const handleTogglePin = useCallback((stationId: string) => {
    setPinnedStationIds((current) => togglePinStation(stationId, current));
  }, []);

  const beginStationSession = useCallback(
    (station: Station, tracks: StationTrack[], personaId?: string) => {
      setSessionActive(true);
      setStationSeedTracks(tracks);
      setQueueGeneration((g) => g + 1);
      // Drop the previous station's opener so the orchestrator handoff cannot
      // resolve against a stale queue before useStationQueue finishes reset.
      setQueueState({ queue: [], currentIndex: 0 });
      setQueueReady(false);
      sessionPlayedRef.current = [];
      lastDeckTrackRef.current = null;
      setNowPlaying({
        title: "Tuning in…",
        artist: station.name,
        albumArt: "",
        youtubeId: "",
      });
      if (personaId) setActivePersonaId(personaId as Parameters<typeof setActivePersonaId>[0]);
      resetSongCounter();
      requestLocation();
    },
    [resetSongCounter, setActivePersonaId, requestLocation],
  );

  /** Build recentHistory + upcomingQueue for generate-script recaps/teasers. */
  const buildCompanionScriptContext = useCallback(
    (opts?: { forTrackIndex?: number }): DjScriptContext => {
      const { queue, currentIndex } = queueStateRef.current;
      const index = opts?.forTrackIndex ?? currentIndex;
      const fromQueue = queue
        .slice(Math.max(0, index - 2), index)
        .map((t) => ({ title: t.title, artist: t.artist }));
      const recentHistory = (
        fromQueue.length > 0 ? fromQueue : sessionPlayedRef.current
      ).slice(-2);
      const upcomingQueue = queue
        .slice(index + 1, index + 3)
        .map((t) => ({ title: t.title, artist: t.artist }));
      return { recentHistory, upcomingQueue };
    },
    [],
  );
  const buildCompanionScriptContextRef = useRef(buildCompanionScriptContext);
  buildCompanionScriptContextRef.current = buildCompanionScriptContext;

  /**
   * Spotify companion autopilot: continuous playback-state listener.
   * - Near-end (~15s): prefetch DJ lore for the upcoming queue track
   *   (Spotify live queue preferred, else LinerLore station queue).
   * - Track ended: `playNextTrack` / `advanceEnded` so single-URI plays and
   *   drained multi-URI launches cannot stall. AudioPlayer then plays N + 1
   *   and runs any scheduled DJ break over the new track.
   * - Mid-queue Spotify auto-advances: `registerTrack` on the new id runs
   *   Duck–Talk–Swell without forcing a station-queue push.
   */
  useEffect(() => {
    if (!sessionActive || !companionActive) {
      stopSpotifyPlaybackMonitor();
      return;
    }

    startSpotifyPlaybackMonitor({
      onNearEnd: () => {
        if (!willCompanionBreakOnNextTrackRef.current()) {
          console.log(
            "[LinerLore TRACE] Autopilot skip prefetch — djMode not due",
          );
          return;
        }

        const { queue, currentIndex } = queueStateRef.current;
        const stationUpcoming = queue.slice(currentIndex + 1, currentIndex + 4).map(
          (track) => ({
            trackId: track.youtubeId || `${track.artist}:${track.title}`,
            title: track.title,
            artist: track.artist,
            album: track.album,
            mode: stationModeRef.current,
          }),
        );

        void (async () => {
          const resolved = await resolvePrefetchTargetRef.current(stationUpcoming);
          if (!resolved.seed) return;

          const current = queue[currentIndex];
          const recentHistory: OrchestratorTrackRef[] = [
            ...sessionPlayedRef.current,
            ...(current
              ? [{ title: current.title, artist: current.artist }]
              : []),
          ].slice(-2);

          const scriptContext: DjScriptContext = {
            recentHistory,
            upcomingQueue: resolved.upcomingQueue,
          };

          console.log("[LinerLore TRACE] Autopilot prefetch next DJ break", {
            title: resolved.seed.title,
            artist: resolved.seed.artist,
            source: resolved.source,
            recentHistory: recentHistory.length,
            upcomingQueue: resolved.upcomingQueue.length,
          });

          await prefetchCompanionDjBreakRef.current({
            personaId: activePersonaIdRef.current,
            seed: {
              ...resolved.seed,
              mode: stationModeRef.current,
            },
            scriptContext,
          });
        })();
      },
      onTrackEnded: (ended) => {
        // Align to the finished Spotify item (multi-URI launches can leave the
        // station index on the opener), then advance to N + 1. AudioPlayer's
        // companion path plays the next URI and runs any scheduled DJ break.
        console.log("[LinerLore TRACE] Track ended — playNextTrack", {
          spotifyId: ended?.spotifyId ?? null,
          title: ended?.title ?? null,
        });
        playerRef.current?.playNextTrack(
          ended
            ? {
                spotifyId: ended.spotifyId,
                title: ended.title,
                artist: ended.artist,
              }
            : undefined,
        );
      },
      onTrackChange: (track) => {
        // Hook already suppresses player_state_changed until uris[0] confirms;
        // once this fires, deck metadata is safe to apply.
        const prev = lastDeckTrackRef.current;
        if (
          prev &&
          (prev.title !== track.title || prev.artist !== track.artist)
        ) {
          sessionPlayedRef.current = [...sessionPlayedRef.current, prev].slice(-8);
        }
        lastDeckTrackRef.current = {
          title: track.title,
          artist: track.artist,
        };
        // Keep live-fallback breaks in sync with history/queue context.
        setCompanionScriptContextRef.current(
          buildCompanionScriptContextRef.current(),
        );
        setNowPlaying((prevState) => ({
          title: track.title,
          artist: track.artist,
          albumArt: track.albumArtUrl || prevState.albumArt,
          youtubeId: track.youtubeId || prevState.youtubeId,
        }));
      },
    });

    return () => {
      stopSpotifyPlaybackMonitor();
    };
  }, [
    sessionActive,
    companionActive,
    queueGeneration,
    startSpotifyPlaybackMonitor,
    stopSpotifyPlaybackMonitor,
  ]);

  // Prefer live Spotify metadata so the deck always matches the remote stream.
  // Skip while isLaunchingStation so stale polls cannot overwrite "Tuning in…".
  useEffect(() => {
    if (!companionActive || !companionNowPlaying || isLaunchingStation) return;
    setNowPlaying((prev) => ({
      title: companionNowPlaying.title,
      artist: companionNowPlaying.artist,
      albumArt: companionNowPlaying.albumArtUrl || prev.albumArt,
      youtubeId: companionNowPlaying.youtubeId || prev.youtubeId,
    }));
  }, [companionActive, companionNowPlaying, isLaunchingStation]);

  // Keep the deck play/pause glyph in sync with the Spotify remote stream.
  const companionIsPlaying = companionPlayback?.isPlaying;
  useEffect(() => {
    if (!companionActive || companionIsPlaying === undefined) return;
    setIsPlaying(companionIsPlaying);
  }, [companionActive, companionIsPlaying]);

  /**
   * After the station queue settles on its real opener, hand off to Spotify.
   * Resolve catalog URIs for the live queue (search / curator / album results),
   * then `launchStation(uris)` + opening DJ break for the active persona.
   *
   * Genre/decade stations apply a single seed opener before `/api/station-tracks`
   * replenishes — wait for `queueReady` so we resolve the full 25–30 URI array
   * rather than `launchStation([seedOnly])`.
   */
  useEffect(() => {
    const pending = pendingOrchestratorHandoffRef.current;
    if (!pending || !companionActive || !sessionActive) return;
    if (queueGeneration !== pending.queueGeneration) return;
    if (!queueReady) return;

    const { queue, currentIndex } = queueState;
    const track = queue[currentIndex];
    if (!track) return;

    pendingOrchestratorHandoffRef.current = null;

    const personaId = pending.personaId;
    const mode = pending.mode;
    const queueSeed = {
      trackId: track.youtubeId || `${track.artist}:${track.title}`,
      title: track.title,
      artist: track.artist,
      album: track.album,
      mode,
    };

    void (async () => {
      try {
        const token = await getValidSpotifyAccessToken();
        if (!token) {
          await launchCompanionTrackRef.current({
            personaId,
            seed: queueSeed,
            withDjBreak: true,
            scriptContext: buildCompanionScriptContextRef.current(),
          });
          return;
        }

        // Resolve the station opener + following tracks to Spotify URIs so
        // Web Playback / Connect gets a real queue (not a single orphan URI).
        // Prefer native Spotify fields when present; otherwise search by metadata.
        const stationTracks = queue.slice(
          currentIndex,
          currentIndex + SPOTIFY_LAUNCH_URI_COUNT,
        );
        const resolved = await Promise.all(
          stationTracks.map(async (queueTrack) => {
            const nativeUri = spotifyUriForQueueTrack(
              queueTrack as StationTrack & {
                uri?: string;
                id?: string;
              },
            );
            if (nativeUri) return nativeUri;
            return searchSpotifyTrackUri(
              token,
              queueTrack.title,
              queueTrack.artist,
            );
          }),
        );
        const uris = resolved.filter((uri): uri is string => Boolean(uri));

        if (uris.length > 0) {
          const stationId = activeStation?.id ?? "unknown";
          console.log("[SongGhost] Launching station", {
            stationId,
            trackCount: uris.length,
          });
          const scriptContext = buildCompanionScriptContextRef.current();
          const seedPayload = { ...queueSeed, spotifyUri: uris[0] };

          if (isSongRadioStation(stationId)) {
            console.log(
              "[LinerLore TRACE 1b] launchSeededSongRadio → runDjBreak",
              {
                personaId,
                uriCount: uris.length,
                queueDepth: queue.length,
                title: queueSeed.title,
                artist: queueSeed.artist,
              },
            );
            await launchSeededSongRadioRef.current({
              seedUri: uris[0],
              recommendationUris: uris.slice(1),
              personaId,
              seed: seedPayload,
              withDjBreak: true,
              scriptContext,
            });
            return;
          }

          console.log(
            "[LinerLore TRACE 1b] launchStation(uris) → runDjBreak",
            {
              personaId,
              uriCount: uris.length,
              queueDepth: queue.length,
              title: queueSeed.title,
              artist: queueSeed.artist,
            },
          );
          await launchStationRef.current({
            uri: uris,
            personaId,
            seed: seedPayload,
            withDjBreak: true,
            scriptContext,
          });
          return;
        }

        console.log("[LinerLore TRACE 1b] launchCompanionTrack → runDjBreak", {
          personaId,
          title: queueSeed.title,
          artist: queueSeed.artist,
        });

        await launchCompanionTrackRef.current({
          personaId,
          seed: queueSeed,
          withDjBreak: true,
          scriptContext: buildCompanionScriptContextRef.current(),
        });
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
        clearStationLaunchLockRef.current();
      }
    })();
  }, [
    queueState,
    queueReady,
    companionActive,
    sessionActive,
    queueGeneration,
    activeStation?.id,
  ]);

  const selectStation = useCallback(
    (station: Station, e?: { preventDefault(): void; stopPropagation(): void }) => {
      e?.preventDefault();
      e?.stopPropagation();
      primeAudioOnGesture();
      const hostId = resolveHostId(station);
      setArtistRadioMode(false);
      setActiveStation(station);
      setActivePersonaId(hostId);
      beginStationSession(station, station.tracks);
      handoffToWebOrchestrator(hostId);
      ensureListening();
      console.log("[SongGhost] stationSelected", {
        stationId: station.id,
        personaId: hostId,
        eraLock: resolveEraLockFor(station),
      });
    },
    [
      beginStationSession,
      setActivePersonaId,
      ensureListening,
      resolveHostId,
      resolveEraLockFor,
      handoffToWebOrchestrator,
    ],
  );

  const buildShareSnapshot = useCallback(
    (station: Station): ShareableStationInput => {
      const settings = resolveStationSettings(
        station,
        stationConfigs[station.id],
        chatterPacing,
        commentaryFormat,
      );
      const config = stationConfigs[station.id];
      return {
        stationId: station.id,
        name: settings.name,
        frequency: settings.frequency,
        hostPersonaId: config?.hostPersonaId ?? settings.personaId,
        chatterPacing: config?.chatterPacing ?? settings.chatterPacing,
        eraLock: settings.eraLock,
        vibePrompt: settings.vibePrompt,
        mode: settings.mode,
        albumContext: settings.albumContext,
        voiceProfile: settings.voiceProfile,
      };
    },
    [stationConfigs, chatterPacing, commentaryFormat],
  );

  const openShareForStation = useCallback(
    (station: Station) => {
      setShareStation(buildShareSnapshot(station));
    },
    [buildShareSnapshot],
  );

  /**
   * Unpack `?preset=` permalinks into station overrides and tune the dial.
   *
   * The token is stripped from the URL on first read so a refresh does not
   * re-apply the same share on top of later listener edits. Saved-station
   * shares wait until the preference store has a chance to load their catalog.
   */
  useEffect(() => {
    if (permalinkHydratedRef.current) return;
    if (typeof window === "undefined") return;

    if (pendingPresetTokenRef.current === undefined) {
      const token = readPresetTokenFromSearch(window.location.search);
      pendingPresetTokenRef.current = token;
      if (token) {
        window.history.replaceState(null, "", stripPresetFromUrl(window.location.href));
      }
    }

    const token = pendingPresetTokenRef.current;
    if (!token) {
      permalinkHydratedRef.current = true;
      return;
    }

    const decoded = deserializeStationPreset(token);
    if (!decoded.ok) {
      permalinkHydratedRef.current = true;
      console.warn("[SongGhost] presetHydrateFailed", { error: decoded.error });
      return;
    }

    const station =
      getStationById(decoded.stationId) ??
      savedStations.find((entry) => entry.id === decoded.stationId) ??
      null;

    if (!station) {
      // Catalog presets resolve immediately; custom shares may need the prefs
      // store to finish loading before the saved-station catalog is present.
      if (!isSavedStationId(decoded.stationId)) {
        permalinkHydratedRef.current = true;
        console.warn("[SongGhost] presetStationMissing", { stationId: decoded.stationId });
        return;
      }

      permalinkMissesRef.current += 1;
      if (permalinkMissesRef.current >= 2) {
        permalinkHydratedRef.current = true;
        console.warn("[SongGhost] presetStationMissing", { stationId: decoded.stationId });
        return;
      }

      const timer = window.setTimeout(() => {
        if (permalinkHydratedRef.current) return;
        permalinkHydratedRef.current = true;
        console.warn("[SongGhost] presetStationMissing", { stationId: decoded.stationId });
      }, 800);
      return () => window.clearTimeout(timer);
    }

    permalinkHydratedRef.current = true;
    pendingPresetTokenRef.current = null;

    const patch: Partial<StationConfig> = { ...decoded.config };
    delete (patch as { stationId?: string }).stationId;
    setStationConfig(decoded.stationId, patch);

    const hostId =
      (decoded.config.hostPersonaId as PersonaId | null | undefined) ??
      station.defaultPersonaId;
    setArtistRadioMode(false);
    setActiveStation(station);
    setActivePersonaId(hostId);
    beginStationSession(station, station.tracks);
    // Permalink deep-links do not unlock audio automatically — browsers block
    // playback without a gesture. The session is staged so Play starts the share.
    console.log("[SongGhost] presetHydrated", {
      stationId: decoded.stationId,
      personaId: hostId,
      eraLock: decoded.config.eraLock,
      mode: decoded.config.mode,
    });
  }, [savedStations, setStationConfig, setActivePersonaId, beginStationSession]);

  const launchArtistRadio = useCallback(
    (result: ArtistRadioResult) => {
      console.log("[LinerLore TRACE 1] Launch Radio clicked");
      try {
        setArtistRadioMode(true);
        setActiveStation(result.station);
        setActivePersonaId(result.personaId);
        beginStationSession(result.station, result.tracks, result.personaId);
        handoffToWebOrchestrator(result.personaId);
        ensureListening();
        console.log("[SongGhost] artistRadioLaunched", {
          artist: result.artistName,
          personaId: result.personaId,
          trackCount: result.tracks.length,
        });
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
        throw err;
      }
    },
    [
      beginStationSession,
      setActivePersonaId,
      ensureListening,
      handoffToWebOrchestrator,
    ],
  );

  /**
   * Song Radio: seed track at index 0 + Spotify recommendations. Opening DJ
   * break highlights the requested song/artist via the standard session intro.
   */
  const launchSongRadio = useCallback(
    (result: SongRadioResult) => {
      console.log("[LinerLore TRACE 1] Launch Radio clicked");
      try {
        setArtistRadioMode(false);
        setActiveStation(result.station);
        setActivePersonaId(result.personaId);
        beginStationSession(result.station, result.tracks, result.personaId);
        handoffToWebOrchestrator(result.personaId);
        ensureListening();
        console.log("[SongGhost] songRadioLaunched", {
          title: result.seedTitle,
          artist: result.seedArtist,
          personaId: result.personaId,
          trackCount: result.tracks.length,
          seedSpotifyId: result.seedSpotifyId,
        });
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
        throw err;
      }
    },
    [
      beginStationSession,
      setActivePersonaId,
      ensureListening,
      handoffToWebOrchestrator,
    ],
  );

  /**
   * Heavy Rotation: fixed playlist from Spotify top listening history.
   * Opening DJ break announces the first heavy-rotation track.
   */
  const launchHeavyRotation = useCallback(
    (result: HeavyRotationResult) => {
      console.log("[LinerLore TRACE 1] Launch Radio clicked");
      try {
        setArtistRadioMode(false);
        setActiveStation(result.station);
        setActivePersonaId(result.personaId);
        beginStationSession(result.station, result.tracks, result.personaId);
        handoffToWebOrchestrator(result.personaId);
        ensureListening();
        console.log("[SongGhost] heavyRotationLaunched", {
          artists: result.artists.map((a) => a.name),
          personaId: result.personaId,
          trackCount: result.tracks.length,
        });
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
        throw err;
      }
    },
    [
      beginStationSession,
      setActivePersonaId,
      ensureListening,
      handoffToWebOrchestrator,
    ],
  );

  const playHeavyRotationStation = useCallback(async () => {
    setHeavyRotationLaunching(true);
    setHeavyRotationError(null);
    try {
      let result = heavyRotationResult;
      if (!result?.tracks?.length) {
        const token = await getValidSpotifyAccessToken();
        if (!token) {
          setHeavyRotationNeedsConnect(true);
          setHeavyRotationError("Connect Spotify to play Your Heavy Rotation.");
          return;
        }
        const res = await fetch("/api/user/top-tracks?limit=5&time_range=medium_term", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (res.status === 401 || res.status === 403) {
            setHeavyRotationNeedsConnect(true);
          }
          setHeavyRotationError(body?.error ?? "Could not build Your Station");
          return;
        }
        result = (await res.json()) as HeavyRotationResult;
        setHeavyRotationArtists(result.artists ?? []);
        setHeavyRotationResult(result);
      }

      if (!result?.tracks?.length) {
        setHeavyRotationError("No tracks available for Your Heavy Rotation yet.");
        return;
      }

      launchHeavyRotation(result);
    } catch (err) {
      console.error("[SongGhost] heavyRotation play failed:", err);
      setHeavyRotationError("Could not start Your Heavy Rotation");
    } finally {
      setHeavyRotationLaunching(false);
    }
  }, [heavyRotationResult, launchHeavyRotation]);

  /**
   * FULL ALBUM launch: attach sleeve metadata as a station override, then seed
   * the session. `useStationQueue` sees `mode: album_deep_dive` + `albumContext`
   * and sequences via `buildStationQueue()` instead of the shuffle path.
   */
  const launchAlbumDeepDive = useCallback(
    (result: AlbumRadioResult) => {
      console.log("[LinerLore TRACE 1] Launch Radio clicked");
      try {
        setArtistRadioMode(false);
        setStationConfig(result.station.id, {
          mode: "album_deep_dive",
          albumContext: result.albumContext,
        });
        setActiveStation(result.station);
        setActivePersonaId(result.personaId);
        beginStationSession(result.station, result.tracks, result.personaId);
        handoffToWebOrchestrator(result.personaId, "album_deep_dive");
        ensureListening();
        console.log("[SongGhost] albumDeepDiveLaunched", {
          album: result.albumContext.albumTitle,
          artist: result.albumContext.artist,
          personaId: result.personaId,
          trackCount: result.tracks.length,
          collectionId: result.collectionId,
        });
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
        throw err;
      }
    },
    [
      beginStationSession,
      setActivePersonaId,
      setStationConfig,
      ensureListening,
      handoffToWebOrchestrator,
    ],
  );

  const loadCuratedPlaylist = useCallback(
    (station: Station, tracks: StationTrack[], personaId: PersonaId) => {
      console.log("[LinerLore TRACE 1] Launch Radio clicked");
      try {
        setArtistRadioMode(false);
        setActiveStation(station);
        beginStationSession(station, tracks, personaId);
        handoffToWebOrchestrator(personaId);
        ensureListening();
      } catch (err) {
        console.error("[LinerLore TRACE ERROR]", err);
        throw err;
      }
    },
    [beginStationSession, ensureListening, handoffToWebOrchestrator],
  );

  const handleQueueChange = useCallback(
    (queue: StationTrack[], currentIndex: number, ready: boolean) => {
      setQueueState({ queue, currentIndex });
      setQueueReady(ready);
    },
    [],
  );

  const cycleVisualizer = useCallback(() => {
    setVisualizerMode(nextVisualizerMode(visualizerMode));
  }, [visualizerMode, setVisualizerMode]);

  const handleSaveStation = useCallback(
    (station: Station) => {
      // saveCustomStation serializes a complete Station payload (including
      // artist-radio-* / song-radio-* / ai-curator-* manifests) into savedStations.
      saveCustomStation(station);
      console.log("[SongGhost] stationSaved", {
        stationId: station.id,
        trackCount: station.tracks.length,
      });
    },
    [saveCustomStation],
  );

  const parkStationOnPreset = useCallback(
    (slot: number, station: Station) => {
      // Pass the full Station so ephemeral Artist / Song / Curator radio payloads
      // are serialized into savedStations — otherwise the dial only stores an id
      // that cannot be resolved after a browser reboot.
      saveMemoryPreset(
        slot,
        {
          stationId: station.id,
          stationName: station.name,
          frequency: station.frequency,
          accentColor: station.accentColor,
          personaId: resolveHostId(station),
        },
        station,
      );
      console.log("[SongGhost] memoryPresetSaved", { slot, stationId: station.id });
    },
    [saveMemoryPreset, resolveHostId],
  );

  const launchStudioMix = useCallback(
    (mix: StudioMixShelfItem) => {
      if (!mix.manifest) return;
      primeAudioOnGesture();
      const station = studioManifestToStation(mix.manifest);
      const hostId = mix.manifest.djConfig?.personaId ?? station.defaultPersonaId;
      setArtistRadioMode(false);
      setActiveStation(station);
      setActivePersonaId(hostId);
      if (mix.manifest.djConfig?.customDirectives) {
        setStationConfig(station.id, {
          vibePrompt: mix.manifest.djConfig.customDirectives,
          hostPersonaId: hostId,
        });
      } else {
        setStationConfig(station.id, { hostPersonaId: hostId });
      }
      beginStationSession(station, station.tracks, hostId);
      handoffToWebOrchestrator(hostId);
      ensureListening();
    },
    [
      beginStationSession,
      ensureListening,
      handoffToWebOrchestrator,
      setActivePersonaId,
      setStationConfig,
    ],
  );

  const handlePresetAssign = useCallback(
    (slot: number) => {
      if (!activeStation) return;
      parkStationOnPreset(slot, activeStation);
    },
    [activeStation, parkStationOnPreset],
  );

  const handlePresetTune = useCallback(
    (
      preset: MemoryPreset,
      e?: { preventDefault(): void; stopPropagation(): void },
    ) => {
      e?.preventDefault();
      e?.stopPropagation();
      const station = findTunableStation(preset.stationId);
      if (!station) {
        console.warn("[SongGhost] memoryPresetMissing", { slot: preset.slot, stationId: preset.stationId });
        return;
      }
      selectStation(station, e);
    },
    [findTunableStation, selectStation],
  );

  /**
   * Host Studio pacing change. Written to the live station rather than the global
   * default so a mid-session adjustment is remembered the next time that station
   * comes up.
   */
  const handleChatterPacingChange = useCallback(
    (pacing: ChatterPacing) => {
      if (activeStation) setStationConfig(activeStation.id, { chatterPacing: pacing });
      else setChatterPacing(pacing);
    },
    [activeStation, setStationConfig, setChatterPacing],
  );

  /**
   * Companion DJ mode dropdown. Mirrors into station chatter pacing so the deck
   * pill and the orchestrator `djMode` stay aligned:
   * no_dj ↔ music_only, active ↔ talkative, balanced ↔ standard,
   * in_depth ↔ music_focused.
   */
  const handleDjModeChange = useCallback(
    (mode: DjMode) => {
      setDjMode(mode);
      setDjTuning((prev) => ({ ...prev, pace: djModeToPace(mode) }));
      const pacing: ChatterPacing =
        mode === "no_dj"
          ? "music_only"
          : mode === "active"
            ? "talkative"
            : mode === "in_depth"
              ? "music_focused"
              : "standard";
      handleChatterPacingChange(pacing);
    },
    [handleChatterPacingChange],
  );

  /** Tuning Console save — pace drives mode/chatter; mood/personality/knowledge hit generate-script. */
  const handleDjTuningChange = useCallback(
    (next: DjTuningSettings) => {
      const paceChanged = next.pace !== djTuning.pace;
      setDjTuning(next);
      if (paceChanged) {
        handleDjModeChange(djPaceToMode(next.pace));
      }
      setCompanionDjTuning({
        mood: next.mood,
        personality: next.personality,
        knowledge: next.knowledge,
      });
    },
    [djTuning.pace, handleDjModeChange, setCompanionDjTuning],
  );

  /** Host pick from the Tuning Console — live station override + next break voice. */
  const handleDjHostChange = useCallback(
    (personaId: PersonaId) => {
      setActivePersonaId(personaId);
      if (activeStation) {
        setStationConfig(activeStation.id, { hostPersonaId: personaId });
      }
    },
    [setActivePersonaId, activeStation, setStationConfig],
  );

  const handleRemoveTrack = useCallback((index: number) => {
    playerRef.current?.removeTrack(index);
  }, []);

  const handleReorderTrack = useCallback((fromIndex: number, toIndex: number) => {
    playerRef.current?.reorderQueue(fromIndex, toIndex);
  }, []);

  const handleJumpToTrack = useCallback((index: number) => {
    playerRef.current?.jumpToTrack(index);
  }, []);

  const handleShuffleRemaining = useCallback(() => {
    playerRef.current?.shuffleRemainingTracks();
  }, []);

  const handleInsertNext = useCallback((track: StationTrack) => {
    playerRef.current?.insertTrackNext(track);
  }, []);

  const handleAppendTrack = useCallback((track: StationTrack) => {
    playerRef.current?.appendTrack(track);
  }, []);

  /**
   * The track the feedback controls act on.
   *
   * Read from the queue rather than from `nowPlaying`, which carries only a
   * YouTube id and holds station copy while a session is tuning in. A
   * preview-only track has no YouTube id at all, and would otherwise be
   * unfavoritable and unbannable.
   */
  const onAirTrack = queueState.queue[queueState.currentIndex];
  const onAirTrackId = onAirTrack ? trackIdentity(onAirTrack) : nowPlaying.youtubeId;
  const onAirArtist = onAirTrack?.artist ?? nowPlaying.artist;

  const handleToggleFavorite = useCallback(() => {
    if (!onAirTrackId) return;
    setTrackFeedback(toggleFavoriteTrack(onAirTrackId));

    // The preference store keeps the renderable copy of a favorite — title,
    // artist, and when it was saved — which the id-keyed feedback store does
    // not. Driven off the resulting state rather than toggled in parallel so
    // the two cannot drift apart.
    const youtubeId = onAirTrack?.youtubeId?.trim() || nowPlaying.youtubeId;
    if (!youtubeId) return;
    const shouldBeLiked = !isFavoriteTrack(trackFeedback, onAirTrackId);
    if (isTrackLiked(youtubeId) === shouldBeLiked) return;
    toggleLikedTrack({
      id: onAirTrackId,
      title: onAirTrack?.title ?? nowPlaying.title,
      artist: onAirArtist,
      youtubeId,
    });
  }, [
    onAirTrackId,
    onAirTrack,
    onAirArtist,
    nowPlaying.youtubeId,
    nowPlaying.title,
    trackFeedback,
    isTrackLiked,
    toggleLikedTrack,
  ]);

  /**
   * Records a ban and clears what it invalidates.
   *
   * The queue downstream was assembled before the ban existed, so the player is
   * asked to purge it — for an artist ban that can be several tracks, and for
   * the track on air it means dropping the song mid-play, which is exactly what
   * the listener just asked for.
   */
  const applyBan = useCallback((trackId: string, artist?: string) => {
    if (!trackId && !artist) return;
    setTrackFeedback(banTrack(trackId, artist));
    playerRef.current?.dropBlockedTracks();
  }, []);

  const handleBanTrack = useCallback(() => {
    applyBan(onAirTrackId);
  }, [applyBan, onAirTrackId]);

  const handleBanArtist = useCallback(() => {
    applyBan(onAirTrackId, onAirArtist);
  }, [applyBan, onAirTrackId, onAirArtist]);

  const handleTrackChange = useCallback(
    (track: { title: string; artist: string; youtubeId: string }) => {
      // Hold "Tuning in…" during Spotify station handoff — YouTube queue
      // identity must not flash over the locked companion deck.
      if (companionActive && isLaunchingStationRef.current) return;

      // Companion Spotify owns album art via playback-state; skip ytimg fetches.
      setNowPlaying((prev) => ({
        title: track.title,
        artist: track.artist,
        albumArt: companionActive
          ? prev.albumArt
          : getYouTubeThumbnail(track.youtubeId),
        youtubeId: track.youtubeId,
      }));
    },
    [companionActive],
  );

  const skipTrack = useCallback(
    (direction: "next" | "prev") => {
      if (!sessionActive) return;
      ensureListening();
      // Spotify companion owns the stream — deck skips hit the remote device.
      if (companionActive) {
        void (
          direction === "next"
            ? spotifyRemoteRef.current.next()
            : spotifyRemoteRef.current.previous()
        );
        return;
      }
      if (direction === "next") playerRef.current?.skipNext();
      else playerRef.current?.skipPrev();
    },
    [sessionActive, ensureListening, companionActive],
  );

  const togglePlayPause = useCallback(() => {
    if (!sessionActive) return;
    if (companionActive) {
      setIsPlaying((playing) => {
        const next = !playing;
        if (next) ensureListening();
        // Optimistic glyph; Spotify playback-state sync corrects if needed.
        return next;
      });
      const restoredUri =
        spotifyUriForQueueTrack(queueStateRef.current.queue[queueStateRef.current.currentIndex] ?? {}) ??
        companionNowPlaying?.uri ??
        null;
      void handlePlayPause({
        isPlaying,
        resume: () => spotifyRemoteRef.current.resume(),
        pause: () => spotifyRemoteRef.current.pause(),
        playTrack: async (uri) => {
          await playTrack({ uri });
        },
        restoredTrackUri: restoredUri,
      });
      return;
    }
    setIsPlaying((p) => {
      const next = !p;
      if (next) ensureListening();
      return next;
    });
  }, [
    sessionActive,
    ensureListening,
    companionActive,
    companionNowPlaying?.uri,
    isPlaying,
    playTrack,
  ]);

  const handleCompanionSeek = useCallback((positionSeconds: number) => {
    void spotifyRemoteRef.current.seek(Math.max(0, positionSeconds) * 1000);
  }, []);

  const accentColor = activeStation?.accentColor ?? DEFAULT_ACCENT;
  const activeStationId = sessionActive && activeStation ? activeStation.id : "";
  const onAir = sessionActive;
  /** Free tier is locked to SHORT BREAKS (`standard`) regardless of station overrides. */
  const activeChatterPacing = isFree
    ? "standard"
    : (activeSettings?.chatterPacing ?? chatterPacing);
  const activeCommentaryFormat =
    activeSettings?.commentaryFormat ?? commentaryFormat;
  /**
   * Keep Host Studio pace aligned with station chatter:
   * talkative→active, standard→balanced, music_focused→in_depth,
   * music_only→no_dj.
   */
  useEffect(() => {
    const nextMode: DjMode =
      activeChatterPacing === "music_only"
        ? "no_dj"
        : activeChatterPacing === "talkative"
          ? "active"
          : activeChatterPacing === "music_focused"
            ? "in_depth"
            : "balanced";
    setDjMode(nextMode);
    setDjTuning((prev) => ({ ...prev, pace: djModeToPace(nextMode) }));
  }, [activeChatterPacing]);

  useEffect(() => {
    if (!companionActive) return;
    setCompanionDjMode(djMode);
    if (djMode === "no_dj") {
      setCompanionDjPacingFrequency(0);
    } else if (djMode === "active") {
      setCompanionDjPacingFrequency(1);
    } else {
      setCompanionDjPacingFrequency(2);
    }
    setCompanionDjTuning({
      mood: djTuning.mood,
      personality: djTuning.personality,
      knowledge: djTuning.knowledge,
    });
  }, [
    companionActive,
    djMode,
    djTuning.mood,
    djTuning.personality,
    djTuning.knowledge,
    setCompanionDjMode,
    setCompanionDjPacingFrequency,
    setCompanionDjTuning,
  ]);

  const activeEraLock = activeSettings?.eraLock ?? "all";
  const stationMetaTag = activeStation
    ? formatStationMetaTag(activeStation, activeEraLock)
    : artistRadioMode
      ? "ARTIST • RADIO"
      : undefined;
  const deckTitle = isDjBreakInProgress ? DJ_BREAK_STATUS_TITLE : nowPlaying.title;
  const deckArtist = isDjBreakInProgress
    ? (activePersona?.name ?? "Host")
    : nowPlaying.artist;
  const canAssignPreset = Boolean(
    onAir && activeStation && findTunableStation(activeStation.id),
  );

  const feedbackControls =
    onAir && onAirTrackId ? (
      <TrackFeedbackControls
        trackId={onAirTrackId}
        artist={onAirArtist}
        isFavorite={isFavoriteTrack(trackFeedback, onAirTrackId)}
        onToggleFavorite={handleToggleFavorite}
        onBanTrack={handleBanTrack}
        onBanArtist={handleBanArtist}
      />
    ) : null;

  return (
    <main className="relative min-h-screen bg-[#09090b]">
      <AmbientCanvas
        albumArtUrl={onAir ? nowPlaying.albumArt : null}
        accentColor={accentColor}
      />
      {companionNotice && (
        <div
          role="status"
          className="sticky top-0 z-[60] flex items-center justify-between gap-3 border-b border-accent/30 bg-[#0a1a24]/95 px-4 py-2 text-sm text-accent backdrop-blur-sm"
        >
          <p className="min-w-0 flex-1 font-sans">{companionNotice}</p>
          <button
            type="button"
            onClick={dismissCompanionNotice}
            className="shrink-0 rounded-md border border-accent/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent transition-colors hover:bg-accent/20"
          >
            Dismiss
          </button>
        </div>
      )}
      <ControlDeck
        accentColor={accentColor}
        title={deckTitle}
        artist={deckArtist}
        albumArt={nowPlaying.albumArt}
        idle={!onAir}
        stationName={onAir ? (activeSettings?.name ?? "SongHost Radio") : undefined}
        personaName={activePersona?.name ?? "Host"}
        personaId={activePersonaId}
        stationMetaTag={onAir ? stationMetaTag : undefined}
        visualizerMode={visualizerMode}
        onCycleVisualizer={cycleVisualizer}
        djBreakActive={isDjBreakInProgress}
        eraLock={activeEraLock}
        albumContext={onAir ? activeSettings?.albumContext : null}
        onOpenLinerNotes={onAir ? () => setLinerNotesOpen(true) : undefined}
        onShareStation={
          onAir && activeStation ? () => openShareForStation(activeStation) : undefined
        }
        hostTuning={djTuning}
        onOpenHostSettings={() => setDjSettingsOpen(true)}
        hostSettingsOpen={djSettingsOpen}
        orchestratorStatus={orchestratorStatus}
        onBreakNow={() => {
          void triggerBreakNow();
        }}
        onSkipDj={skipActiveBreak}
        canTriggerBreak={companionActive && onAir}
        onViewPlaylist={onAir ? () => setQueueModalOpen(true) : undefined}
        onTeleprompter={
          onAir ? () => setTeleprompterOpen((open) => !open) : undefined
        }
        teleprompterOpen={teleprompterOpen}
        onBroadcastLog={() => setHistoryOpen(true)}
        trackActions={feedbackControls}
        memorySlot={
          <MemoryToolbar
            presets={memoryPresets}
            activeStationId={activeStationId}
            onTune={handlePresetTune}
            onAssign={handlePresetAssign}
            onClear={clearPreset}
            canAssign={canAssignPreset}
          />
        }
        isPlaying={isPlaying}
        onPlayPause={togglePlayPause}
        onPrev={() => skipTrack("prev")}
        onNext={() => skipTrack("next")}
        volume={volume}
        onVolumeChange={(next) => {
          setVolume(next);
          if (onAir) ensureListening();
        }}
      >
        <AudioPlayer
          ref={playerRef}
          stationId={activeStation?.id ?? ""}
          songTitle={nowPlaying.title}
          artistName={nowPlaying.artist}
          personaId={activePersonaId}
          ttsProvider={ttsProvider}
          preferredVoice={preferredVoice}
          subscriptionTier={subscriptionTier}
          djPacingFrequency={djPacingFrequency}
          chatterPacing={activeChatterPacing}
          stationName={activeSettings?.name ?? "SongHost Radio"}
          stationFrequency={activeSettings?.frequency}
          eraLock={activeEraLock}
          vibePrompt={activeSettings?.vibePrompt ?? ""}
          stationMode={activeSettings?.mode}
          albumContext={activeSettings?.albumContext}
          voiceProfile={activeSettings?.voiceProfile}
          commentaryFormat={activeCommentaryFormat}
          listenerLocation={listenerLocation}
          maxDurationInSeconds={5}
          isPlaying={isPlaying}
          volume={volume}
          stationQueueMode={onAir}
          stationTracks={stationSeedTracks}
          queueGeneration={queueGeneration}
          onTrackChange={handleTrackChange}
          onQueueChange={handleQueueChange}
          onPlayingChange={setIsPlaying}
          incrementSongCounter={incrementSongCounter}
          addToPlayHistory={addToPlayHistory}
          companionActive={companionActive}
          companionCurrentTime={
            companionActive && companionPlayback
              ? companionPlayback.progressMs / 1000
              : undefined
          }
          companionDuration={
            companionActive && companionPlayback
              ? companionPlayback.durationMs / 1000
              : undefined
          }
          onCompanionSeek={companionActive ? handleCompanionSeek : undefined}
          onCompanionPlayTrack={async (track) => {
            // Explicit Spotify play({ uris }) so Launch Radio / queue advances
            // always switch the remote device onto LinerLore's selected track.
            try {
              await launchCompanionTrackRef.current({
                personaId: activePersonaId,
                seed: {
                  trackId: track.youtubeId || `${track.artist}:${track.title}`,
                  title: track.title,
                  artist: track.artist,
                  album: track.album,
                  mode: activeSettings?.mode,
                },
                withDjBreak: false,
              });
            } catch (err) {
              console.error("[LinerLore TRACE ERROR]", err);
              throw err;
            }
          }}
          onCompanionDjBreak={async (track) => {
            // Prefer the live Spotify item so the break matches what is
            // actually playing (never re-issue play(newUri) from here).
            try {
              const token = await getValidSpotifyAccessToken();
              const current = token
                ? await getCurrentlyPlaying(token).catch((err) => {
                    console.error("[LinerLore TRACE ERROR]", err);
                    return null;
                  })
                : null;

              const scriptContext = buildCompanionScriptContextRef.current();

              if (current?.isPlaying) {
                await runCompanionDjBreakRef.current({
                  personaId: activePersonaId,
                  seed: {
                    trackId: current.id,
                    title: current.name,
                    artist: current.artists.join(", "),
                    album: current.album,
                    mode: activeSettings?.mode,
                    spotifyUri: current.uri,
                  },
                  scriptContext,
                });
                return;
              }

              await runCompanionDjBreakRef.current({
                personaId: activePersonaId,
                seed: {
                  trackId: track.youtubeId || `${track.artist}:${track.title}`,
                  title: track.title,
                  artist: track.artist,
                  album: track.album,
                  mode: activeSettings?.mode,
                },
                scriptContext,
              });
            } catch (err) {
              console.error("[LinerLore TRACE ERROR]", err);
              throw err;
            }
          }}
        />
      </ControlDeck>

      <ShareStationModal
        open={Boolean(shareStation)}
        onClose={() => setShareStation(null)}
        station={shareStation}
      />

      <HostSettingsModal
        open={djSettingsOpen}
        onClose={() => setDjSettingsOpen(false)}
        value={djTuning}
        onChange={handleDjTuningChange}
        personaId={activePersonaId}
        onPersonaChange={handleDjHostChange}
      />

      <QueueModal
        open={queueModalOpen}
        onClose={() => setQueueModalOpen(false)}
        queue={queueState.queue}
        currentIndex={queueState.currentIndex}
        isPlaying={isPlaying}
        onRemoveTrack={handleRemoveTrack}
        onReorderTrack={handleReorderTrack}
        onJumpToTrack={handleJumpToTrack}
        onShuffleRemaining={handleShuffleRemaining}
        onInsertNext={handleInsertNext}
        onAppendTrack={handleAppendTrack}
        defaultPersonaId={activePersonaId}
        onSaveStation={handleSaveStation}
      />

      {activeSettings?.albumContext ? (
        <AlbumLinerNotes
          open={linerNotesOpen}
          onClose={() => setLinerNotesOpen(false)}
          album={activeSettings.albumContext}
          currentTrackIndex={findAlbumTrackIndex(activeSettings.albumContext, nowPlaying.title)}
        />
      ) : (
        <LinerNotesDrawer
          open={linerNotesOpen}
          onClose={() => setLinerNotesOpen(false)}
          title={nowPlaying.title}
          artist={nowPlaying.artist}
          albumArtUrl={nowPlaying.albumArt}
          album={onAirTrack?.album}
          releaseYear={onAirTrack?.releaseYear}
        />
      )}

      <BroadcastHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        queue={queueState.queue}
        currentIndex={queueState.currentIndex}
        accentColor={accentColor}
      />

      <ScriptTeleprompter
        open={teleprompterOpen && onAir}
        onClose={() => setTeleprompterOpen(false)}
        accentColor={accentColor}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pb-6">
        <div className="mt-2 mb-2 flex flex-col gap-2 md:mb-0">
          <div className="flex flex-wrap items-center justify-end gap-4 md:hidden">
            <button
              type="button"
              onClick={connectSpotify}
              className="flex items-center gap-1.5 font-sans text-xs text-zinc-400 transition-colors hover:text-[#1DB954]"
            >
              <Music2 className="h-3.5 w-3.5" />
              Connect Spotify
            </button>
          </div>

          {/*
            Like/Dislike live on their own row under the action links on mobile
            portrait so they never wrap into the text-link cluster. md+ keeps
            them on the ControlDeck transport row instead.
          */}
          {feedbackControls && (
            <div className="flex justify-end md:hidden">{feedbackControls}</div>
          )}
        </div>

        <section className="relative z-30 mt-2 mb-4 rounded-2xl border border-white/[0.08] bg-[#121215]/90 p-4 shadow-xl backdrop-blur-sm sm:p-5">
          <SmartSearchBar
            onLaunch={launchArtistRadio}
            onLoadCurated={loadCuratedPlaylist}
            onLaunchAlbum={launchAlbumDeepDive}
            onLaunchSongRadio={launchSongRadio}
          />
        </section>

        <div className="space-y-8">
        <div className="relative z-10">
        <HeavyRotationShelf
          artists={heavyRotationArtists}
          loading={heavyRotationLoading}
          error={heavyRotationError}
          needsConnect={heavyRotationNeedsConnect}
          isActive={
            activeStation != null && isHeavyRotationStation(activeStation.id)
          }
          launching={heavyRotationLaunching}
          onConnect={connectSpotify}
          onPlay={() => {
            void playHeavyRotationStation();
          }}
          onRetry={() => {
            void loadHeavyRotation();
          }}
        />
        </div>

        {studioMixes.length > 0 && (
          <StudioMixesShelf
            mixes={studioMixes}
            activeStationId={activeStationId}
            onPlay={launchStudioMix}
            onRemove={removeStudioMix}
          />
        )}

        {savedStations.length > 0 && (
          <section>
            <StationCarousel
              title="My Stations"
              headerRight={
                <span className="font-mono text-xs text-zinc-500 flex items-center gap-1">
                  <ListMusic className="h-3 w-3" />
                  {savedStations.length} saved
                </span>
              }
              stations={savedStations}
              activeStationId={activeStationId}
              onSelect={selectStation}
              onDelete={deleteCustomStation}
              showAccent
              resolveEraLockFor={resolveEraLockFor}
              onShareStation={openShareForStation}
            />
          </section>
        )}

        <section className="space-y-3">
          <StationCarousel
            title="Decades"
            headerRight={
              <span className="font-mono text-xs text-zinc-500">
                {DECADE_STATIONS.length} decades
              </span>
            }
            stations={DECADE_STATIONS}
            activeStationId={activeStationId}
            onSelect={selectStation}
            resolveEraLockFor={resolveEraLockFor}
            onShareStation={openShareForStation}
            pinnedStationIds={pinnedStationIds}
            onTogglePin={handleTogglePin}
          />
        </section>

        <section className="space-y-3">
          <StationCarousel
            title="Genres"
            headerRight={
              <span className="font-mono text-xs text-zinc-500">
                {GENRE_STATIONS.length} genres
              </span>
            }
            stations={GENRE_STATIONS}
            activeStationId={activeStationId}
            onSelect={selectStation}
            resolveEraLockFor={resolveEraLockFor}
            onShareStation={openShareForStation}
            pinnedStationIds={pinnedStationIds}
            onTogglePin={handleTogglePin}
          />
        </section>
        </div>
      </div>
      <ProUpgradeModal />
      <DevTierToggle />
    </main>
  );
}
