"use client";

import { useCallback, useRef, useState } from "react";
import AICuratorModal from "@/components/AICuratorModal";
import ArtistRadioSearch from "@/components/ArtistRadioSearch";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import ControlDeck from "@/components/ControlDeck";
import PersonaSelector from "@/components/PersonaSelector";
import QuickConnectors from "@/components/QuickConnectors";
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
import { getPersonaById } from "@/data/personas";
import { DEFAULT_STATION, type Station, type StationTrack } from "@/data/stations";
import type { ArtistRadioResult } from "@/lib/artist-radio";
import { extractYouTubeId, getYouTubeThumbnail } from "@/lib/youtube";
import { Heart, ListMusic, Sparkles } from "lucide-react";
import type { PersonaId } from "@/data/personas";
import type { TtsProvider } from "@/types/voice";

function initialNowPlaying() {
  const track = DEFAULT_STATION.tracks[0];
  return {
    title: track.title,
    artist: track.artist,
    albumArt: getYouTubeThumbnail(track.youtubeId),
    youtubeId: track.youtubeId,
  };
}

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
  const [stationSeedTracks, setStationSeedTracks] = useState<StationTrack[]>(
    DEFAULT_STATION.tracks,
  );

  const [activeStation, setActiveStation] = useState<Station>(DEFAULT_STATION);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [customUrl, setCustomUrl] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [artistRadioMode, setArtistRadioMode] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(initialNowPlaying);

  const ttsProvider: TtsProvider = userTier === "Pro" ? "elevenlabs" : "openai";
  const playerRef = useRef<AudioPlayerHandle>(null);
  const activePersona = getPersonaById(activePersonaId);

  const activeYoutubeId = customMode ? nowPlaying.youtubeId || undefined : undefined;

  const loadMoreGenres = useCallback(() => {
    setVisibleGenreCount((count) =>
      Math.min(count + GENRE_LOAD_MORE_STEP, GENRE_STATIONS.length),
    );
  }, []);

  const beginStationSession = useCallback(
    (station: Station, tracks: StationTrack[], personaId?: string) => {
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
      setIsPlaying(true);
    },
    [resetSongCounter, setActivePersonaId],
  );

  const selectStation = useCallback(
    (station: Station) => {
      setCustomMode(false);
      setArtistRadioMode(false);
      setActiveStation(station);
      setActivePersonaId(station.defaultPersonaId);
      beginStationSession(station, station.tracks);
      playerRef.current?.unlockAudio();
      console.log("[SongGhost] stationSelected", {
        stationId: station.id,
        personaId: station.defaultPersonaId,
      });
    },
    [beginStationSession, setActivePersonaId],
  );

  const launchArtistRadio = useCallback(
    (result: ArtistRadioResult) => {
      setCustomMode(false);
      setArtistRadioMode(true);
      setActiveStation(result.station);
      setActivePersonaId(result.personaId);
      beginStationSession(result.station, result.tracks, result.personaId);
      playerRef.current?.unlockAudio();
      console.log("[SongGhost] artistRadioLaunched", {
        artist: result.artistName,
        personaId: result.personaId,
        trackCount: result.tracks.length,
      });
    },
    [beginStationSession, setActivePersonaId],
  );

  const loadCuratedPlaylist = useCallback(
    (station: Station, tracks: StationTrack[], personaId: PersonaId) => {
      setCustomMode(false);
      setArtistRadioMode(false);
      setActiveStation(station);
      setCuratorOpen(false);
      beginStationSession(station, tracks, personaId);
      playerRef.current?.unlockAudio();
    },
    [beginStationSession],
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

    setCustomMode(true);
    setArtistRadioMode(false);
    resetSongCounter();
    setNowPlaying({
      title: "Custom Stream",
      artist: "YouTube",
      albumArt: getYouTubeThumbnail(id),
      youtubeId: id,
    });
    setIsPlaying(true);
    playerRef.current?.unlockAudio();
  };

  const skipTrack = useCallback((direction: "next" | "prev") => {
    if (direction === "next") playerRef.current?.skipNext();
    else playerRef.current?.skipPrev();
    playerRef.current?.unlockAudio();
    setIsPlaying(true);
  }, []);

  const togglePlayPause = useCallback(() => {
    playerRef.current?.unlockAudio();
    setIsPlaying((p) => !p);
  }, []);

  const displayFrequency = customMode || artistRadioMode ? 99.9 : activeStation.frequency;
  const accentColor = customMode ? "#F2AD4A" : activeStation.accentColor;
  const activeStationId = customMode ? "" : activeStation.id;

  return (
    <main className="app-shell ca-dreamin-shell min-h-screen flex flex-col lg:h-screen lg:overflow-hidden lg:flex-row">
      <ControlDeck accentColor={accentColor}>
        {/* Band 1: Now Playing + Progress + Active Station */}
        <section className="deck-section deck-section-tune space-y-2">
          <div className="min-w-0 space-y-2">
            <SongDisplay
              title={nowPlaying.title}
              artist={nowPlaying.artist}
              albumArt={nowPlaying.albumArt}
              compact
              deck
            />
            <AudioPlayer
              ref={playerRef}
              youtubeId={activeYoutubeId}
              stationId={activeStation.id}
              songTitle={nowPlaying.title}
              artistName={nowPlaying.artist}
              personaId={activePersonaId}
              ttsProvider={ttsProvider}
              djPacingFrequency={djPacingFrequency}
              maxDurationInSeconds={5}
              isPlaying={isPlaying}
              volume={volume}
              stationQueueMode={!customMode}
              stationTracks={stationSeedTracks}
              queueGeneration={queueGeneration}
              onTrackChange={handleTrackChange}
              onQueueChange={handleQueueChange}
              onPlayingChange={setIsPlaying}
              incrementSongCounter={incrementSongCounter}
              addToPlayHistory={addToPlayHistory}
            />
          </div>
          <p className="text-[10px] text-label-muted text-right">
            <span className="uppercase tracking-widest">Active Station · </span>
            <span className="text-display">{activeStation.name}</span>
            <span className="ml-2 frequency-value tabular-nums">{displayFrequency.toFixed(1)} FM</span>
            <span className="ml-2">
              · {activePersona?.name ?? "DJ"} · every{" "}
              {djPacingFrequency === 1 ? "song" : `${djPacingFrequency} songs`}
            </span>
          </p>
        </section>

        {/* Band 2: DJ Host */}
        <section className="deck-section min-w-0 space-y-1">
          <p className="text-[9px] tracking-widest text-label uppercase">DJ Host</p>
          <PersonaSelector compact />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {!customMode && (
              <button
                type="button"
                onClick={() => setQueueModalOpen(true)}
                className="flex items-center gap-1 text-[10px] text-label-muted hover:text-amber-300/90 transition-colors"
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
                className="flex items-center gap-1 text-[10px] text-label-muted hover:text-red-400 transition-colors"
              >
                <Heart
                  className={`h-3 w-3 ${
                    isTrackLiked(nowPlaying.youtubeId) ? "fill-red-400 text-red-400" : ""
                  }`}
                />
                {isTrackLiked(nowPlaying.youtubeId) ? "Liked" : "Like track"}
              </button>
            )}
          </div>
        </section>

        {/* Band 3: VU meter (desktop) */}
        <section className="deck-section hidden lg:block">
          <VUMeter active={isPlaying} compact deck />
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
              playerRef.current?.unlockAudio();
            }}
            deck
          />
          <div className="w-full lg:hidden">
            <VUMeter active={isPlaying} compact deck />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
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
                className="ai-curator-btn flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-[10px] sm:text-xs"
              >
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                AI Curator
              </button>
            </div>
            <ArtistRadioSearch onLaunch={launchArtistRadio} />
          </div>

          <div className="radio-bezel-wrap relative">
            <div className="wood-trim absolute -inset-2 sm:-inset-3 rounded-[1.5rem] sm:rounded-[2rem] z-0" />
            <div className="radio-chassis radio-chassis-glow relative z-10 rounded-xl sm:rounded-[1.5rem] p-4 sm:p-6 md:p-8">
              <StationSelector
                activeStationId={activeStationId}
                onSelect={selectStation}
                visibleGenreCount={visibleGenreCount}
                onLoadMoreGenres={loadMoreGenres}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
