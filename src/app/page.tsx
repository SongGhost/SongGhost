"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import ArtistRadioSearch from "@/components/ArtistRadioSearch";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import ControlDeck from "@/components/ControlDeck";
import PersonaSelector from "@/components/PersonaSelector";
import QueueModal from "@/components/QueueModal";
import SongDisplay from "@/components/SongDisplay";
import StationSelector, {
  DECADE_LOAD_MORE_STEP,
  GENRE_LOAD_MORE_STEP,
  INITIAL_DECADE_VISIBLE,
  INITIAL_GENRE_VISIBLE,
} from "@/components/StationSelector";
import { DECADE_STATIONS, GENRE_STATIONS } from "@/data/stations";
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
import { getYouTubeThumbnail } from "@/lib/youtube";
import { Heart, ListMusic } from "lucide-react";
import type { PersonaId } from "@/data/personas";
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

  return (
    <main className="app-shell min-h-screen flex flex-col lg:h-screen lg:overflow-hidden lg:flex-row">
      <ControlDeck accentColor={accentColor}>
        <div className="console-inset-plate !p-4 space-y-0">
          {/* 1. Now Playing + Progress + Active Station */}
          <div className="min-w-0">
            <SongDisplay
              title={nowPlaying.title}
              artist={nowPlaying.artist}
              albumArt={nowPlaying.albumArt}
              bare
              deck
              idle={!onAir}
            />
            <div className="mt-3">
              <AudioPlayer
                ref={playerRef}
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
                stationQueueMode={onAir}
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
                  <span className="text-stone-800">{activeStation?.name ?? "SongGhost Radio"}</span>
                  {displayFrequency > 0 && (
                    <span className="ml-2 text-amber-800 tabular-nums font-bold">
                      {displayFrequency.toFixed(1)} FM
                    </span>
                  )}
                  <span className="ml-2">· {activePersona?.name ?? "DJ"}</span>
                </p>
              ) : (
                <p className="text-stone-600 font-sans text-xs font-medium mt-1 text-right leading-snug">
                  Select a station below or search for music above.
                </p>
              )}
            </div>
          </div>

          {/* 2. DJ Host selector + actions */}
          <div className="border-t border-[#D8CFC2]/80 pt-4 mt-4 space-y-2">
            <PersonaSelector compact />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {onAir && (
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

          {/* 3. Transport + Volume */}
          <div className="border-t border-[#D8CFC2]/80 pt-4 mt-4 flex flex-wrap items-center justify-center gap-4 lg:gap-8">
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
          </div>

          {/* 4. VU meter */}
          <div className="border-t border-[#D8CFC2]/80 pt-4 mt-4">
            <VUMeter active={isPlaying} deck embedded hideLabel />
          </div>
        </div>
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

      <div className="station-scroll-area app-shell-content overflow-y-auto px-2 sm:px-4 lg:px-5 xl:px-6 py-3 sm:py-4">
        <div className="space-y-4 max-w-6xl mx-auto">
          <div className="bg-birdseye-maple border-2 border-stone-950 shadow-xl rounded-2xl p-6">
            <div className="console-inset-plate">
              <ArtistRadioSearch
                onLaunch={launchArtistRadio}
                onLoadCurated={loadCuratedPlaylist}
              />
            </div>
          </div>

          <div className="bg-birdseye-maple border-2 border-stone-950 shadow-xl rounded-2xl p-6">
            <StationSelector
              activeStationId={activeStationId}
              onSelect={selectStation}
              visibleGenreCount={visibleGenreCount}
              onLoadMoreGenres={loadMoreGenres}
              visibleDecadeCount={visibleDecadeCount}
              onLoadMoreDecades={loadMoreDecades}
              savedStations={savedStations}
              onDeleteSavedStation={deleteCustomStation}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
