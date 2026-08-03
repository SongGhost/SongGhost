"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { Radio, Volume2 } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { consoleActionBtnClass } from "@/components/QuickConnectors";
import TransportControls from "@/components/TransportControls";
import VUMeter from "@/components/VUMeter";

type ControlDeckProps = {
  accentColor: string;
  title: string;
  artist: string;
  albumArt: string;
  /** No station session — badge row and album art are hidden in standby state */
  idle: boolean;
  stationName?: string;
  personaName?: string;
  frequency: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  /** Mounts the audio engine's hidden video host + seek progress bar beneath the transport row */
  children?: ReactNode;
};

export default function ControlDeck({
  accentColor,
  title,
  artist,
  albumArt,
  idle,
  stationName,
  personaName,
  frequency,
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
  volume,
  onVolumeChange,
  children,
}: ControlDeckProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const hasArt = Boolean(albumArt?.trim());
  const volumePercent = Math.round(volume * 100);
  const badgeLine = [stationName, personaName].filter(Boolean).join(" · ");

  return (
    <header
      className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800/80 px-4 py-3"
      style={{ "--station-accent": accentColor } as React.CSSProperties}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 sm:gap-4">
        {/* Left: cover art + title/artist + station/persona badge */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative shrink-0 h-12 w-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            {hasArt ? (
              <Image
                src={albumArt}
                alt={`${title} album art`}
                width={48}
                height={48}
                className="h-12 w-12 object-cover"
                unoptimized
              />
            ) : (
              <Radio className="h-5 w-5 text-zinc-600" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-zinc-100 font-sans font-semibold text-sm truncate leading-tight">
              {title}
            </p>
            <p className="text-amber-400 font-mono text-xs truncate leading-tight mt-0.5">
              {artist}
            </p>
            {!idle && (
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="font-mono text-[10px] text-zinc-500 truncate tracking-wide">
                  {frequency > 0 && (
                    <span className="text-amber-500 tabular-nums font-bold mr-1.5">
                      {frequency.toFixed(1)} FM
                    </span>
                  )}
                  {badgeLine}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Center: transport controls + compact VU meter */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <TransportControls
            isPlaying={isPlaying}
            onPlayPause={onPlayPause}
            onPrev={onPrev}
            onNext={onNext}
          />
          <div className="hidden md:block">
            <VUMeter active={isPlaying} inline />
          </div>
        </div>

        {/* Right: compact volume + auth */}
        <div className="flex items-center gap-3 shrink-0 flex-1 justify-end">
          <div className="hidden sm:flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-zinc-400 shrink-0" aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={100}
              value={volumePercent}
              onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
              className="volume-range w-20 md:w-24 accent-amber-500 h-1.5 rounded-lg"
              aria-label="Volume"
            />
          </div>
          {isLoaded && !isSignedIn && (
            <SignInButton mode="modal">
              <button type="button" className={`${consoleActionBtnClass} hidden sm:inline-flex`}>
                Sign In
              </button>
            </SignInButton>
          )}
          {isLoaded && isSignedIn && (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8 ring-2 ring-amber-500/40",
                },
              }}
            />
          )}
        </div>
      </div>

      {children && <div className="max-w-6xl mx-auto mt-2">{children}</div>}
    </header>
  );
}
