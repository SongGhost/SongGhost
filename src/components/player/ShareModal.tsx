"use client";

import { Check, Copy, Link2, Share2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ShareModalProps = {
  open: boolean;
  onClose: () => void;
  /** Public station id used in `/s/[id]` permalinks. */
  stationId: string | null;
  stationName?: string;
};

/**
 * Control Deck share sheet — copies `${origin}/s/${stationId}` with toast feedback.
 */
export default function ShareModal({
  open,
  onClose,
  stationId,
  stationName,
}: ShareModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const shareUrl = useMemo(() => {
    if (!stationId?.trim()) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
    return `${origin}/s/${encodeURIComponent(stationId.trim())}`;
  }, [stationId]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setCopyError(null);
      setToast(null);
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

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

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
      setToast("Station link copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Couldn't copy — select the link and copy manually.");
    }
  }, [shareUrl]);

  if (!open || !stationId) return null;

  const label = stationName?.trim() || "this station";

  return (
    <>
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
          aria-labelledby="share-modal-title"
          tabIndex={-1}
          className="relative z-[71] flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl outline-none sm:rounded-2xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent/90">
                <Share2 className="h-3 w-3" aria-hidden="true" />
                Share Station
              </p>
              <h2
                id="share-modal-title"
                className="mt-1 truncate font-sans text-base font-semibold text-zinc-100"
              >
                {label}
              </h2>
              <p className="mt-0.5 font-sans text-xs text-zinc-500">
                Anyone with this link can open your station on SongHost.
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

          <div className="space-y-4 px-5 py-5">
            <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
              <Link2
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/80"
                aria-hidden="true"
              />
              <p className="break-all font-mono text-[11px] leading-relaxed text-zinc-300">
                {shareUrl}
              </p>
            </div>

            {copyError && (
              <p className="font-sans text-xs text-red-400" role="alert">
                {copyError}
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!shareUrl}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-mono text-xs font-semibold uppercase tracking-widest text-zinc-950 transition-all hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Link Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy Link
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {toast ? (
        <p
          role="status"
          className="pointer-events-none fixed bottom-20 left-1/2 z-[100] -translate-x-1/2 rounded-md border border-white/10 bg-zinc-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-200 shadow-lg backdrop-blur-sm"
        >
          {toast}
        </p>
      ) : null}
    </>
  );
}
