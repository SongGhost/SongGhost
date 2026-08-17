"use client";

import { Loader2, Play, Radio, Sparkles } from "lucide-react";
import Image from "next/image";
import type { HeavyRotationArtist } from "@/lib/heavy-rotation";

export type HeavyRotationCardProps = {
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
  /** Spotify token present — when false, play/connect opens the soft gate. */
  spotifyConnected?: boolean;
  onConnect: () => void;
  onPlay: () => void;
  onRetry?: () => void;
  /**
   * Soft gate when the card is activated without Spotify connected.
   * Opens onboarding at Step 2 ("Connect Spotify").
   */
  onRequireSpotify?: () => void;
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
 * Heavy Rotation hero card — soft-gates to Connect Spotify when not linked.
 * Disconnected and connected states share a compact horizontal banner (~90px).
 */
export default function HeavyRotationCard({
  artists,
  loading,
  error,
  needsConnect,
  isActive,
  staged,
  launching,
  playLabel,
  spotifyConnected = false,
  onConnect,
  onPlay,
  onRetry,
  onRequireSpotify,
}: HeavyRotationCardProps) {
  const leadNames = artists
    .slice(0, 3)
    .map((a) => a.name)
    .filter(Boolean);
  const subtitle =
    leadNames.length > 0
      ? leadNames.join(" · ")
      : "Personalized from your Spotify listening history";

  const handleActivate = () => {
    if (!spotifyConnected || needsConnect) {
      if (onRequireSpotify) {
        onRequireSpotify();
        return;
      }
      onConnect();
      return;
    }
    onPlay();
  };

  const disconnected = needsConnect || !spotifyConnected;

  if (disconnected) {
    return (
      <div
        className="relative flex max-h-[90px] items-center gap-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#121215]/95 px-3 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.35)] sm:gap-4 sm:px-4"
        role="region"
        aria-label="Your Heavy Rotation"
      >
        <div
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#1DB954]/30 bg-[#1DB954]/10"
        >
          <Sparkles className="h-5 w-5 text-[#1DB954]" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans text-sm font-semibold tracking-tight text-zinc-100 sm:text-base">
            Your Heavy Rotation
          </h3>
          <p className="mt-0.5 truncate font-sans text-xs text-zinc-400">
            Personalized from your Spotify listening history
          </p>
        </div>

        <button
          type="button"
          onClick={handleActivate}
          className="shrink-0 rounded-md bg-[#1DB954] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-[#1ed760] sm:px-3.5 sm:text-[11px]"
        >
          Connect Spotify
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative flex max-h-[90px] items-center gap-3 overflow-hidden rounded-xl border bg-[#121215]/95 px-3 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.35)] sm:gap-4 sm:px-4 ${
        isActive || staged
          ? "border-accent/50 shadow-[0_0_24px_rgba(41,146,207,0.12)]"
          : "border-white/[0.08]"
      }`}
      role="region"
      aria-label="Your Heavy Rotation"
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-900">
        {loading ? (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          </div>
        ) : (
          <ArtistMosaic artists={artists} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate font-sans text-sm font-semibold tracking-tight text-zinc-100 sm:text-base">
          Your Heavy Rotation
        </h3>
        <p
          className={`mt-0.5 truncate font-sans text-xs ${
            error ? "text-red-400/90" : "text-zinc-400"
          }`}
          role={error ? "alert" : undefined}
        >
          {error
            ? error
            : loading
              ? "Tuning into your top artists…"
              : subtitle}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleActivate}
          disabled={loading || launching || artists.length === 0}
          aria-label={playLabel ?? "Play Your Station"}
          className={`inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:px-3.5 sm:text-[11px] ${
            staged || playLabel ? "shadow-[0_0_18px_rgba(41,146,207,0.35)]" : ""
          }`}
        >
          {launching || loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          )}
          Play
        </button>

        {error && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="hidden items-center rounded-md border border-white/[0.08] bg-[#121215] px-2.5 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-accent/40 hover:text-accent sm:inline-flex"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
