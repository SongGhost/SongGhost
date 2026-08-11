"use client";

import HeavyRotationCard from "@/components/HeavyRotationCard";
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
  /** Spotify token present — drives Connect vs Play on the card. */
  spotifyConnected?: boolean;
  onConnect: () => void;
  onPlay: () => void;
  onRetry?: () => void;
  /** Soft gate — open onboarding Step 2 when Spotify is not connected. */
  onRequireSpotify?: () => void;
};

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
  spotifyConnected,
  onConnect,
  onPlay,
  onRetry,
  onRequireSpotify,
}: HeavyRotationShelfProps) {
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

      <HeavyRotationCard
        artists={artists}
        loading={loading}
        error={error}
        needsConnect={needsConnect}
        isActive={isActive}
        staged={staged}
        launching={launching}
        playLabel={playLabel}
        spotifyConnected={spotifyConnected}
        onConnect={onConnect}
        onPlay={onPlay}
        onRetry={onRetry}
        onRequireSpotify={onRequireSpotify}
      />
    </section>
  );
}
