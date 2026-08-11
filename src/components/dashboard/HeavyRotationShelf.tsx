"use client";

import { Loader2, Play, Radio, Sparkles } from "lucide-react";
import Image from "next/image";
import type { HeavyRotationArtist } from "@/lib/heavy-rotation";

export type HeavyRotationShelfProps = {
  artists: HeavyRotationArtist[];
  loading?: boolean;
  error?: string | null;
  needsConnect?: boolean;
  isActive?: boolean;
  /** Session staged but not yet playing — emphasize the start CTA. */
  staged?: boolean;
  launching?: boolean;
  /** Override the primary play button label. */
  playLabel?: string;
  onConnect: () => void;
  onPlay: () => void;
  onRetry?: () => void;
};

function ArtistMosaic({ artists }: { artists: HeavyRotationArtist[] }) {
  const tiles = artists.slice(0, 4);
  if (tiles.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-900">
        <Radio className="h-10 w-10 text-accent/50" aria-hidden="true" />
      </div>
    );
  }

  if (tiles.length === 1) {
    const art = tiles[0].imageUrl;
    return art ? (
      <Image
        src={art}
        alt={`${tiles[0].name} artwork`}
        fill
        sizes="220px"
        className="object-cover"
        unoptimized
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center bg-zinc-900">
        <Radio className="h-10 w-10 text-accent/50" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2">
      {tiles.map((artist) =>
        artist.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- mosaic thumbs are arbitrary Spotify CDNs
          <img
            key={artist.id}
            src={artist.imageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            key={artist.id}
            className="flex items-center justify-center bg-zinc-900 text-[10px] font-mono uppercase tracking-widest text-zinc-600"
          >
            {artist.name.slice(0, 2)}
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Dashboard hero shelf for the listener's Spotify Heavy Rotation station.
 */
export default function HeavyRotationShelf({
  artists,
  loading,
  error,
  needsConnect,
  isActive,
  staged,
  launching,
  playLabel,
  onConnect,
  onPlay,
  onRetry,
}: HeavyRotationShelfProps) {
  const leadNames = artists
    .slice(0, 3)
    .map((a) => a.name)
    .filter(Boolean);
  const subtitle =
    leadNames.length > 0
      ? leadNames.join(" · ")
      : "Personalized from your Spotify listening history";

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-accent/90">
          Your Heavy Rotation Station
        </h2>
        <p className="mt-1 font-sans text-xs text-zinc-500">
          Auto-seeded from your top Spotify artists with personalized DJ breaks.
        </p>
      </div>

      <div
        className={`relative overflow-hidden rounded-2xl border bg-[#121215]/95 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.45)] sm:p-5 ${
          isActive || staged
            ? "border-accent/50 shadow-[0_0_24px_rgba(41,146,207,0.12)]"
            : "border-white/[0.08]"
        }`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(41, 146, 207,0.12),transparent_55%)]"
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative mx-auto h-36 w-36 shrink-0 overflow-hidden rounded-xl border border-white/[0.08] sm:mx-0 sm:h-40 sm:w-40">
            {loading ? (
              <div className="flex h-full w-full items-center justify-center bg-zinc-900">
                <Loader2 className="h-7 w-7 animate-spin text-accent" />
              </div>
            ) : (
              <ArtistMosaic artists={artists} />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
            <div className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-accent/80">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Listening history
            </div>
            <div>
              <h3 className="font-sans text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
                Your Heavy Rotation
              </h3>
              <p className="mt-1 line-clamp-2 font-sans text-sm text-zinc-400">
                {loading ? "Tuning into your top artists…" : subtitle}
              </p>
            </div>

            {error && (
              <p className="font-sans text-xs text-red-400/90" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {needsConnect ? (
                <button
                  type="button"
                  onClick={onConnect}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1DB954] px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-[#1ed760]"
                >
                  Connect Spotify
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPlay}
                  disabled={loading || launching || artists.length === 0}
                  className={`inline-flex items-center gap-1.5 rounded-md bg-accent font-mono font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 ${
                    staged || playLabel
                      ? "px-5 py-3 text-xs shadow-[0_0_28px_rgba(41,146,207,0.35)] sm:text-[13px]"
                      : "px-3.5 py-2 text-[11px]"
                  }`}
                >
                  {launching || loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : playLabel ? null : (
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  )}
                  {playLabel ?? "Play Your Station"}
                </button>
              )}

              {error && onRetry && !needsConnect && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#121215] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-accent/40 hover:text-accent"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
