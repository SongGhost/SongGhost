"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
 * and a sticky full-screen drawer on viewports under 768px when active.
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
  const [mobileActive, setMobileActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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
        setMobileActive(true);
      }
      // Focus after drawer mount / sticky layout settles.
      window.requestAnimationFrame(() => focusSearchInput());
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearchInput]);

  useEffect(() => {
    if (!mobileActive || !isMobile) return;

    const onFocusIn = (event: FocusEvent) => {
      const section = sectionRef.current;
      if (!section) return;
      const next = event.target as Node | null;
      if (next && section.contains(next)) return;
      setMobileActive(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileActive(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      const section = sectionRef.current;
      if (!section) return;
      if (section.contains(event.target as Node)) return;
      setMobileActive(false);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [mobileActive, isMobile]);

  const drawerOpen = isMobile && mobileActive;

  return (
    <>
      {drawerOpen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[55] bg-[#09090b]/85 backdrop-blur-sm md:hidden"
        />
      )}

      <section
        ref={sectionRef}
        className={`relative z-30 rounded-2xl border border-cyan-500/55 bg-slate-900/90 p-4 shadow-[0_0_32px_rgba(6,182,212,0.16)] backdrop-blur-sm sm:p-5 ${
          drawerOpen
            ? "fixed inset-x-0 top-0 z-[60] overflow-visible rounded-none border-x-0 border-t-0 border-b border-cyan-500/50 pb-6 shadow-[0_12px_40px_rgba(0,0,0,0.65)] md:relative md:inset-auto md:z-30 md:overflow-visible md:rounded-2xl md:border md:pb-5"
            : isMobile
              ? "sticky top-0 z-40"
              : ""
        }`}
        onFocusCapture={() => {
          if (isMobile) setMobileActive(true);
        }}
      >
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

        <div className="w-full min-w-0">
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
          />
        </div>

        {children}
      </section>
    </>
  );
}
