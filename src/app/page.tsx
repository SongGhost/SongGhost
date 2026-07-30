"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import AICuratorModal from "@/components/AICuratorModal";
import ArtistRadioSearch from "@/components/ArtistRadioSearch";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import ControlDeck from "@/components/ControlDeck";
import PersonaSelector from "@/components/PersonaSelector";
import QuickConnectors, { consoleActionBtnClass } from "@/components/QuickConnectors";
import QueueModal from "@/components/QueueModal";
import SongDisplay from "@/components/SongDisplay";
import StationSelector, {
  GENRE_LOAD_MORE_STEP,
  INITIAL_GENRE_VISIBLE,
} from "@/components/StationSelector";
import { GENRE_STATIONS } from "@/data/stations";
import TransportControls from "@/components/TransportControls";
import VolumeKnob from "@/components/VolumeKnob";
import VUMeter from "@/components/VUMeter";
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
import { extractYouTubeId, getYouTubeThumbnail } from "@/lib/youtube";
import { Heart, ListMusic, Sparkles } from "lucide-react";
import type { PersonaId } from "@/data/personas";
import type { TtsProvider } from "@/types/voice";

const IDLE_NOW_PLAYING = {
  title: "Ready to Tune In",
  artist: "Select a station · AI Curator · Artist Radio",
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
  } = useUserPreferences();

  const [visibleGenreCount, setVisibleGenreCount] = useState(INITIAL_GENRE_VISIBLE);
  const [curatorOpen, setCuratorOpen] = useState(false);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [queueGeneration, setQueueGeneration] = useState(0);
  const [queueState, setQueueState] = useState<{ queue: StationTrack[]; currentIndex: number }>({
    queue: [],
    currentIndex: 0,
  });
  const [stationSeedTracks, setStationSeedTracks] = useState<StationTrack[]>([]);

  const [activeStation, setActiveStation] = useState<Station | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [customUrl, setCustomUrl] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [artistRadioMode, setArtistRadioMode] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(IDLE_NOW_PLAYING);

  const ttsProvider: TtsProvider = userTier === "Pro" ? "elevenlabs" : "openai";
  const playerRef = useRef<AudioPlayerHandle>(null);
  const activePersona = getPersonaById(activePersonaId);
  const { location: listenerLocation, requestLocation } = useListenerLocation();

  const ensureListening = useCallback(() => {
    markAudioUnlockRequested();
    primeAudioOnGesture();
    setIsPlaying(true);
    requestLocation();
    playerRef.current?.unlockAudio();
  }, [requestLocation]);

  useLayoutEffect(() => {
    if (!isAudioUnlockPending() || !isPlaying) return;
    if (!sessionActive && !customMode) return;
    playerRef.current?.unlockAudio();
  }, [sessionActive, customMode, isPlaying, queueGeneration, nowPlaying.youtubeId]);

  const activeYoutubeId = customMode ? nowPlaying.youtubeId || undefined : undefined;

  const loadMoreGenres = useCallback(() => {
    setVisibleGenreCount((count) =>
      Math.min(count + GENRE_LOAD_MORE_STEP, GENRE_STATIONS.length),
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
      setCustomMode(false);
      setArtistRadioMode(false);
      setActiveStation(station);
      setActivePersonaId(station.defaultPersonaId);
      beginStationSession(station, station.tracks);
      ensureListening();
      console.log("[SongGhost] stationSelected", {
        stationId: station.id,
        personaId: station.defaultPersonaId,
      });
    },
    [beginStationSession, setActivePersonaId, ensureListening],
  );

  const launchArtistRadio = useCallback(
    (result: ArtistRadioResult) => {
      setCustomMode(false);
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
      setCustomMode(false);
      setArtistRadioMode(false);
      setActiveStation(station);
      beginStationSession(station, tracks, personaId);
      ensureListening();
      setCuratorOpen(false);
    },
    [beginStationSession, ensureListening],
  );

  const handleQueueChange = useCallback((queue: StationTrack[], currentIndex: number) => {
    setQueueState({ queue, currentIndex });
  }, []);

  const handleRemoveTrack = useCallback((index: number) => {
    playerRef.current?.removeTrack(index);
  }, []);

  const handleInsertNext = useCallback((track: StationTrack) => {
    playerRef.current?.insertTrackNext(track);
  }, []);

  const handleAppendTrack = useCallback((track: StationTrack) => {
    playerRef.current?.appendTrack(track);
  }, []);

  const handleTrackChange = useCallback(
    (track: { title: string; artist: string; youtubeId: string }) => {
      setNowPlaying({
        title: track.title,
        artist: track.artist,
        albumArt: getYouTubeThumbnail(track.youtubeId),
        youtubeId: track.youtubeId,
      });
      playerRef.current?.unlockAudio();
    },
    [],
  );

  const tuneUrl = () => {
    const id = extractYouTubeId(customUrl);
    if (!id) return;

    primeAudioOnGesture();
    setCustomMode(true);
    setArtistRadioMode(false);
    setSessionActive(true);
    resetSongCounter();
    setNowPlaying({
      title: "Custom Stream",
      artist: "YouTube",
      albumArt: getYouTubeThumbnail(id),
      youtubeId: id,
    });
    ensureListening();
  };

  const skipTrack = useCallback(
    (direction: "next" | "prev") => {
      if (!sessionActive && !customMode) return;
      ensureListening();
      if (direction === "next") playerRef.current?.skipNext();
      else playerRef.current?.skipPrev();
    },
    [sessionActive, customMode, ensureListening],
  );

  const togglePlayPause = useCallback(() => {
    if (!sessionActive && !customMode) return;
    setIsPlaying((p) => {
      const next = !p;
      if (next) ensureListening();
      return next;
    });
  }, [sessionActive, customMode, ensureListening]);

  const displayFrequency =
    customMode || artistRadioMode ? 99.9 : (activeStation?.frequency ?? 0);
  const accentColor = customMode ? "#F2AD4A" : (activeStation?.accentColor ?? DEFAULT_ACCENT);
  const activeStationId = sessionActive && activeStation && !customMode ? activeStation.id : "";
  const onAir = sessionActive || customMode;

  return (
    <main className="app-shell min-h-screen flex flex-col lg:h-screen lg:overflow-hidden lg:flex-row">
      <ControlDeck accentColor={accentColor}>
        {/* Band 1: Now Playing + Progress + Active Station */}
        <section className="deck-section deck-section-tune space-y-2">
          <div className="min-w-0">
            <SongDisplay
              title={nowPlaying.title}
              artist={nowPlaying.artist}
              albumArt={nowPlaying.albumArt}
              compact
              deck
              idle={!onAir}
            />
            <div className="console-inset-plate !p-4 mt-0">
              <AudioPlayer
                ref={playerRef}
                youtubeId={activeYoutubeId}
                stationId={activeStation?.id ?? ""}
                songTitle={nowPlaying.title}
                artistName={nowPlaying.artist}
                personaId={activePersonaId}
                ttsProvider={ttsProvider}
                djPacingFrequency={djPacingFrequency}
                stationName={activeStation?.name ?? "SongGhost Radio"}
                listenerLocation={listenerLocation}
                maxDurationInSeconds={5}
                isPlaying={isPlaying}
                volume={volume}
                stationQueueMode={onAir && !customMode}
                stationTracks={stationSeedTracks}
                queueGeneration={queueGeneration}
                onTrackChange={handleTrackChange}
                onQueueChange={handleQueueChange}
                onPlayingChange={setIsPlaying}
                incrementSongCounter={incrementSongCounter}
                addToPlayHistory={addToPlayHistory}
              />
              {onAir ? (
                <p className="text-stone-600 font-mono text-[11px] mt-1 text-right">
                  <span className="uppercase tracking-widest">Active Station · </span>
                  <span className="text-stone-800">{activeStation?.name ?? "Custom Stream"}</span>
                  {displayFrequency > 0 && (
                    <span className="ml-2 text-amber-800 tabular-nums font-bold">
                      {displayFrequency.toFixed(1)} FM
                    </span>
                  )}
                  <span className="ml-2">
                    · {activePersona?.name ?? "DJ"} · break every{" "}
                    {djPacingFrequency === 1 ? "song" : `${djPacingFrequency} songs`}
                  </span>
                </p>
              ) : (
                <p className="text-stone-600 font-sans text-xs font-medium mt-1 text-right leading-snug">
                  Select a station below, open AI Curator, or search an artist to tune in.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Band 2: DJ Host */}
        <section className="deck-section min-w-0 space-y-2">
          <span className="chassis-badge mb-0">DJ Host</span>
          <div className="console-inset-plate !p-4 space-y-2">
            <PersonaSelector compact />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {!customMode && onAir && (
                <button
                  type="button"
                  onClick={() => setQueueModalOpen(true)}
                  className="flex items-center gap-1 font-sans text-[11px] text-stone-600 hover:text-amber-800 transition-colors"
                >
                  <ListMusic className="h-3 w-3" />
                  View Playlist
                </button>
              )}
              {nowPlaying.youtubeId && (
                <button
                  type="button"
                  onClick={() =>
                    toggleLikedTrack({
                      id: nowPlaying.youtubeId,
                      title: nowPlaying.title,
                      artist: nowPlaying.artist,
                      youtubeId: nowPlaying.youtubeId,
                    })
                  }
                  className="flex items-center gap-1 font-sans text-[11px] text-stone-600 hover:text-red-600 transition-colors"
                >
                  <Heart
                    className={`h-3 w-3 ${
                      isTrackLiked(nowPlaying.youtubeId) ? "fill-red-500 text-red-500" : ""
                    }`}
                  />
                  {isTrackLiked(nowPlaying.youtubeId) ? "Liked" : "Like track"}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Band 3: VU meter (desktop) */}
        <section className="deck-section hidden lg:block">
          <span className="chassis-badge">VU Meter</span>
          <VUMeter active={isPlaying} compact deck hideLabel />
        </section>

        {/* Band 4: Transport + Volume */}
        <section className="deck-section deck-section-transport">
          <TransportControls
            isPlaying={isPlaying}
            onPlayPause={togglePlayPause}
            onPrev={() => skipTrack("prev")}
            onNext={() => skipTrack("next")}
          />
          <VolumeKnob
            value={volume}
            onChange={(next) => {
              setVolume(next);
              if (onAir) ensureListening();
            }}
            deck
          />
          <div className="w-full lg:hidden">
            <span className="chassis-badge">VU Meter</span>
            <VUMeter active={isPlaying} compact deck hideLabel />
          </div>
        </section>
      </ControlDeck>

      <AICuratorModal
        open={curatorOpen}
        onClose={() => setCuratorOpen(false)}
        onLoadPlaylist={loadCuratedPlaylist}
      />

      <QueueModal
        open={queueModalOpen}
        onClose={() => setQueueModalOpen(false)}
        queue={queueState.queue}
        currentIndex={queueState.currentIndex}
        isPlaying={isPlaying}
        onRemoveTrack={handleRemoveTrack}
        onInsertNext={handleInsertNext}
        onAppendTrack={handleAppendTrack}
      />

      <div className="station-scroll-area app-shell-content overflow-y-auto px-2 sm:px-4 lg:px-5 xl:px-6 py-3 sm:py-4">
        <div className="space-y-4 max-w-6xl mx-auto">
          <div className="bg-birdseye-maple border border-[#9C6D3B]/60 shadow-xl rounded-2xl p-6">
            <div className="console-inset-plate mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <QuickConnectors
                    customUrl={customUrl}
                    onCustomUrlChange={setCustomUrl}
                    onTuneYouTube={tuneUrl}
                    onSpotifyConnect={() => {
                      /* Spotify OAuth — future integration */
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setCuratorOpen(true)}
                    className={`${consoleActionBtnClass} flex items-center justify-center gap-1.5 w-full`}
                  >
                    <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    AI Curator
                  </button>
                </div>
                <ArtistRadioSearch onLaunch={launchArtistRadio} />
              </div>
            </div>
          </div>

          <div className="bg-birdseye-maple border border-[#9C6D3B]/60 shadow-xl rounded-2xl p-6">
            <StationSelector
              activeStationId={activeStationId}
              onSelect={selectStation}
              visibleGenreCount={visibleGenreCount}
              onLoadMoreGenres={loadMoreGenres}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
