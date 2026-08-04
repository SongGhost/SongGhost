"use client";

import { Check, Copy, Link2, QrCode, Share2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPersonaById } from "@/data/personas";
import {
  buildStationShareUrl,
  summarizeShareableStation,
  type ShareableStationInput,
} from "@/lib/station/serializer";
import {
  getChatterPacingProfile,
  getEraDefinition,
  isEraLocked,
  isStationMode,
  type ChatterPacing,
} from "@/types/station";

export type ShareStationModalProps = {
  open: boolean;
  onClose: () => void;
  /** Snapshot of the station being shared — null renders nothing */
  station: ShareableStationInput | null;
  /** Absolute origin used to build the permalink, e.g. `window.location.origin` */
  origin?: string;
};

function qrImageUrl(shareUrl: string): string {
  const params = new URLSearchParams({
    size: "200x200",
    margin: "12",
    data: shareUrl,
  });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

function formatHostLabel(hostPersonaId: string | null | undefined): string | null {
  if (!hostPersonaId) return null;
  return getPersonaById(hostPersonaId as Parameters<typeof getPersonaById>[0])?.name ?? hostPersonaId;
}

function formatSummaryRows(station: ShareableStationInput): { label: string; value: string }[] {
  const rows = summarizeShareableStation(station).map((row) => {
    if (row.label === "Host") {
      return { ...row, value: formatHostLabel(station.hostPersonaId) ?? row.value };
    }
    if (row.label === "Chatter" && station.chatterPacing) {
      return {
        ...row,
        value: getChatterPacingProfile(station.chatterPacing as ChatterPacing).label,
      };
    }
    if (row.label === "Era" && station.eraLock && isEraLocked(station.eraLock)) {
      return { ...row, value: getEraDefinition(station.eraLock).label };
    }
    if (row.label === "Mode" && isStationMode(station.mode)) {
      return { ...row, value: "Album Deep Dive" };
    }
    return row;
  });

  // Always lead with the station name even when summarize omitted an empty one.
  if (!rows.some((row) => row.label === "Station") && station.stationId) {
    rows.unshift({ label: "Station", value: station.name?.trim() || station.stationId });
  }

  return rows;
}

export default function ShareStationModal({
  open,
  onClose,
  station,
  origin,
}: ShareStationModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const shareUrl = useMemo(() => {
    if (!station?.stationId) return "";
    const base =
      origin?.trim() ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    try {
      return buildStationShareUrl(base, station);
    } catch {
      return "";
    }
  }, [station, origin]);

  const summaryRows = useMemo(
    () => (station ? formatSummaryRows(station) : []),
    [station],
  );

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setCopyError(null);
      return;
    }
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

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement("textarea");
        input.value = shareUrl;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Couldn't copy — select the link and copy manually.");
    }
  }, [shareUrl]);

  if (!open || !station) return null;

  const stationLabel = station.name?.trim() || "this station";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
        aria-label="Close share station dialog"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-station-title"
        tabIndex={-1}
        className="relative z-[71] flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl outline-none sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-500/90">
              <Share2 className="h-3 w-3" aria-hidden="true" />
              Share Station
            </p>
            <h2
              id="share-station-title"
              className="mt-1 truncate font-sans text-base font-semibold text-zinc-100"
            >
              {stationLabel}
            </h2>
            <p className="mt-0.5 font-sans text-xs text-zinc-500">
              Anyone with the link gets this station&apos;s vibe, host, and pacing.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!shareUrl}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 font-mono text-xs font-semibold uppercase tracking-widest text-zinc-950 transition-all hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Link Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy Station Link
              </>
            )}
          </button>

          {copyError && (
            <p className="font-sans text-xs text-red-400" role="alert">
              {copyError}
            </p>
          )}

          <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:flex-row sm:items-start">
            <div className="flex h-[200px] w-[200px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-white">
              {shareUrl ? (
                // External QR renderer — keeps the modal dependency-free.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImageUrl(shareUrl)}
                  alt={`QR code for ${stationLabel}`}
                  width={200}
                  height={200}
                  className="h-[200px] w-[200px]"
                />
              ) : (
                <QrCode className="h-10 w-10 text-zinc-300" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
              <p className="flex items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500 sm:justify-start">
                <QrCode className="h-3 w-3" aria-hidden="true" />
                Scan to Tune In
              </p>
              <p className="font-sans text-xs leading-relaxed text-zinc-400">
                Point a phone camera at the code, or paste the permalink below into any browser.
              </p>
              <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-2.5 py-2">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500/80" aria-hidden="true" />
                <p className="break-all font-mono text-[10px] leading-relaxed text-zinc-400">
                  {shareUrl || "Unable to build share link"}
                </p>
              </div>
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Configuration
            </h3>
            <dl className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-zinc-900/40">
              {summaryRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-3 px-3 py-2.5"
                >
                  <dt className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    {row.label}
                  </dt>
                  <dd className="truncate text-right font-sans text-xs text-zinc-200">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
