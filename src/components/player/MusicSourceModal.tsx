"use client";

import { Music2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useMusicSource,
  type MusicSourceProviderId,
} from "@/context/MusicSourceContext";

type MusicSourceModalProps = {
  open: boolean;
  onClose: () => void;
};

function SpotifyLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function AppleMusicLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M23.997 6.124c0-.738-.065-1.47-.193-2.184-0.398-2.18-1.95-3.732-4.13-4.13A15.72 15.72 0 0 0 17.49.193C16.776.065 16.044 0 15.306 0H8.694c-.738 0-1.47.065-2.184.193-2.18.398-3.732 1.95-4.13 4.13A15.72 15.72 0 0 0 .193 6.51C.065 7.224 0 7.956 0 8.694v6.612c0 .738.065 1.47.193 2.184.398 2.18 1.95 3.732 4.13 4.13.714.128 1.446.193 2.184.193h6.612c.738 0 1.47-.065 2.184-.193 2.18-.398 3.732-1.95 4.13-4.13.128-.714.193-1.446.193-2.184V8.694c0-.738-.065-1.47-.193-2.184zM15.76 17.46c0 .57-.47 1.04-1.04 1.04h-1.56c-.57 0-1.04-.47-1.04-1.04V9.86l-3.25.7v6.12c0 .57-.47 1.04-1.04 1.04H6.28c-.57 0-1.04-.47-1.04-1.04V8.36c0-.48.33-.9.8-.99l7.68-1.66c.36-.08.71.19.71.57v11.18z" />
    </svg>
  );
}

type SourceCardProps = {
  provider: MusicSourceProviderId;
  name: string;
  accentClass: string;
  ringClass: string;
  logo: ReactNode;
  connected: boolean;
  active: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

function SourceCard({
  name,
  accentClass,
  ringClass,
  logo,
  connected,
  active,
  busy,
  onConnect,
  onDisconnect,
}: SourceCardProps) {
  const statusLabel = connected ? "Connected" : "Disconnected";
  const actionLabel = connected
    ? active
      ? "Disconnect"
      : "Connected"
    : "Connect";

  return (
    <div
      className={[
        "rounded-xl border bg-zinc-900/60 p-4 transition-colors",
        active
          ? `${ringClass} border-accent/50 shadow-[0_0_24px_-12px_rgba(41, 146, 207,0.55)]`
          : "border-zinc-800",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={[
              "flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950",
              accentClass,
            ].join(" ")}
          >
            {logo}
          </div>
          <div>
            <p className="font-sans text-sm font-semibold text-zinc-100">{name}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
                  connected
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-zinc-800 text-zinc-500",
                ].join(" ")}
              >
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    connected ? "bg-emerald-400" : "bg-zinc-500",
                  ].join(" ")}
                  aria-hidden="true"
                />
                {statusLabel}
              </span>
              {active && (
                <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
                  Active
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={busy || (connected && !active)}
        onClick={() => {
          if (connected && active) {
            onDisconnect();
          } else if (!connected) {
            onConnect();
          }
        }}
        className={[
          "mt-4 w-full rounded-lg border px-3 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-widest transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
          connected && active
            ? "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-red-500/50 hover:text-red-300"
            : connected
              ? "border-zinc-700 bg-zinc-950 text-zinc-500"
              : "border-accent/40 bg-accent/10 text-accent hover:border-accent hover:bg-accent/20 hover:text-accent",
        ].join(" ")}
      >
        {busy ? "Working…" : actionLabel}
      </button>
    </div>
  );
}

export default function MusicSourceModal({ open, onClose }: MusicSourceModalProps) {
  const {
    activeProvider,
    isConnecting,
    connectSpotify,
    connectApple,
    disconnect,
  } = useMusicSource();

  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // Avoid SSR/hydration mismatch — portals need document.body.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  const handleConnect = async (provider: MusicSourceProviderId) => {
    try {
      if (provider === "spotify") {
        await connectSpotify();
      } else {
        await connectApple();
        onClose();
      }
    } catch {
      // Errors are logged in the context; keep the modal open for retry.
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch {
      // Best-effort disconnect.
    }
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="music-source-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-[min(90vh,40rem)] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-accent/30 bg-zinc-950 p-6 shadow-2xl outline-none"
      >
        <header className="relative mb-5 shrink-0 pr-10">
          <h2
            id="music-source-title"
            className="font-sans text-lg font-semibold text-zinc-100"
          >
            Connect Music Source
          </h2>
          <p className="mt-1 font-sans text-sm text-zinc-500">
            Choose your primary playback engine
          </p>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-0 top-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 space-y-3">
          <SourceCard
            provider="spotify"
            name="Spotify"
            accentClass="text-[#1DB954]"
            ringClass="ring-1 ring-[#1DB954]/35"
            logo={<SpotifyLogo className="h-6 w-6" />}
            connected={activeProvider === "spotify"}
            active={activeProvider === "spotify"}
            busy={isConnecting}
            onConnect={() => void handleConnect("spotify")}
            onDisconnect={() => void handleDisconnect()}
          />
          <SourceCard
            provider="apple_music"
            name="Apple Music"
            accentClass="text-[#FC3C44]"
            ringClass="ring-1 ring-[#FC3C44]/35"
            logo={<AppleMusicLogo className="h-6 w-6" />}
            connected={activeProvider === "apple_music"}
            active={activeProvider === "apple_music"}
            busy={isConnecting}
            onConnect={() => void handleConnect("apple_music")}
            onDisconnect={() => void handleDisconnect()}
          />

          {!activeProvider && (
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              <Music2 className="h-3 w-3" aria-hidden="true" />
              No companion source connected
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
