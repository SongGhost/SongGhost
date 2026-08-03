"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import ArtistRadioSearch from "@/components/ArtistRadioSearch";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import ControlDeck from "@/components/ControlDeck";
import PersonaSelector from "@/components/PersonaSelector";
import QueueModal from "@/components/QueueModal";
import { consoleActionBtnClass } from "@/components/QuickConnectors";
import StationCarousel from "@/components/StationCarousel";
import { DECADE_STATIONS, GENRE_STATIONS } from "@/data/stations";
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
import { getYouTubeThumbnail } from "@/lib/youtube";
import { ChevronDown, Heart, ListMusic } from "lucide-react";
import type { PersonaId } from "@/data/personas";
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
  } = useUserPreferences();

  const [visibleGenreCount, setVisibleGenreCount] = useState(INITIAL_GENRE_VISIBLE);
  const [visibleDecadeCount, setVisibleDecadeCount] = useState(INITIAL_DECADE_VISIBLE);
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
    artistRadioMode ? 99.9 : (activeStation?.frequency ?? 0);
  const accentColor = activeStation?.accentColor ?? DEFAULT_ACCENT;
  const activeStationId = sessionActive && activeStation ? activeStation.id : "";
  const onAir = sessionActive;

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
        stationName={onAir ? (activeStation?.name ?? "SongGhost Radio") : undefined}
        personaName={onAir ? (activePersona?.name ?? "DJ") : undefined}
        frequency={displayFrequency}
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
          stationName={activeStation?.name ?? "SongGhost Radio"}
          stationFrequency={activeStation?.frequency}
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
                className="flex items-center gap-1.5 font-sans text-xs text-zinc-400 hover:text-red-400 transition-colors"
              >
                <Heart
                  className={`h-3.5 w-3.5 ${
                    isTrackLiked(nowPlaying.youtubeId) ? "fill-red-500 text-red-500" : ""
                  }`}
                />
                {isTrackLiked(nowPlaying.youtubeId) ? "Liked" : "Like track"}
              </button>
            )}
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
