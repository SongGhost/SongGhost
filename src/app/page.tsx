"use client";

import { useCallback, useRef, useState } from "react";
import AICuratorModal from "@/components/AICuratorModal";
import ArtistRadioSearch from "@/components/ArtistRadioSearch";
import AudioPlayer, {
  type AudioPlayerHandle,
} from "@/components/AudioPlayer";
import ControlDeck from "@/components/ControlDeck";
import FrequencyDial from "@/components/FrequencyDial";
import PersonaSelector from "@/components/PersonaSelector";
import QuickConnectors from "@/components/QuickConnectors";
import SongDisplay from "@/components/SongDisplay";
import StationSelector from "@/components/StationSelector";
import TransportControls from "@/components/TransportControls";
import VolumeKnob from "@/components/VolumeKnob";
import VUMeter from "@/components/VUMeter";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { getPersonaById } from "@/data/personas";
import { DEFAULT_STATION, type Station, type StationTrack } from "@/data/stations";
import type { ArtistRadioResult } from "@/lib/artist-radio";
import { extractYouTubeId, getYouTubeThumbnail } from "@/lib/youtube";
import { Heart, Sparkles } from "lucide-react";
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

  const [curatorOpen, setCuratorOpen] = useState(false);
  const [queueGeneration, setQueueGeneration] = useState(0);
  const [stationSeedTracks, setStationSeedTracks] = useState<StationTrack[]>(
    DEFAULT_STATION.tracks,
  );

  const [activeStation, setActiveStation] = useState<Station>(DEFAULT_STATION);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [customUrl, setCustomUrl] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [artistRadioMode, setArtistRadioMode] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(initialNowPlaying);

  const ttsProvider: TtsProvider = userTier === "Pro" ? "elevenlabs" : "openai";
  const playerRef = useRef<AudioPlayerHandle>(null);
  const activePersona = getPersonaById(activePersonaId);

  const activeYoutubeId = customMode ? nowPlaying.youtubeId || undefined : undefined;

  const beginStationSession = useCallback(
    (station: Station, tracks: StationTrack[], personaId?: string) => {
      setStationSeedTracks(tracks);
      setQueueGeneration((g) => g + 1);
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
    },
    [beginStationSession],
  );

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
  };

  const skipTrack = useCallback((direction: "next" | "prev") => {
    if (direction === "next") playerRef.current?.skipNext();
    else playerRef.current?.skipPrev();
    setIsPlaying(true);
  }, []);

  const displayFrequency = customMode || artistRadioMode ? 99.9 : activeStation.frequency;
  const accentColor = customMode ? "#F2AD4A" : activeStation.accentColor;
  const activeStationId = customMode ? "" : activeStation.id;

  return (
    <main className="min-h-screen flex flex-col">
      <ControlDeck accentColor={accentColor}>
        <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)_auto] md:grid-rows-[auto_auto] md:gap-x-3 md:gap-y-1.5 mb-2">
          <div className="md:row-span-2 md:self-start">
            <FrequencyDial frequency={displayFrequency} compact deck />
          </div>
          <div className="min-w-0 md:col-start-2 md:row-start-1">
            <SongDisplay
              title={nowPlaying.title}
              artist={nowPlaying.artist}
              albumArt={nowPlaying.albumArt}
              compact
              deck
            />
          </div>
          <div className="hidden md:flex md:col-start-3 md:row-start-1 md:row-span-2 flex-col items-end justify-between gap-2 shrink-0 w-[168px]">
            <div className="text-right text-[10px] text-label-muted w-full">
              <p className="uppercase tracking-widest mb-0.5">Active Station</p>
              <p className="text-xs text-display leading-snug line-clamp-2">{activeStation.name}</p>
              <p className="mt-0.5 line-clamp-2">
                {activePersona?.name ?? "DJ"} · every{" "}
                {djPacingFrequency === 1 ? "song" : `${djPacingFrequency} songs`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <TransportControls
                isPlaying={isPlaying}
                onPlayPause={() => setIsPlaying((p) => !p)}
                onPrev={() => skipTrack("prev")}
                onNext={() => skipTrack("next")}
              />
              <VolumeKnob value={volume} onChange={setVolume} deck />
            </div>
          </div>
          <div className="md:col-start-2 md:row-start-2 space-y-1 min-w-0">
            <p className="text-[9px] tracking-widest text-label uppercase">DJ Host</p>
            <PersonaSelector compact />
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
        </div>

        <div className="md:grid md:grid-cols-[minmax(0,1fr)_11rem] md:gap-3 md:items-end mb-2">
          <div className="w-full max-w-full overflow-hidden min-w-0">
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
              onPlayingChange={setIsPlaying}
              incrementSongCounter={incrementSongCounter}
              addToPlayHistory={addToPlayHistory}
            />
          </div>
          <div className="hidden md:block min-w-0">
            <VUMeter active={isPlaying} compact deck />
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 md:hidden">
          <VUMeter active={isPlaying} compact deck />
          <div className="flex items-center gap-4 w-full justify-center">
            <TransportControls
              isPlaying={isPlaying}
              onPlayPause={() => setIsPlaying((p) => !p)}
              onPrev={() => skipTrack("prev")}
              onNext={() => skipTrack("next")}
            />
            <VolumeKnob value={volume} onChange={setVolume} deck />
          </div>
        </div>
      </ControlDeck>

      <AICuratorModal
        open={curatorOpen}
        onClose={() => setCuratorOpen(false)}
        onLoadPlaylist={loadCuratedPlaylist}
      />

      <div className="station-scroll-area flex-1 min-h-0 overflow-y-auto px-2 sm:px-4 md:px-6 py-3 sm:py-4">
        <div className="mx-auto w-full max-w-5xl space-y-4">
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

          <div className="relative">
            <div className="wood-trim absolute -inset-2 sm:-inset-3 rounded-[1.5rem] sm:rounded-[2rem] z-0" />
            <div className="radio-chassis relative z-10 rounded-xl sm:rounded-[1.5rem] p-4 sm:p-6 md:p-8">
              <StationSelector activeStationId={activeStationId} onSelect={selectStation} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
