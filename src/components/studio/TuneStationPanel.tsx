"use client";

import { Loader2, Radio, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Station, StationTrack } from "@/data/stations";
import { primeAudioOnGesture } from "@/lib/audio-unlock";
import type { EraLock } from "@/types/station";

/** Decade chips shown in the tuner (Modern maps to the 2020s era lock). */
export type TunerDecade = "60s" | "70s" | "80s" | "90s" | "2000s" | "2010s" | "Modern";

export type TunerGenreOption = {
  id: string;
  label: string;
  /** Catalog station that backs legacy `/api/station-tracks` matrix cells */
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
  /** Freeform custom year window, e.g. "1997-2005" */
  yearRange?: string;
};

export type BlueprintSeedDraft = {
  decades: TunerDecade[];
  genres: string[];
  energy: number;
  catalogDepth: number;
  yearRange?: string;
};

type TuneStationPanelProps = {
  /** Fires after tracks are resolved from `/api/station/generate` */
  onGenerate?: (result: StationTunerResult) => void;
  /** Live seed draft for Station Blueprint Builder (no catalog generate). */
  onDraftChange?: (draft: BlueprintSeedDraft) => void;
  /** Omit the Tune & Generate button — persist seeds instead of a frozen playlist. */
  seedsOnly?: boolean;
  initialDraft?: Partial<BlueprintSeedDraft>;
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

/**
 * Full genre catalog (uncoupled from decade filtering). The matrix always
 * exposes every option, sorted A–Z by label at render time.
 */
const ALL_GENRES: readonly TunerGenreOption[] = [
  { id: "afrobeats", label: "Afrobeats", stationId: "afrobeat-groove" },
  { id: "alt-rock-10s", label: "Alternative", stationId: "alternative-rock" },
  { id: "alternative", label: "Alternative", stationId: "alternative-rock" },
  { id: "ambient", label: "Ambient", stationId: "ambient-meditation" },
  { id: "bedroom", label: "Bedroom / Indie", stationId: "indie-pop" },
  { id: "blues", label: "Blues", stationId: "blues-highway" },
  { id: "britpop", label: "Britpop", stationId: "britpop-invasion" },
  { id: "classic-rock", label: "Classic Rock", stationId: "70s-classic-rock" },
  { id: "disco", label: "Disco", stationId: "disco-fever" },
  { id: "edm", label: "EDM", stationId: "house-music" },
  { id: "east-coast-hip-hop", label: "East Coast Hip-Hop", stationId: "90s-hip-hop" },
  { id: "emo", label: "Emo", stationId: "emo-screamo" },
  { id: "eurodance", label: "Eurodance", stationId: "90s-rave-edm" },
  { id: "folk", label: "Folk", stationId: "folk-acoustic" },
  { id: "funk", label: "Funk", stationId: "funk-groove" },
  { id: "garage", label: "Garage Rock", stationId: "garage-rock" },
  { id: "garage-revival", label: "Garage Revival", stationId: "garage-rock" },
  { id: "grunge", label: "Grunge", stationId: "seattle-grunge" },
  { id: "hair-metal", label: "Hair Metal", stationId: "heavy-metal" },
  { id: "crunk", label: "Hip-Hop / Crunk", stationId: "90s-hip-hop" },
  { id: "hyperpop", label: "Hyperpop / Pop", stationId: "k-pop-wave" },
  { id: "indie", label: "Indie", stationId: "indie-pop" },
  { id: "indie-pop", label: "Indie Pop", stationId: "indie-pop" },
  { id: "lofi", label: "Lo-Fi", stationId: "lofi-chillhop" },
  { id: "motown", label: "Motown", stationId: "motown-soul" },
  { id: "new-wave", label: "New Wave", stationId: "new-wave-post-punk" },
  { id: "hip-hop-80s", label: "Old-School Hip-Hop", stationId: "90s-hip-hop" },
  { id: "post-punk", label: "Post-Punk", stationId: "new-wave-post-punk" },
  { id: "prog", label: "Prog Rock", stationId: "progressive-rock" },
  { id: "psychedelic", label: "Psychedelic", stationId: "60s-psychedelic" },
  { id: "soul", label: "Soul & R&B", stationId: "soul-rnb" },
  { id: "synth-pop", label: "Synth Pop", stationId: "80s-pop-synth" },
  { id: "synthwave", label: "Synthwave", stationId: "synthwave-retro" },
  { id: "trap", label: "Trap", stationId: "drum-and-bass" },
  { id: "y2k-pop", label: "Y2K Pop", stationId: "y2k-pop-rock" },
];

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

export default function TuneStationPanel({
  onGenerate,
  onDraftChange,
  seedsOnly = false,
  initialDraft,
  disabled,
}: TuneStationPanelProps) {
  // No decade pre-selected — listener picks era (or leaves open).
  const [decades, setDecades] = useState<TunerDecade[]>(() => initialDraft?.decades ?? []);
  const [genreIds, setGenreIds] = useState<string[]>([]);
  const [yearRange, setYearRange] = useState(initialDraft?.yearRange ?? "");
  const [energy, setEnergy] = useState(initialDraft?.energy ?? 55);
  const [catalogDepth, setCatalogDepth] = useState(initialDraft?.catalogDepth ?? 35);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableGenres = useMemo(() => {
    const sorted = [...ALL_GENRES].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
    const byLabel = new Map<string, TunerGenreOption>();
    for (const genre of sorted) {
      const key = genre.label.toLowerCase();
      if (!byLabel.has(key)) byLabel.set(key, genre);
    }
    return [...byLabel.values()];
  }, []);

  const selectedGenres = useMemo(
    () => availableGenres.filter((g) => genreIds.includes(g.id)),
    [availableGenres, genreIds],
  );

  useEffect(() => {
    onDraftChange?.({
      decades,
      genres: selectedGenres.map((g) => g.label),
      energy,
      catalogDepth,
      yearRange: yearRange.trim() || undefined,
    });
  }, [catalogDepth, decades, energy, onDraftChange, selectedGenres, yearRange]);

  const toggleDecade = (decade: TunerDecade) => {
    setDecades((prev) =>
      prev.includes(decade) ? prev.filter((d) => d !== decade) : [...prev, decade],
    );
    setError(null);
  };

  const toggleGenre = (id: string) => {
    setGenreIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
    setError(null);
  };

  const trimmedYearRange = yearRange.trim();
  const canTune =
    !disabled &&
    !loading &&
    (decades.length > 0 || selectedGenres.length > 0 || trimmedYearRange.length > 0);

  const handleGenerate = async () => {
    if (seedsOnly || !onGenerate) return;
    if (loading || disabled) return;
    if (decades.length === 0 && selectedGenres.length === 0 && !trimmedYearRange) {
      setError("Pick at least one decade, genre, or custom year range.");
      return;
    }

    primeAudioOnGesture();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/station/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          energy,
          catalogDepth,
          decades,
          genres: selectedGenres.map((g) => g.label),
          yearRange: trimmedYearRange || undefined,
        }),
      });

      const data = (await res.json()) as {
        station?: Station;
        tracks?: StationTrack[];
        eraLock?: EraLock;
        energy?: number;
        catalogDepth?: number;
        decades?: TunerDecade[];
        genres?: string[];
        yearRange?: string;
        error?: string;
      };

      if (!res.ok || !data.station || !data.tracks?.length) {
        throw new Error(data.error || `Station generate failed (${res.status})`);
      }

      onGenerate({
        station: data.station,
        tracks: data.tracks,
        eraLock: data.eraLock ?? "all",
        energy: data.energy ?? energy,
        catalogDepth: data.catalogDepth ?? catalogDepth,
        decades: data.decades ?? decades,
        genres: data.genres ?? selectedGenres.map((g) => g.label),
        yearRange: data.yearRange || trimmedYearRange || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to tune station");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="mt-4 w-full min-w-0 space-y-4 overflow-visible rounded-xl border border-white/[0.08] bg-[#0c0c0f]/90 p-4"
      role="region"
      aria-label="Advanced station tuning"
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-accent">
          Advanced Tuning
        </h3>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Era / Decade
        </p>
        <div className="flex flex-wrap items-end gap-2">
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
          <label className="min-w-[9.5rem] flex-1 space-y-1 sm:max-w-[12rem]">
            <span className="block font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Custom Year Range
            </span>
            <input
              type="text"
              value={yearRange}
              onChange={(e) => setYearRange(e.target.value)}
              placeholder="1997-2005"
              disabled={disabled || loading}
              className="w-full rounded-md border border-white/[0.08] bg-[#121215] px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
              aria-label="Custom year range"
            />
          </label>
        </div>
      </div>

      <div className="w-full min-w-0 overflow-visible">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Genre Matrix
        </p>
        <div
          className="flex w-full gap-2 overflow-x-auto whitespace-nowrap py-2 scrollbar-thin scrollbar-thumb-slate-700"
          role="group"
          aria-label="Genre matrix"
        >
          {availableGenres.map((genre) => {
            const selected = genreIds.includes(genre.id);
            return (
              <button
                key={genre.id}
                type="button"
                onClick={() => toggleGenre(genre.id)}
                disabled={disabled || loading}
                aria-pressed={selected}
                className={`shrink-0 rounded-md border px-2.5 py-1 font-sans text-[11px] transition-all disabled:opacity-50 ${
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

      {!seedsOnly && (
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
      )}
    </div>
  );
}
