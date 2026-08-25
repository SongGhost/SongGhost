"use client";

import { Mic, MicOff, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RootsTeaserBadge } from "@/components/player/HostBar";
import { useDjState } from "@/hooks/useDjState";
import { activeCueIndex, buildTeleprompterCues } from "@/lib/dj/teleprompter";
import { isRootsTeaserKind } from "@/types/dj";

/**
 * How often the reading head is re-evaluated. Cues are seconds long, so this is
 * fast enough to look continuous and slow enough to stay off the render budget
 * while the visualizer is running.
 */
const TICK_MS = 200;

/** Shared empty tail, so an off-air render does not hand hooks a fresh array. */
const NO_LINES: readonly string[] = [];

const SEGMENT_LABELS: Record<string, string> = {
  song_intro: "Intro",
  intro: "Intro",
  liner: "Intro",
  station_launch: "Intro",
  recap: "Recap",
  up_next: "Up Next",
  artist_trivia: "Trivia",
  local_events: "Local",
  stinger: "Station ID",
  roots_teaser: "Roots & Branches",
};

type ScriptTeleprompterProps = {
  open: boolean;
  onClose: () => void;
  /** Station accent, so the overlay reads as part of the deck it belongs to. */
  accentColor?: string;
};

/**
 * Live view of what the host is saying, line by line.
 *
 * Purely a reader: it subscribes to the broadcast log and owns nothing about
 * scheduling, synthesis, or playback. Line timing is estimated from the script
 * text — see `lib/dj/teleprompter` — because the TTS backends return audio with
 * no word timings to sync against.
 */
export default function ScriptTeleprompter({
  open,
  onClose,
  accentColor = "#2992cf",
}: ScriptTeleprompterProps) {
  const { activeSegment, isSpeaking, transcripts } = useDjState();
  const [elapsedMs, setElapsedMs] = useState(0);
  const activeLineRef = useRef<HTMLLIElement>(null);

  /** Falls back to the last break so the panel has something to show off air. */
  const segment = activeSegment ?? transcripts[0] ?? null;
  const onAir = Boolean(activeSegment) && isSpeaking;
  const startedAt = activeSegment?.startedAt ?? 0;
  const lines = segment?.lines ?? NO_LINES;

  // Keyed on the segment, not on its lines: the store hands out immutable
  // snapshots, so one segment is one stable identity for the life of the break.
  const cues = useMemo(() => buildTeleprompterCues(segment?.lines ?? NO_LINES), [segment]);

  // Only runs while a break is actually on air; an off-air panel is static.
  useEffect(() => {
    if (!open || !onAir || !startedAt) return;

    setElapsedMs(Date.now() - startedAt);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS);
    return () => clearInterval(timer);
  }, [open, onAir, startedAt]);

  const activeIndex = onAir ? activeCueIndex(cues, elapsedMs) : -1;

  useEffect(() => {
    if (activeIndex < 0) return;
    activeLineRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  if (!open) return null;

  const kindLabel = segment ? (SEGMENT_LABELS[segment.kind] ?? segment.kind) : "";

  return (
    <aside
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+7rem)] right-4 z-[60] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-accent/20 bg-zinc-950/70 shadow-2xl backdrop-blur-xl"
      style={{ "--station-accent": accentColor } as React.CSSProperties}
      aria-label="DJ teleprompter"
    >
      <header className="flex items-center gap-2 border-b border-zinc-800/70 bg-zinc-950/40 px-3 py-2">
        {onAir ? (
          <Mic className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
        ) : (
          <MicOff className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
        )}
        <span
          className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${
            onAir ? "text-accent" : "text-zinc-500"
          }`}
        >
          {onAir ? "On Air" : "Standby"}
        </span>
        {segment && (
          <span className="truncate rounded-md border border-zinc-700/70 bg-zinc-900/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
            {kindLabel}
          </span>
        )}
        {onAir && segment && isRootsTeaserKind(segment.kind) ? <RootsTeaserBadge /> : null}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto shrink-0 rounded-lg p-1 text-zinc-500 transition-colors hover:text-accent"
          aria-label="Close teleprompter"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div
        className="max-h-56 overflow-y-auto px-4 py-3"
        aria-live={onAir ? "polite" : "off"}
        aria-atomic="false"
      >
        {lines.length === 0 ? (
          <p className="py-4 text-center font-sans text-xs text-zinc-500">
            The host is between breaks — the script appears here as it airs.
          </p>
        ) : (
          <ol className="space-y-2">
            {lines.map((line, index) => {
              const isActive = index === activeIndex;
              const isSpoken = activeIndex > index;
              return (
                <li
                  key={`${segment?.id}-${index}`}
                  ref={isActive ? activeLineRef : undefined}
                  className={`font-sans text-sm leading-snug transition-all duration-500 ease-out ${
                    isActive
                      ? "text-zinc-50 opacity-100"
                      : isSpoken
                        ? "text-zinc-400 opacity-45"
                        : "text-zinc-300 opacity-60"
                  } ${!onAir ? "opacity-50" : ""}`}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="mr-2 inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full align-middle"
                      style={{ backgroundColor: accentColor }}
                    />
                  )}
                  {line}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {segment && (
        <footer className="border-t border-zinc-800/70 bg-zinc-950/40 px-4 py-2">
          <p className="truncate font-mono text-[10px] text-zinc-500">
            <span className="text-zinc-400">{segment.songTitle}</span>
            {segment.artistName ? ` · ${segment.artistName}` : ""}
          </p>
        </footer>
      )}
    </aside>
  );
}
