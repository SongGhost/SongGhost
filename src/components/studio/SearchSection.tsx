"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import SmartSearchBar from "@/components/search/SmartSearchBar";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import type { AlbumRadioResult } from "@/lib/album-radio";
import type { ArtistRadioResult } from "@/lib/artist-radio";
import type { SongRadioResult } from "@/lib/song-radio";

const SEARCH_INPUT_ID = "smart-search-input";
const MOBILE_MQ = "(max-width: 767px)";

export type SearchSectionProps = {
  onLaunch: (result: ArtistRadioResult) => void;
  onLoadCurated: (station: Station, tracks: StationTrack[], personaId: PersonaId) => void;
  onLaunchAlbum: (result: AlbumRadioResult) => void;
  onLaunchSongRadio: (result: SongRadioResult) => void;
  disabled?: boolean;
  /** Whether the Advanced Tuning (TuneStationPanel) drawer is expanded */
  tunerOpen?: boolean;
  /** Expands / collapses TuneStationPanel beneath the search input */
  onToggleTuner?: () => void;
  /** Optional TuneStationPanel (or other) rendered under the search bar. */
  children?: ReactNode;
};

/**
 * Dashboard search block — high-contrast cyan frame, Ctrl/Cmd+K focus,
 * and a full-screen search view on viewports under 768px when active.
 */
export default function SearchSection({
  onLaunch,
  onLoadCurated,
  onLaunchAlbum,
  onLaunchSongRadio,
  disabled,
  tunerOpen = false,
  onToggleTuner,
  children,
}: SearchSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const suppressFocusOpenRef = useRef(false);
  const suppressFocusOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const ignoreDismissRef = useRef(false);
  const ignoreDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobileActive, setMobileActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const focusSearchInput = useCallback(() => {
    const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
    if (!input || input.disabled) return;
    input.focus();
    input.select?.();
  }, []);

  const armMobileSearch = useCallback(() => {
    ignoreDismissRef.current = true;
    if (ignoreDismissTimerRef.current !== null) {
      clearTimeout(ignoreDismissTimerRef.current);
      ignoreDismissTimerRef.current = null;
    }
    setMobileActive(true);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (input && document.activeElement === input) {
      armMobileSearch();
    }
  }, [isMobile, armMobileSearch]);
  const dismissMobileSearch = useCallback(() => {
    setMobileActive(false);
    const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
    input?.blur();
  }, []);

  /** Close the drawer for a GENERATE/launch; ignore the post-launch focus restore. */
  const dismissMobileSearchAfterLaunch = useCallback(() => {
    suppressFocusOpenRef.current = true;
    if (suppressFocusOpenTimerRef.current !== null) {
      clearTimeout(suppressFocusOpenTimerRef.current);
    }
    dismissMobileSearch();
    suppressFocusOpenTimerRef.current = setTimeout(() => {
      suppressFocusOpenRef.current = false;
      suppressFocusOpenTimerRef.current = null;
    }, 300);
  }, [dismissMobileSearch]);

  useEffect(() => {
    return () => {
      if (suppressFocusOpenTimerRef.current !== null) {
        clearTimeout(suppressFocusOpenTimerRef.current);
      }
      if (ignoreDismissTimerRef.current !== null) {
        clearTimeout(ignoreDismissTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Allow Cmd/Ctrl+K even from other inputs — global search hotkey.
      if (tag === "textarea" && target?.dataset?.allowSearchHotkey !== "true") {
        // Still intercept — search is the primary destination.
      }
      event.preventDefault();
      if (typeof window !== "undefined" && window.matchMedia(MOBILE_MQ).matches) {
        armMobileSearch();
      }
      // Focus after drawer mount / sticky layout settles.
      window.requestAnimationFrame(() => focusSearchInput());
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearchInput, armMobileSearch]);

  useEffect(() => {
    if (!mobileActive || !isMobile) return;

    const onFocusIn = (event: FocusEvent) => {
      if (ignoreDismissRef.current) return;
      const section = sectionRef.current;
      if (!section) return;
      const next = event.target as Node | null;
      if (next && section.contains(next)) return;
      dismissMobileSearch();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissMobileSearch();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (ignoreDismissRef.current) return;
      const section = sectionRef.current;
      if (!section) return;
      if (section.contains(event.target as Node)) return;
      dismissMobileSearch();
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [mobileActive, isMobile, dismissMobileSearch]);

  const drawerOpen = isMobile && mobileActive;

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const id = window.requestAnimationFrame(() => {
      focusSearchInput();
      if (ignoreDismissTimerRef.current !== null) {
        clearTimeout(ignoreDismissTimerRef.current);
      }
      ignoreDismissTimerRef.current = setTimeout(() => {
        ignoreDismissRef.current = false;
        ignoreDismissTimerRef.current = null;
      }, 100);
    });
    return () => {
      window.cancelAnimationFrame(id);
      if (ignoreDismissTimerRef.current !== null) {
        clearTimeout(ignoreDismissTimerRef.current);
        ignoreDismissTimerRef.current = null;
      }
    };
  }, [drawerOpen, focusSearchInput]);

  const section = (
    <section
      ref={sectionRef}
      role={drawerOpen ? "dialog" : undefined}
      aria-modal={drawerOpen ? true : undefined}
      aria-label={drawerOpen ? "Search" : undefined}
      className={
        drawerOpen
          ? "fixed inset-0 z-[200] flex flex-col overflow-hidden bg-[#09090b] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          : `relative z-30 rounded-2xl border border-cyan-500/55 bg-slate-900/90 p-4 shadow-[0_0_32px_rgba(6,182,212,0.16)] backdrop-blur-sm sm:p-5 ${
              isMobile ? "sticky top-0 z-40" : ""
            }`
      }
      style={drawerOpen ? { height: "100dvh" } : undefined}
      onFocusCapture={() => {
        if (suppressFocusOpenRef.current) return;
        armMobileSearch();
      }}
    >
      {drawerOpen && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={dismissMobileSearch}
          className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200"
          aria-label="Close search"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {!drawerOpen && (
        <>
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_130%_85%_at_50%_10%,rgba(6,182,212,0.19),transparent_72%)]"
            aria-hidden="true"
          />
          <div className="relative mb-2 flex items-center justify-between gap-2">
            <label
              htmlFor={SEARCH_INPUT_ID}
              className="hidden sm:block font-mono text-lg font-semibold uppercase tracking-[0.2em] text-cyan-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.45)] sm:text-2xl"
            >
              YOUR STATION STARTS HERE.
            </label>
          </div>
        </>
      )}

      <div
        className={
          drawerOpen
            ? "relative flex min-h-0 w-full flex-1 flex-col px-4 pb-3 pt-12"
            : "w-full min-w-0"
        }
      >
        <SmartSearchBar
          onLaunch={onLaunch}
          onLoadCurated={onLoadCurated}
          onLaunchAlbum={onLaunchAlbum}
          onLaunchSongRadio={onLaunchSongRadio}
          disabled={disabled}
          tunerOpen={tunerOpen}
          onToggleTuner={onToggleTuner}
          accentBorder
          hideLabel
          inlineResults={isMobile}
          onClose={isMobile ? dismissMobileSearchAfterLaunch : undefined}
        />
      </div>

      {drawerOpen ? null : children}
    </section>
  );

  if (drawerOpen && portalTarget) {
    return createPortal(section, portalTarget);
  }
  return section;
}
