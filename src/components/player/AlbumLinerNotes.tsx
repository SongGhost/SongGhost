"use client";

import { Disc3, Users, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef } from "react";
import {
  formatAlbumCredit,
  type AlbumContext,
  type AlbumTrackEntry,
} from "@/types/station";

/**
 * The sleeve, on screen — cover art, credits, and the record's running order
 * with the needle's current position marked.
 *
 * Slides in from the right on desktop and up from the bottom on phones. Kept
 * mounted and translated off-screen rather than unmounted so opening it mid-set
 * never disturbs the audio engine rendered elsewhere in the player.
 */

export type AlbumLinerNotesProps = {
  open: boolean;
  onClose: () => void;
  album: AlbumContext;
  /** Position in `album.trackList` currently on air, or -1 when off the record */
  currentTrackIndex?: number;
  /** Jump the queue to a position on the record */
  onSelectTrack?: (index: number) => void;
};

function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function CreditRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="truncate font-sans text-xs text-zinc-800">{value}</p>
    </div>
  );
}

export default function AlbumLinerNotes({
  open,
  onClose,
  album,
  currentTrackIndex = -1,
  onSelectTrack,
}: AlbumLinerNotesProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLLIElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Focus moves into the panel on open and back to whatever opened it on close,
  // so a keyboard listener is never stranded behind the backdrop.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      currentRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [open, currentTrackIndex]);

  const total = album.trackList.length;
  const played = currentTrackIndex >= 0 ? currentTrackIndex + 1 : 0;
  const progressPercent = total > 0 ? (played / total) * 100 : 0;
  const credits: { label: string; value: string }[] = [
    album.releaseYear ? { label: "Released", value: String(album.releaseYear) } : null,
    album.recordingStudio ? { label: "Recorded At", value: album.recordingStudio } : null,
    album.producer ? { label: "Produced By", value: album.producer } : null,
    album.label ? { label: "Label", value: album.label } : null,
  ].filter((credit): credit is { label: string; value: string } => credit !== null);

  return (
    <>
      <button
        type="button"
        onClick={close}
        aria-hidden="true"
        tabIndex={-1}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Liner notes for ${album.albumTitle}`}
        aria-hidden={!open}
        tabIndex={-1}
        className={`fixed inset-x-0 bottom-0 z-[60] flex max-h-[88vh] flex-col overscroll-y-contain rounded-t-3xl border-t border-[#D2C5B4] bg-[#FAF8F5] shadow-2xl outline-none transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[420px] sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 ${
          open
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-x-full sm:translate-y-0"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E2D9CC] px-5 py-4">
          <div className="flex items-center gap-2">
            <Disc3 className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <h2 className="font-sans text-sm font-semibold text-zinc-900">Liner Notes</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:text-zinc-700"
            aria-label="Close liner notes"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5">
          <div className="relative mx-auto aspect-square w-full max-w-[240px] overflow-hidden rounded-xl border border-[#D2C5B4] bg-[#EAE6DF] shadow-lg">
            {album.coverArtUrl ? (
              <Image
                src={album.coverArtUrl}
                alt={`${album.albumTitle} cover art`}
                fill
                sizes="240px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Disc3 className="h-16 w-16 text-[#C8BBA8]" aria-hidden="true" />
              </div>
            )}
          </div>

          <div className="mt-4 text-center">
            <h3 className="font-sans text-lg font-semibold leading-tight text-zinc-900">
              {album.albumTitle}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-amber-700">{album.artist}</p>
            {album.releaseYear && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500 tabular-nums">
                {album.releaseYear}
              </p>
            )}
          </div>

          {credits.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#E2D9CC] pt-4">
              {credits.map((credit) => (
                <CreditRow key={credit.label} label={credit.label} value={credit.value} />
              ))}
            </div>
          )}

          {album.personnel.length > 0 && (
            <div className="mt-5 border-t border-[#E2D9CC] pt-4">
              <div className="mb-2 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  Personnel
                </p>
              </div>
              <ul className="space-y-1">
                {album.personnel.map((credit) => (
                  <li key={`${credit.name}-${credit.role}`} className="font-sans text-xs text-zinc-700">
                    {formatAlbumCredit(credit)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 border-t border-[#E2D9CC] pt-4">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                Running Order
              </p>
              <p className="font-mono text-[10px] text-zinc-500 tabular-nums">
                {played > 0 ? `${played} of ${total}` : `${total} tracks`}
              </p>
            </div>

            <div
              className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-[#E2D9CC]"
              role="progressbar"
              aria-label="Album progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={played}
            >
              <div
                className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <ol className="space-y-0.5">
              {album.trackList.map((entry: AlbumTrackEntry, index) => {
                const isCurrent = index === currentTrackIndex;
                const isPlayed = currentTrackIndex >= 0 && index < currentTrackIndex;
                const duration = formatDuration(entry.durationSeconds);
                const row = (
                  <>
                    <span
                      className={`w-5 shrink-0 text-center font-mono text-[10px] tabular-nums ${
                        isCurrent ? "font-semibold text-amber-700" : "text-zinc-400"
                      }`}
                    >
                      {isCurrent ? "▶" : entry.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate font-sans text-xs ${
                          isCurrent
                            ? "font-medium text-zinc-900"
                            : isPlayed
                              ? "text-zinc-400"
                              : "text-zinc-700"
                        }`}
                      >
                        {entry.title}
                      </span>
                      {entry.note && (
                        <span className="mt-0.5 block font-sans text-[10px] leading-snug text-zinc-500">
                          {entry.note}
                        </span>
                      )}
                    </span>
                    {entry.side && (
                      <span className="shrink-0 font-mono text-[10px] uppercase text-zinc-400">
                        {entry.side}
                      </span>
                    )}
                    {duration && (
                      <span className="shrink-0 font-mono text-[10px] text-zinc-400 tabular-nums">
                        {duration}
                      </span>
                    )}
                  </>
                );

                return (
                  <li
                    key={`${entry.position}-${entry.title}`}
                    ref={isCurrent ? currentRowRef : undefined}
                    aria-current={isCurrent ? "true" : undefined}
                  >
                    {onSelectTrack ? (
                      <button
                        type="button"
                        onClick={() => onSelectTrack(index)}
                        className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                          isCurrent
                            ? "border border-amber-500/30 bg-amber-500/15"
                            : "border border-transparent hover:bg-[#ECE8DF]/80"
                        }`}
                      >
                        {row}
                      </button>
                    ) : (
                      <div
                        className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                          isCurrent ? "border border-amber-500/30 bg-amber-500/15" : ""
                        }`}
                      >
                        {row}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}
