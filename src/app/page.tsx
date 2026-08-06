"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ArtistRadioSearch from "@/components/ArtistRadioSearch";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import ControlDeck from "@/components/ControlDeck";
import BroadcastHistoryDrawer from "@/components/history/BroadcastHistoryDrawer";
import MemoryToolbar from "@/components/MemoryToolbar";
import AlbumLinerNotes from "@/components/player/AlbumLinerNotes";
import DjSettingsModal from "@/components/DjSettingsModal";
import OnAirControlDeck, {
  DjActiveSettingTags,
} from "@/components/OnAirControlDeck";
import QueueModal from "@/components/QueueModal";
import StationCarousel from "@/components/StationCarousel";
import StationEditDrawer from "@/components/StationEditDrawer";
import ShareStationModal from "@/components/station/ShareStationModal";
import ScriptTeleprompter from "@/components/teleprompter/ScriptTeleprompter";
import TrackFeedbackControls from "@/components/TrackFeedbackControls";
import { DECADE_STATIONS, GENRE_STATIONS, getStationById } from "@/data/stations";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { useListenerLocation } from "@/hooks/useListenerLocation";
import {
  DJ_BREAK_STATUS_TITLE,
  useWebOrchestrator,
} from "@/hooks/useWebOrchestrator";
import {
  isAudioUnlockPending,
  markAudioUnlockRequested,
  primeAudioOnGesture,
} from "@/lib/audio-unlock";
import { getPersonaById } from "@/data/personas";
import { type Station, type StationTrack } from "@/data/stations";
import type { AlbumRadioResult } from "@/lib/album-radio";
import type { ArtistRadioResult } from "@/lib/artist-radio";
import { trackIdentity } from "@/lib/queue/builder";
import { isSavedStationId } from "@/lib/saved-stations";
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
import { History, ListMusic, Music2, ScrollText } from "lucide-react";
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

const DEFAULT_ACCENT = "#C4882A";

export default function Home() {
  const {
    activePersonaId,
    setActivePersonaId,
    userTier,
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
    memoryPresets,
    saveMemoryPreset,
    stationConfigs,
    setStationConfig,
    resetStationConfig,
  } = useUserPreferences();

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
  const [stationSeedTracks, setStationSeedTracks] = useState<StationTrack[]>([]);

  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [shareStation, setShareStation] = useState<ShareableStationInput | null>(null);
  const [activeStation, setActiveStation] = useState<Station | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [artistRadioMode, setArtistRadioMode] = useState(false);
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

  const ttsProvider: TtsProvider = userTier === "Pro" ? "elevenlabs" : "openai";
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
  } = useWebOrchestrator();
  const launchCompanionTrackRef = useRef(launchCompanionTrack);
  const runCompanionDjBreakRef = useRef(runCompanionDjBreak);
  const prefetchCompanionDjBreakRef = useRef(prefetchCompanionDjBreak);
  const resolvePrefetchTargetRef = useRef(resolvePrefetchTarget);
  const willCompanionBreakOnNextTrackRef = useRef(willCompanionBreakOnNextTrack);
  const setCompanionScriptContextRef = useRef(setCompanionScriptContext);
  const playTrackRef = useRef(playTrack);
  const spotifyRemoteRef = useRef(spotifyRemote);
  launchCompanionTrackRef.current = launchCompanionTrack;
  runCompanionDjBreakRef.current = runCompanionDjBreak;
  prefetchCompanionDjBreakRef.current = prefetchCompanionDjBreak;
  resolvePrefetchTargetRef.current = resolvePrefetchTarget;
  willCompanionBreakOnNextTrackRef.current = willCompanionBreakOnNextTrack;
  setCompanionScriptContextRef.current = setCompanionScriptContext;
  playTrackRef.current = playTrack;
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
      pendingOrchestratorHandoffRef.current = {
        personaId,
        mode,
        queueGeneration: queueGeneration + 1,
      };
    },
    [companionActive, queueGeneration],
  );

  // Deferred to the client: reading storage during render would not match the
  // markup the server streamed.
  useEffect(() => {
    setTrackFeedback(loadTrackFeedback());
    setPinnedStationIds(loadPinnedStations());
    captureSpotifyTokensFromUrl();
  }, []);

  /**
   * Preset and saved stations are the only ones a dial button can reach: artist
   * radio and curator stations are generated per launch and exist nowhere the
   * toolbar could look them up again.
   */
  const findTunableStation = useCallback(
    (stationId: string): Station | null =>
      savedStations.find((station) => station.id === stationId) ??
      getStationById(stationId) ??
      null,
    [savedStations],
  );

  const activeSettings = activeStation
    ? resolveStationSettings(activeStation, stationConfigs[activeStation.id], chatterPacing)
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
   * - Track ended (Spotify mode): do NOT advance the LinerLore station queue
   *   or force play(nextUri). Spotify advances its own queue; registerTrack
   *   on the next playing id runs Duck–Talk–Swell.
   * - Track ended (standalone only): advanceEnded → station next track.
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
      onTrackEnded: () => {
        // When Spotify is connected and driving playback, do NOT actively push
        // station queue tracks. Let Spotify's SDK advance its own queue;
        // registerTrack on the next playing id handles DJ breaks.
        if (companionActive) {
          console.log(
            "[LinerLore TRACE] Track ended in Spotify mode — skipping LinerLore active queue advance, waiting for Spotify SDK event.",
          );
          return;
        }

        // Standard LinerLore Standalone Queue logic below:
        playerRef.current?.advanceEnded();
      },
      onTrackChange: (track) => {
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
  useEffect(() => {
    if (!companionActive || !companionNowPlaying) return;
    setNowPlaying((prev) => ({
      title: companionNowPlaying.title,
      artist: companionNowPlaying.artist,
      albumArt: companionNowPlaying.albumArtUrl || prev.albumArt,
      youtubeId: companionNowPlaying.youtubeId || prev.youtubeId,
    }));
  }, [companionActive, companionNowPlaying]);

  // Keep the deck play/pause glyph in sync with the Spotify remote stream.
  const companionIsPlaying = companionPlayback?.isPlaying;
  useEffect(() => {
    if (!companionActive || companionIsPlaying === undefined) return;
    setIsPlaying(companionIsPlaying);
  }, [companionActive, companionIsPlaying]);

  /**
   * After the station queue settles on its real opener, hand off to Spotify.
   * Resolve catalog URIs for the live queue (search / curator / album results),
   * then `playTrack(uris)` + opening DJ break for the active persona.
   */
  useEffect(() => {
    const pending = pendingOrchestratorHandoffRef.current;
    if (!pending || !companionActive || !sessionActive) return;
    if (queueGeneration !== pending.queueGeneration) return;

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
        const candidates = queue.slice(currentIndex, currentIndex + 25);
        const resolved = await Promise.all(
          candidates.map(async (entry) => {
            const uri = await searchSpotifyTrackUri(
              token,
              entry.title,
              entry.artist,
            );
            return uri;
          }),
        );
        const uris = resolved.filter((uri): uri is string => Boolean(uri));

        if (uris.length > 0) {
          console.log(
            "[LinerLore TRACE 1b] playTrack(uris) → runDjBreak",
            {
              personaId,
              uriCount: uris.length,
              title: queueSeed.title,
              artist: queueSeed.artist,
            },
          );
          await playTrackRef.current({
            uri: uris,
            personaId,
            seed: { ...queueSeed, spotifyUri: uris[0] },
            withDjBreak: true,
            scriptContext: buildCompanionScriptContextRef.current(),
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
      }
    })();
  }, [queueState, companionActive, sessionActive, queueGeneration]);

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
    [stationConfigs, chatterPacing],
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

  const handleQueueChange = useCallback((queue: StationTrack[], currentIndex: number) => {
    setQueueState({ queue, currentIndex });
  }, []);

  const cycleVisualizer = useCallback(() => {
    setVisualizerMode(nextVisualizerMode(visualizerMode));
  }, [visualizerMode, setVisualizerMode]);

  const handleSaveStation = useCallback(
    (station: Station) => {
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
      saveMemoryPreset(slot, {
        stationId: station.id,
        stationName: station.name,
        frequency: station.frequency,
        accentColor: station.accentColor,
        personaId: resolveHostId(station),
      });
      console.log("[SongGhost] memoryPresetSaved", { slot, stationId: station.id });
    },
    [saveMemoryPreset, resolveHostId],
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

  const handleHostOverride = useCallback(
    (stationId: string, personaId: PersonaId | null) => {
      setStationConfig(stationId, { hostPersonaId: personaId });
      // A host swap on the live station takes effect immediately; the next break
      // is written and voiced by whoever was just assigned.
      if (activeStation?.id === stationId) {
        setActivePersonaId(personaId ?? activeStation.defaultPersonaId);
      }
    },
    [setStationConfig, activeStation, setActivePersonaId],
  );

  /**
   * Deck-side pacing change. Written to the live station rather than the global
   * default so a mid-session adjustment is remembered the next time that station
   * comes up, which is what a listener reaching for the pill actually meant.
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

  const handleStationConfigSave = useCallback(
    (stationId: string, patch: Parameters<typeof setStationConfig>[1]) => {
      const previousEra = stationConfigs[stationId]?.eraLock ?? "all";
      setStationConfig(stationId, patch);

      if (activeStation?.id !== stationId) return;

      if (patch.hostPersonaId !== undefined) {
        setActivePersonaId((patch.hostPersonaId ?? activeStation.defaultPersonaId) as PersonaId);
      }

      // The era decides what the catalog is allowed to return, so changing it on
      // the live station means the queue behind it is now wrong. Re-tune rather
      // than let off-era tracks play out the rest of the session.
      if (patch.eraLock !== undefined && patch.eraLock !== previousEra) {
        beginStationSession(activeStation, activeStation.tracks);
      }
    },
    [stationConfigs, setStationConfig, activeStation, setActivePersonaId, beginStationSession],
  );

  const handleRemoveTrack = useCallback((index: number) => {
    playerRef.current?.removeTrack(index);
  }, []);

  const handleReorderTrack = useCallback((fromIndex: number, toIndex: number) => {
    playerRef.current?.reorderQueue(fromIndex, toIndex);
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
        if (next) {
          ensureListening();
          void spotifyRemoteRef.current.resume();
        } else {
          void spotifyRemoteRef.current.pause();
        }
        return next;
      });
      return;
    }
    setIsPlaying((p) => {
      const next = !p;
      if (next) ensureListening();
      return next;
    });
  }, [sessionActive, ensureListening, companionActive]);

  const handleCompanionSeek = useCallback((positionSeconds: number) => {
    void spotifyRemoteRef.current.seek(Math.max(0, positionSeconds) * 1000);
  }, []);

  const displayFrequency =
    artistRadioMode ? 99.9 : (activeSettings?.frequency ?? 0);
  const accentColor = activeStation?.accentColor ?? DEFAULT_ACCENT;
  const activeStationId = sessionActive && activeStation ? activeStation.id : "";
  const onAir = sessionActive;
  const activeChatterPacing = activeSettings?.chatterPacing ?? chatterPacing;
  /**
   * Keep the DJ Mode dropdown aligned with the ControlDeck chatter pill:
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
  const deckTitle = isDjBreakInProgress ? DJ_BREAK_STATUS_TITLE : nowPlaying.title;
  const deckArtist = isDjBreakInProgress
    ? (activePersona?.name ?? "DJ")
    : nowPlaying.artist;
  const chatterIsStationOverride = Boolean(
    activeStation && stationConfigs[activeStation.id]?.chatterPacing,
  );
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
    <main className="min-h-screen bg-zinc-950">
      {companionNotice && (
        <div
          role="status"
          className="sticky top-0 z-[60] flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-950/95 px-4 py-2 text-sm text-amber-100 backdrop-blur-sm"
        >
          <p className="min-w-0 flex-1 font-sans">{companionNotice}</p>
          <button
            type="button"
            onClick={dismissCompanionNotice}
            className="shrink-0 rounded-md border border-amber-500/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-200 transition-colors hover:bg-amber-500/20"
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
        stationName={onAir ? (activeSettings?.name ?? "SongGhost Radio") : undefined}
        personaName={onAir ? (activePersona?.name ?? "DJ") : undefined}
        personaId={activePersonaId}
        frequency={displayFrequency}
        visualizerMode={visualizerMode}
        onCycleVisualizer={cycleVisualizer}
        chatterPacing={activeChatterPacing}
        onChatterPacingChange={handleChatterPacingChange}
        chatterIsStationOverride={chatterIsStationOverride}
        onOpenDjSettings={() => setDjSettingsOpen(true)}
        eraLock={activeEraLock}
        albumContext={onAir ? activeSettings?.albumContext : null}
        onOpenLinerNotes={() => setLinerNotesOpen(true)}
        onShareStation={
          onAir && activeStation ? () => openShareForStation(activeStation) : undefined
        }
        trackActions={feedbackControls}
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
          djPacingFrequency={djPacingFrequency}
          chatterPacing={activeChatterPacing}
          stationName={activeSettings?.name ?? "SongGhost Radio"}
          stationFrequency={activeSettings?.frequency}
          eraLock={activeEraLock}
          vibePrompt={activeSettings?.vibePrompt ?? ""}
          stationMode={activeSettings?.mode}
          albumContext={activeSettings?.albumContext}
          voiceProfile={activeSettings?.voiceProfile}
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

      <MemoryToolbar
        presets={memoryPresets}
        activeStationId={activeStationId}
        onTune={handlePresetTune}
        onAssign={handlePresetAssign}
        canAssign={canAssignPreset}
      />

      <StationEditDrawer
        open={Boolean(editingStation)}
        onClose={() => setEditingStation(null)}
        station={editingStation}
        config={editingStation ? stationConfigs[editingStation.id] : undefined}
        globalChatterPacing={chatterPacing}
        memoryPresets={memoryPresets}
        onSave={handleStationConfigSave}
        onReset={resetStationConfig}
        onSaveToPreset={parkStationOnPreset}
      />

      <ShareStationModal
        open={Boolean(shareStation)}
        onClose={() => setShareStation(null)}
        station={shareStation}
      />

      <DjSettingsModal
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
        onInsertNext={handleInsertNext}
        onAppendTrack={handleAppendTrack}
        defaultPersonaId={activePersonaId}
        onSaveStation={handleSaveStation}
      />

      {activeSettings?.albumContext && (
        <AlbumLinerNotes
          open={linerNotesOpen}
          onClose={() => setLinerNotesOpen(false)}
          album={activeSettings.albumContext}
          currentTrackIndex={findAlbumTrackIndex(activeSettings.albumContext, nowPlaying.title)}
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

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-4 md:ml-auto">
              {onAir && (
                <button
                  type="button"
                  onClick={() => setQueueModalOpen(true)}
                  className="flex items-center gap-1.5 font-sans text-xs text-zinc-400 transition-colors hover:text-amber-400"
                >
                  <ListMusic className="h-3.5 w-3.5" />
                  View Playlist
                </button>
              )}
              {onAir && (
                <button
                  type="button"
                  onClick={() => setTeleprompterOpen((open) => !open)}
                  aria-pressed={teleprompterOpen}
                  className={`flex items-center gap-1.5 font-sans text-xs transition-colors ${
                    teleprompterOpen ? "text-amber-400" : "text-zinc-400 hover:text-amber-400"
                  }`}
                >
                  <ScrollText className="h-3.5 w-3.5" />
                  Teleprompter
                </button>
              )}
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1.5 font-sans text-xs text-zinc-400 transition-colors hover:text-amber-400"
              >
                <History className="h-3.5 w-3.5" />
                Broadcast Log
              </button>
              <button
                type="button"
                onClick={() => {
                  void beginSpotifyAuth()
                    .then((authorizeUrl) => {
                      window.location.assign(authorizeUrl);
                    })
                    .catch((error) => {
                      console.error("Spotify connect failed:", error);
                    });
                }}
                className="flex items-center gap-1.5 font-sans text-xs text-zinc-400 transition-colors hover:text-[#1DB954] md:hidden"
              >
                <Music2 className="h-3.5 w-3.5" />
                Connect Spotify
              </button>
            </div>
          </div>

          <OnAirControlDeck
            status={orchestratorStatus}
            onBreakNow={() => {
              void triggerBreakNow();
            }}
            onSkipDj={skipActiveBreak}
            canTriggerBreak={companionActive && onAir}
            leading={
              <DjActiveSettingTags
                personaName={activePersona?.name ?? "DJ"}
                tuning={djTuning}
                onOpenSettings={() => setDjSettingsOpen(true)}
                settingsOpen={djSettingsOpen}
              />
            }
          />

          {/*
            Like/Dislike live on their own row under the action links on mobile
            portrait so they never wrap into the text-link cluster. md+ keeps
            them on the ControlDeck transport row instead.
          */}
          {feedbackControls && (
            <div className="flex justify-end md:hidden">{feedbackControls}</div>
          )}
        </div>

        <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl shadow-xl p-5 sm:p-6">
          <ArtistRadioSearch
            onLaunch={launchArtistRadio}
            onLoadCurated={loadCuratedPlaylist}
            onLaunchAlbum={launchAlbumDeepDive}
          />
        </section>

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
              resolveHostId={resolveHostId}
              onHostOverride={handleHostOverride}
              resolveEraLockFor={resolveEraLockFor}
              onEditStation={setEditingStation}
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
            resolveHostId={resolveHostId}
            onHostOverride={handleHostOverride}
            resolveEraLockFor={resolveEraLockFor}
            onEditStation={setEditingStation}
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
            resolveHostId={resolveHostId}
            onHostOverride={handleHostOverride}
            resolveEraLockFor={resolveEraLockFor}
            onEditStation={setEditingStation}
            onShareStation={openShareForStation}
            pinnedStationIds={pinnedStationIds}
            onTogglePin={handleTogglePin}
          />
        </section>
      </div>
    </main>
  );
}
