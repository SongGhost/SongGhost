"use client";

import { Loader2, Radio, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import type { EraLock } from "@/types/station";

/** Decade chips shown in the tuner (Modern maps to the 2020s era lock). */
export type TunerDecade = "60s" | "70s" | "80s" | "90s" | "2000s" | "2010s" | "Modern";

export type TunerGenreOption = {
  id: string;
  label: string;
  /** Catalog station that backs `/api/station-tracks` for this matrix cell */
  stationId: string;
};

export type StationTunerResult = {
  station: Station;
  tracks: StationTrack[];
  eraLock: EraLock;
  energy: number;
  catalogDepth: number;
  decades: TunerDecade[];
  genres: string[];
};

type StationTunerProps = {
  /** Fires after tracks are resolved from `/api/station-tracks` */
  onGenerate: (result: StationTunerResult) => void;
  disabled?: boolean;
};

const TUNER_DECADES: readonly TunerDecade[] = [
  "60s",
  "70s",
  "80s",
  "90s",
  "2000s",
  "2010s",
  "Modern",
] as const;

/** Fallback decade stations when no genre chip is selected. */
const DECADE_STATION_IDS: Record<TunerDecade, string> = {
  "60s": "60s-psychedelic",
  "70s": "70s-classic-rock",
  "80s": "80s-pop-synth",
  "90s": "90s-hip-hop",
  "2000s": "y2k-pop-rock",
  "2010s": "alternative-rock",
  Modern: "lofi-chillhop",
};

/**
 * Decade → era-flavored sub-genres. Selecting a decade exposes only the cells
 * that belong to that era (union when multiple decades are active).
 */
const GENRE_MATRIX: Record<TunerDecade, readonly TunerGenreOption[]> = {
  "60s": [
    { id: "psychedelic", label: "Psychedelic", stationId: "60s-psychedelic" },
    { id: "motown", label: "Motown", stationId: "motown-soul" },
    { id: "folk", label: "Folk", stationId: "folk-acoustic" },
    { id: "garage", label: "Garage Rock", stationId: "garage-rock" },
    { id: "blues", label: "Blues", stationId: "blues-highway" },
  ],
  "70s": [
    { id: "classic-rock", label: "Classic Rock", stationId: "70s-classic-rock" },
    { id: "disco", label: "Disco", stationId: "disco-fever" },
    { id: "funk", label: "Funk", stationId: "funk-groove" },
    { id: "prog", label: "Prog Rock", stationId: "progressive-rock" },
    { id: "soul", label: "Soul & R&B", stationId: "soul-rnb" },
  ],
  "80s": [
    { id: "synth-pop", label: "Synth Pop", stationId: "80s-pop-synth" },
    { id: "new-wave", label: "New Wave", stationId: "new-wave-post-punk" },
    { id: "hair-metal", label: "Hair Metal", stationId: "heavy-metal" },
    { id: "hip-hop-80s", label: "Old-School Hip-Hop", stationId: "90s-hip-hop" },
    { id: "post-punk", label: "Post-Punk", stationId: "new-wave-post-punk" },
  ],
  "90s": [
    { id: "grunge", label: "Grunge", stationId: "seattle-grunge" },
    { id: "alternative", label: "Alternative", stationId: "alternative-rock" },
    { id: "east-coast-hip-hop", label: "East Coast Hip-Hop", stationId: "90s-hip-hop" },
    { id: "eurodance", label: "Eurodance", stationId: "90s-rave-edm" },
    { id: "britpop", label: "Britpop", stationId: "britpop-invasion" },
  ],
  "2000s": [
    { id: "y2k-pop", label: "Y2K Pop", stationId: "y2k-pop-rock" },
    { id: "emo", label: "Emo", stationId: "emo-screamo" },
    { id: "garage-revival", label: "Garage Revival", stationId: "garage-rock" },
    { id: "indie", label: "Indie", stationId: "indie-pop" },
    { id: "crunk", label: "Hip-Hop / Crunk", stationId: "90s-hip-hop" },
  ],
  "2010s": [
    { id: "indie-pop", label: "Indie Pop", stationId: "indie-pop" },
    { id: "edm", label: "EDM", stationId: "house-music" },
    { id: "alt-rock-10s", label: "Alternative", stationId: "alternative-rock" },
    { id: "trap", label: "Trap", stationId: "drum-and-bass" },
    { id: "synthwave", label: "Synthwave", stationId: "synthwave-retro" },
  ],
  Modern: [
    { id: "lofi", label: "Lo-Fi", stationId: "lofi-chillhop" },
    { id: "hyperpop", label: "Hyperpop / Pop", stationId: "k-pop-wave" },
    { id: "afrobeats", label: "Afrobeats", stationId: "afrobeat-groove" },
    { id: "bedroom", label: "Bedroom / Indie", stationId: "indie-pop" },
    { id: "ambient", label: "Ambient", stationId: "ambient-meditation" },
  ],
};

function decadeToEraLock(decade: TunerDecade): EraLock {
  return decade === "Modern" ? "2020s" : decade;
}

function energyLabel(value: number): string {
  if (value <= 33) return "Mellow";
  if (value <= 66) return "Balanced";
  return "High Energy";
}

function depthLabel(value: number): string {
  if (value <= 33) return "Mainstream Hits";
  if (value <= 66) return "Mixed Catalog";
  return "Deep Cuts";
}

/** Map Catalog Depth slider → Spotify-style popularity target (hits ↔ deep). */
function depthToTargetPopularity(depth: number): number {
  // 0 = mainstream (~85), 100 = deep cuts (~40)
  return Math.round(85 - (depth / 100) * 45);
}

/** Map Energy Level slider → Spotify `target_energy` (0–1). */
function energyToTargetEnergy(energy: number): number {
  return Math.round((energy / 100) * 100) / 100;
}

function buildStationName(decades: TunerDecade[], genres: TunerGenreOption[]): string {
  const genrePart = genres.map((g) => g.label).slice(0, 2).join(" / ");
  const decadePart = decades.length ? decades.join(" · ") : "All Eras";
  if (genrePart) return `${genrePart} (${decadePart})`;
  return `${decadePart} Mix`;
}

function interleaveTracks(batches: StationTrack[][]): StationTrack[] {
  const seen = new Set<string>();
  const out: StationTrack[] = [];
  const maxLen = Math.max(0, ...batches.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const batch of batches) {
      const track = batch[i];
      if (!track) continue;
      const key = track.youtubeId || `${track.artist}::${track.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(track);
    }
  }
  return out;
}

export default function StationTuner({ onGenerate, disabled }: StationTunerProps) {
  const [decades, setDecades] = useState<TunerDecade[]>(["90s"]);
  const [genreIds, setGenreIds] = useState<string[]>(["grunge", "alternative"]);
  const [energy, setEnergy] = useState(55);
  const [catalogDepth, setCatalogDepth] = useState(35);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableGenres = useMemo(() => {
    const byId = new Map<string, TunerGenreOption>();
    const source = decades.length > 0 ? decades : TUNER_DECADES;
    for (const decade of source) {
      for (const genre of GENRE_MATRIX[decade]) {
        if (!byId.has(genre.id)) byId.set(genre.id, genre);
      }
    }
    return [...byId.values()];
  }, [decades]);

  // Drop genre chips that left the matrix when the decade selection changed.
  useEffect(() => {
    const allowed = new Set(availableGenres.map((g) => g.id));
    setGenreIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [availableGenres]);

  const selectedGenres = useMemo(
    () => availableGenres.filter((g) => genreIds.includes(g.id)),
    [availableGenres, genreIds],
  );

  const toggleDecade = (decade: TunerDecade) => {
    setDecades((prev) => {
      const next = prev.includes(decade)
        ? prev.filter((d) => d !== decade)
        : [...prev, decade];
      return next;
    });
    setError(null);
  };

  const toggleGenre = (id: string) => {
    setGenreIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
    setError(null);
  };

  const handleGenerate = async () => {
    if (loading || disabled) return;
    if (decades.length === 0 && selectedGenres.length === 0) {
      setError("Pick at least one decade or genre to tune.");
      return;
    }

    primeAudioOnGesture();
    setLoading(true);
    setError(null);

    try {
      const eraLock: EraLock =
        decades.length === 1 ? decadeToEraLock(decades[0]) : "all";

      const seedStationIds: string[] = selectedGenres.length
        ? [...new Set(selectedGenres.map((g) => g.stationId))]
        : decades.map((d) => DECADE_STATION_IDS[d]);

      const targetPopularity = depthToTargetPopularity(catalogDepth);
      const targetEnergy = energyToTargetEnergy(energy);

      // Weighted seed query: each matrix station contributes a catalog slice
      // from `/api/station-tracks`, biased by era + popularity/energy hints.
      const batches = await Promise.all(
        seedStationIds.map(async (stationId, index) => {
          const weight = seedStationIds.length - index;
          const params = new URLSearchParams({
            stationId,
            era: eraLock,
            // Hints for future weighted Spotify recommendation seeding —
            // ignored by today's route but kept on the wire for the matrix.
            target_popularity: String(targetPopularity),
            target_energy: String(targetEnergy),
            weight: String(weight),
          });
          const res = await fetch(`/api/station-tracks?${params.toString()}`);
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(body?.error || `Catalog fetch failed (${res.status})`);
          }
          const data = (await res.json()) as { tracks?: StationTrack[] };
          return data.tracks ?? [];
        }),
      );

      const tracks = interleaveTracks(batches);
      if (!tracks.length) {
        throw new Error("No tracks matched this decade/genre mix. Try loosening filters.");
      }

      const primaryStationId = seedStationIds[0];
      const template = getStationById(primaryStationId);
      const name = buildStationName(decades, selectedGenres);
      const personaId = resolveDjIdForQuery(
        [name, ...selectedGenres.map((g) => g.label), ...decades].join(" "),
        selectedGenres.map((g) => g.label.toLowerCase()),
      );

      const station: Station = {
        id: `tuner-${Date.now()}`,
        name,
        frequency: template?.frequency ?? 101.1,
        category: selectedGenres.length ? "genres" : "decades",
        defaultPersonaId: personaId,
        accentColor: template?.accentColor ?? "#2992cf",
        youtubeVideoId: tracks[0]?.youtubeId ?? template?.youtubeVideoId ?? "",
        tracks,
        description: [
          `Matrix-tuned station · Energy ${energyLabel(energy)}`,
          `· ${depthLabel(catalogDepth)}`,
          decades.length ? `· ${decades.join(", ")}` : "",
          selectedGenres.length
            ? `· ${selectedGenres.map((g) => g.label).join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      };

      onGenerate({
        station,
        tracks,
        eraLock,
        energy,
        catalogDepth,
        decades,
        genres: selectedGenres.map((g) => g.label),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to tune station");
    } finally {
      setLoading(false);
    }
  };

  const canTune = !disabled && !loading && (decades.length > 0 || selectedGenres.length > 0);

  return (
    <div
      className="mt-4 space-y-4 rounded-xl border border-white/[0.08] bg-[#0c0c0f]/90 p-4"
      role="region"
      aria-label="Decade and genre station tuner"
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-accent">
          Decade / Genre Matrix
        </h3>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Era / Decade
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Decade chips">
          {TUNER_DECADES.map((decade) => {
            const selected = decades.includes(decade);
            return (
              <button
                key={decade}
                type="button"
                onClick={() => toggleDecade(decade)}
                disabled={disabled || loading}
                aria-pressed={selected}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 ${
                  selected
                    ? "border-accent bg-accent/15 text-accent shadow-[0_0_14px_var(--brand-accent-glow)]"
                    : "border-white/[0.08] bg-[#121215] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200"
                }`}
              >
                {decade}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Genre Matrix
          {decades.length > 0 && (
            <span className="ml-2 normal-case tracking-normal text-zinc-600">
              — filtered by {decades.join(", ")}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Genre matrix">
          {availableGenres.map((genre) => {
            const selected = genreIds.includes(genre.id);
            return (
              <button
                key={genre.id}
                type="button"
                onClick={() => toggleGenre(genre.id)}
                disabled={disabled || loading}
                aria-pressed={selected}
                className={`rounded-md border px-2.5 py-1 font-sans text-[11px] transition-all disabled:opacity-50 ${
                  selected
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-white/[0.08] bg-[#121215]/80 text-zinc-400 hover:border-white/[0.14] hover:text-zinc-200"
                }`}
              >
                {genre.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            <span>Energy Level</span>
            <span className="text-zinc-400">{energyLabel(energy)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={energy}
            onChange={(e) => setEnergy(Number(e.target.value))}
            disabled={disabled || loading}
            className="volume-range h-1.5 w-full rounded-lg accent-accent"
            aria-valuetext={energyLabel(energy)}
          />
          <span className="flex justify-between font-mono text-[9px] text-zinc-600">
            <span>Mellow</span>
            <span>High Energy</span>
          </span>
        </label>

        <label className="block space-y-2">
          <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            <span>Catalog Depth</span>
            <span className="text-zinc-400">{depthLabel(catalogDepth)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={catalogDepth}
            onChange={(e) => setCatalogDepth(Number(e.target.value))}
            disabled={disabled || loading}
            className="volume-range h-1.5 w-full rounded-lg accent-accent"
            aria-valuetext={depthLabel(catalogDepth)}
          />
          <span className="flex justify-between font-mono text-[9px] text-zinc-600">
            <span>Mainstream Hits</span>
            <span>Deep Cuts</span>
          </span>
        </label>
      </div>

      {error && (
        <p className="font-sans text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          void handleGenerate();
        }}
        disabled={!canTune}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/50 bg-accent/15 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/25 disabled:pointer-events-none disabled:opacity-40"
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Tuning Station…
          </>
        ) : (
          <>
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            Tune &amp; Generate Station
          </>
        )}
      </button>
    </div>
  );
}
