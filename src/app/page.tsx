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
import PersonaSelector from "@/components/PersonaSelector";
import QueueModal from "@/components/QueueModal";
import { consoleActionBtnClass } from "@/components/QuickConnectors";
import StationCarousel from "@/components/StationCarousel";
import StationEditDrawer from "@/components/StationEditDrawer";
import ShareStationModal from "@/components/station/ShareStationModal";
import ScriptTeleprompter from "@/components/teleprompter/ScriptTeleprompter";
import TrackFeedbackControls from "@/components/TrackFeedbackControls";
import { DECADE_STATIONS, GENRE_STATIONS, getStationById } from "@/data/stations";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { useListenerLocation } from "@/hooks/useListenerLocation";
import {
  isAudioUnlockPending,
  markAudioUnlockRequested,
  primeAudioOnGesture,
} from "@/lib/audio-unlock";
import { getPersonaById } from "@/data/personas";
import { type Station, type StationTrack } from "@/data/stations";
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
import { getYouTubeThumbnail } from "@/lib/youtube";
import { ChevronDown, History, ListMusic, ScrollText } from "lucide-react";
import type { PersonaId } from "@/data/personas";
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

const INITIAL_GENRE_VISIBLE = 12;
const GENRE_LOAD_MORE_STEP = 10;
const INITIAL_DECADE_VISIBLE = 9;
const DECADE_LOAD_MORE_STEP = 8;

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

  const [visibleGenreCount, setVisibleGenreCount] = useState(INITIAL_GENRE_VISIBLE);
  const [visibleDecadeCount, setVisibleDecadeCount] = useState(INITIAL_DECADE_VISIBLE);
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
  /** Permalink token pending apply; `undefined` until the URL has been read. */
  const pendingPresetTokenRef = useRef<string | null | undefined>(undefined);
  const permalinkHydratedRef = useRef(false);
  const permalinkMissesRef = useRef(0);

  const ttsProvider: TtsProvider = userTier === "Pro" ? "elevenlabs" : "openai";
  const playerRef = useRef<AudioPlayerHandle>(null);
  const activePersona = getPersonaById(activePersonaId);
  const { location: listenerLocation, requestLocation } = useListenerLocation();

  // Deferred to the client: reading storage during render would not match the
  // markup the server streamed.
  useEffect(() => {
    setTrackFeedback(loadTrackFeedback());
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

  const loadMoreGenres = useCallback(() => {
    setVisibleGenreCount((count) =>
      Math.min(count + GENRE_LOAD_MORE_STEP, GENRE_STATIONS.length),
    );
  }, []);

  const loadMoreDecades = useCallback(() => {
    setVisibleDecadeCount((count) =>
      Math.min(count + DECADE_LOAD_MORE_STEP, DECADE_STATIONS.length),
    );
  }, []);

  const beginStationSession = useCallback(
    (station: Station, tracks: StationTrack[], personaId?: string) => {
      setSessionActive(true);
      setStationSeedTracks(tracks);
      setQueueGeneration((g) => g + 1);
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

  const selectStation = useCallback(
    (station: Station) => {
      primeAudioOnGesture();
      const hostId = resolveHostId(station);
      setArtistRadioMode(false);
      setActiveStation(station);
      setActivePersonaId(hostId);
      beginStationSession(station, station.tracks);
      ensureListening();
      console.log("[SongGhost] stationSelected", {
        stationId: station.id,
        personaId: hostId,
        eraLock: resolveEraLockFor(station),
      });
    },
    [beginStationSession, setActivePersonaId, ensureListening, resolveHostId, resolveEraLockFor],
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
      setArtistRadioMode(true);
      setActiveStation(result.station);
      setActivePersonaId(result.personaId);
      beginStationSession(result.station, result.tracks, result.personaId);
      ensureListening();
      console.log("[SongGhost] artistRadioLaunched", {
        artist: result.artistName,
        personaId: result.personaId,
        trackCount: result.tracks.length,
      });
    },
    [beginStationSession, setActivePersonaId, ensureListening],
  );

  const loadCuratedPlaylist = useCallback(
    (station: Station, tracks: StationTrack[], personaId: PersonaId) => {
      setArtistRadioMode(false);
      setActiveStation(station);
      beginStationSession(station, tracks, personaId);
      ensureListening();
    },
    [beginStationSession, ensureListening],
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
    (preset: MemoryPreset) => {
      const station = findTunableStation(preset.stationId);
      if (!station) {
        console.warn("[SongGhost] memoryPresetMissing", { slot: preset.slot, stationId: preset.stationId });
        return;
      }
      selectStation(station);
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
      setNowPlaying({
        title: track.title,
        artist: track.artist,
        albumArt: getYouTubeThumbnail(track.youtubeId),
        youtubeId: track.youtubeId,
      });
    },
    [],
  );

  const skipTrack = useCallback(
    (direction: "next" | "prev") => {
      if (!sessionActive) return;
      ensureListening();
      if (direction === "next") playerRef.current?.skipNext();
      else playerRef.current?.skipPrev();
    },
    [sessionActive, ensureListening],
  );

  const togglePlayPause = useCallback(() => {
    if (!sessionActive) return;
    setIsPlaying((p) => {
      const next = !p;
      if (next) ensureListening();
      return next;
    });
  }, [sessionActive, ensureListening]);

  const displayFrequency =
    artistRadioMode ? 99.9 : (activeSettings?.frequency ?? 0);
  const accentColor = activeStation?.accentColor ?? DEFAULT_ACCENT;
  const activeStationId = sessionActive && activeStation ? activeStation.id : "";
  const onAir = sessionActive;
  const activeChatterPacing = activeSettings?.chatterPacing ?? chatterPacing;
  const activeEraLock = activeSettings?.eraLock ?? "all";
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

  const visibleGenres = GENRE_STATIONS.slice(0, visibleGenreCount);
  const hiddenGenreCount = Math.max(0, GENRE_STATIONS.length - visibleGenreCount);
  const visibleDecades = DECADE_STATIONS.slice(0, visibleDecadeCount);
  const hiddenDecadeCount = Math.max(0, DECADE_STATIONS.length - visibleDecadeCount);

  return (
    <main className="min-h-screen bg-zinc-950">
      <ControlDeck
        accentColor={accentColor}
        title={nowPlaying.title}
        artist={nowPlaying.artist}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PersonaSelector compact />
          <div className="flex items-center gap-4">
            {onAir && (
              <button
                type="button"
                onClick={() => setQueueModalOpen(true)}
                className="flex items-center gap-1.5 font-sans text-xs text-zinc-400 hover:text-amber-400 transition-colors"
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
              className="flex items-center gap-1.5 font-sans text-xs text-zinc-400 hover:text-amber-400 transition-colors"
            >
              <History className="h-3.5 w-3.5" />
              Broadcast Log
            </button>
            {/* The deck hides its copy on narrow viewports, where the transport
                row has no space left for two more controls. */}
            {feedbackControls && <div className="flex sm:hidden">{feedbackControls}</div>}
          </div>
        </div>

        <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl shadow-xl p-5 sm:p-6">
          <ArtistRadioSearch onLaunch={launchArtistRadio} onLoadCurated={loadCuratedPlaylist} />
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
                {visibleDecades.length} / {DECADE_STATIONS.length} decades
              </span>
            }
            stations={visibleDecades}
            activeStationId={activeStationId}
            onSelect={selectStation}
            resolveHostId={resolveHostId}
            onHostOverride={handleHostOverride}
            resolveEraLockFor={resolveEraLockFor}
            onEditStation={setEditingStation}
            onShareStation={openShareForStation}
          />
          {hiddenDecadeCount > 0 && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadMoreDecades}
                className={`${consoleActionBtnClass} flex items-center gap-2`}
              >
                <ChevronDown className="h-4 w-4" />
                Load More Decades
                <span className="text-[10px] opacity-70 normal-case tracking-normal font-normal">
                  ({hiddenDecadeCount} more)
                </span>
              </button>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <StationCarousel
            title="Genres"
            headerRight={
              <span className="font-mono text-xs text-zinc-500">
                {visibleGenres.length} / {GENRE_STATIONS.length} genres
              </span>
            }
            stations={visibleGenres}
            activeStationId={activeStationId}
            onSelect={selectStation}
            resolveHostId={resolveHostId}
            onHostOverride={handleHostOverride}
            resolveEraLockFor={resolveEraLockFor}
            onEditStation={setEditingStation}
            onShareStation={openShareForStation}
          />
          {hiddenGenreCount > 0 && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={loadMoreGenres}
                className={`${consoleActionBtnClass} flex items-center gap-2`}
              >
                <ChevronDown className="h-4 w-4" />
                Load More Genres
                <span className="text-[10px] opacity-70 normal-case tracking-normal font-normal">
                  ({hiddenGenreCount} more)
                </span>
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
