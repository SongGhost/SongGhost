"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Now-playing title + artist/album subtitle for the player chrome.
 * Kept presentation-only so ControlDeck and MobilePlayerSheet share one format.
 */

export type TrackMetadataProps = {
  title: string;
  artist: string;
  /** Album name from the active track, or station.albumContext.albumTitle */
  album?: string | null;
  /**
   * `compact` — sticky deck / mini-bar.
   * `sheet` — expanded mobile now-playing sheet.
   */
  size?: "compact" | "sheet";
  className?: string;
  /** When true, center-align (mobile sheet). Default left. */
  align?: "left" | "center";
};

/** `Artist • Album` when both exist; otherwise whichever side is available. */
export function formatArtistAlbum(
  artist: string,
  album?: string | null,
): string {
  const artistName = artist.trim();
  const albumTitle = album?.trim() ?? "";
  if (artistName && albumTitle) return `${artistName} • ${albumTitle}`;
  return artistName || albumTitle;
}

function MarqueeLine({
  text,
  className,
}: {
  text: string;
  className: string;
}) {
  const wrapRef = useRef<HTMLParagraphElement>(null);
  const sizerRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const sizer = sizerRef.current;
    if (!wrap || !sizer) return;

    const measure = () => {
      const overflow = sizer.scrollWidth - wrap.clientWidth;
      setOverflowPx(overflow > 1 ? overflow : 0);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(sizer);
    return () => ro.disconnect();
  }, [text]);

  const shouldScroll = overflowPx > 0 && !reducedMotion;
  const durationSec = Math.min(16, Math.max(8, overflowPx / 24));

  return (
    <p
      ref={wrapRef}
      aria-label={text}
      className={`relative overflow-hidden ${shouldScroll ? "whitespace-nowrap" : ""} ${className}`.trim()}
    >
      <span
        ref={sizerRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute whitespace-nowrap"
      >
        {text}
      </span>
      <span
        aria-hidden="true"
        className={
          shouldScroll
            ? "songhost-marquee-run inline-block will-change-transform"
            : "block truncate"
        }
        style={
          shouldScroll
            ? ({
                "--marquee-shift": `-${overflowPx}px`,
                animation: `songhost-marquee ${durationSec}s ease-in-out infinite`,
              } as CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </p>
  );
}

export default function TrackMetadata({
  title,
  artist,
  album,
  size = "compact",
  className = "",
  align = "left",
}: TrackMetadataProps) {
  const subtitle = formatArtistAlbum(artist, album);
  const isSheet = size === "sheet";
  const alignClass = align === "center" ? "text-center" : "text-left";
  const titleClass = isSheet
    ? "font-sans text-lg font-bold leading-tight text-slate-100 hover:underline cursor-pointer"
    : "font-sans text-sm font-bold leading-tight text-slate-100 hover:underline cursor-pointer";

  return (
    <div className={`min-w-0 w-full overflow-hidden ${alignClass} ${className}`.trim()}>
      <MarqueeLine text={title} className={titleClass} />
      {subtitle && (
        <MarqueeLine
          text={subtitle}
          className="mt-0.5 font-sans text-xs font-medium leading-tight text-slate-400"
        />
      )}
    </div>
  );
}
