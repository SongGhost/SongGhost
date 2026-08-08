"use client";

import { BookOpen, Disc3, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

export type LinerNotesDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
  album?: string | null;
  /** Known year from queue / album context — API may refine */
  releaseYear?: number | null;
  /** Known label from album context — API may refine */
  label?: string | null;
};

type LinerNotesPayload = {
  releaseYear: number | null;
  label: string | null;
  genre: string | null;
  lore: string;
  artworkUrl: string | null;
};

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-0.5 truncate font-sans text-sm text-zinc-100">{value}</p>
    </div>
  );
}

/**
 * Track-level liner notes — full-bleed sleeve, release metadata, and AI lore.
 * Kept mounted and translated off-screen so open/close never remounts the
 * broadcast engine elsewhere in the tree.
 */
export default function LinerNotesDrawer({
  open,
  onClose,
  title,
  artist,
  albumArtUrl,
  album,
  releaseYear: seedYear,
  label: seedLabel,
}: LinerNotesDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<LinerNotesPayload | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch("/api/liner-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            artist,
            album: album ?? undefined,
            releaseYear: seedYear ?? undefined,
            label: seedLabel ?? undefined,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Could not load liner notes");
        }
        const data = (await res.json()) as LinerNotesPayload;
        if (cancelled) return;
        setNotes(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load liner notes");
        setNotes({
          releaseYear: seedYear ?? null,
          label: seedLabel ?? null,
          genre: null,
          lore: "Liner notes are warming up — try again in a moment.",
          artworkUrl: albumArtUrl ?? null,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, title, artist, album, seedYear, seedLabel, albumArtUrl]);

  const art = notes?.artworkUrl?.trim() || albumArtUrl?.trim() || "";
  const year = notes?.releaseYear ?? seedYear ?? null;
  const label = notes?.label ?? seedLabel ?? null;
  const genre = notes?.genre ?? null;

  return (
    <>
      <button
        type="button"
        onClick={close}
        aria-hidden="true"
        tabIndex={-1}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm transition-opacity duration-300"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Liner notes for ${title} by ${artist}`}
        aria-hidden={!open}
        tabIndex={-1}
        className={`fixed inset-x-0 bottom-0 z-[60] flex max-h-[90vh] flex-col overscroll-y-contain overflow-hidden rounded-t-3xl border-t border-white/[0.08] bg-[#121215] shadow-2xl outline-none transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 ${
          open
            ? "translate-y-0 sm:translate-x-0"
            : "translate-y-full sm:translate-x-full sm:translate-y-0"
        }`}
      >
        <div className="relative h-52 shrink-0 overflow-hidden sm:h-64">
          {art ? (
            <Image
              src={art}
              alt=""
              fill
              sizes="440px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-900">
              <Disc3 className="h-16 w-16 text-zinc-700" aria-hidden="true" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#121215] via-[#121215]/55 to-transparent" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 backdrop-blur-md">
              <BookOpen className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
                Liner Notes
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-white/10 bg-black/40 p-1.5 text-zinc-300 backdrop-blur-md transition-colors hover:text-white"
              aria-label="Close liner notes"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
            <h2 className="font-sans text-xl font-semibold leading-tight text-zinc-50 drop-shadow">
              {title}
            </h2>
            <p className="mt-1 font-mono text-xs text-accent/90">{artist}</p>
            {album && (
              <p className="mt-0.5 truncate font-sans text-xs text-zinc-400">{album}</p>
            )}
          </div>
        </div>

        <div className="flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4">
          <div className="grid grid-cols-2 gap-2">
            {year != null && <MetaChip label="Released" value={String(year)} />}
            {label && <MetaChip label="Label" value={label} />}
            {genre && <MetaChip label="Genre" value={genre} />}
          </div>

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Lore
            </p>
            {loading && (
              <div className="flex items-center gap-2 text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="font-sans text-sm">Pulling sleeve notes…</span>
              </div>
            )}
            {!loading && (
              <p className="font-sans text-sm leading-relaxed text-zinc-300">
                {notes?.lore ?? "No lore available for this cut yet."}
              </p>
            )}
            {error && !loading && (
              <p className="mt-2 font-mono text-[11px] text-accent/80">{error}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
