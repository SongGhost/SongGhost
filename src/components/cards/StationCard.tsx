"use client";

import { Disc3 } from "lucide-react";
import Image from "next/image";
import type { MouseEvent, ReactNode } from "react";

export type StationCardProps = {
  /** High-res sleeve / thumbnail */
  artworkUrl?: string | null;
  /** Track title or station name */
  title: string;
  /** Artist name (discovery) or short station blurb */
  subtitle?: string;
  /** Clean genre / era chips */
  tags?: string[];
  isActive?: boolean;
  onClick?: (e: MouseEvent) => void;
  /** Pin / share / delete cluster rendered top-right */
  actions?: ReactNode;
  /** Optional dial accent pip */
  accentColor?: string;
  className?: string;
  /**
   * `shelf` — carousel tile with vinyl peek.
   * `compact` — denser discovery row (search results).
   */
  variant?: "shelf" | "compact";
};

const glassBase =
  "bg-[#121215] border border-[rgba(255,255,255,0.08)] shadow-[0_8px_28px_rgba(0,0,0,0.45)]";

function ArtworkBlock({
  artworkUrl,
  title,
  variant,
}: {
  artworkUrl?: string | null;
  title: string;
  variant: "shelf" | "compact";
}) {
  const sizeClass = variant === "compact" ? "h-14 w-14" : "aspect-square w-full";
  const hasArt = Boolean(artworkUrl?.trim());

  return (
    <div className={`relative ${variant === "shelf" ? "mb-3" : "shrink-0"}`}>
      {/* Vinyl edge peeking out behind the sleeve */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-full border border-white/[0.06] shadow-[2px_0_8px_rgba(0,0,0,0.5)] ${
          variant === "compact"
            ? "-right-2 top-1/2 h-[78%] w-[78%] -translate-y-1/2"
            : "-right-3 top-[8%] h-[84%] w-[84%]"
        }`}
        style={{
          background:
            "radial-gradient(circle at center, #2a2a2e 0%, #2a2a2e 14%, #0c0c0e 15%, #0c0c0e 28%, #1c1c20 29%, #1c1c20 42%, #0a0a0c 43%, #121215 70%)",
        }}
      />
      <div
        className={`relative z-10 overflow-hidden rounded-lg border border-white/[0.08] bg-zinc-900 ${sizeClass}`}
      >
        {hasArt ? (
          variant === "shelf" ? (
            <Image
              src={artworkUrl!}
              alt={`${title} artwork`}
              fill
              sizes="220px"
              className="object-cover"
              unoptimized
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- compact thumbs are arbitrary CDN URLs
            <img
              src={artworkUrl!}
              alt={`${title} artwork`}
              width={56}
              height={56}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900">
            <Disc3
              className={variant === "compact" ? "h-5 w-5 text-zinc-600" : "h-10 w-10 text-zinc-600"}
              aria-hidden="true"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dark glass station / discovery card with a subtle vinyl-edge offset behind
 * the artwork sleeve.
 */
export default function StationCard({
  artworkUrl,
  title,
  subtitle,
  tags = [],
  isActive = false,
  onClick,
  actions,
  accentColor,
  className = "",
  variant = "shelf",
}: StationCardProps) {
  const activeRing = isActive
    ? "scale-[1.02] border-amber-500/60 ring-2 ring-amber-500/70 shadow-[0_0_22px_rgba(245,158,11,0.22)]"
    : "hover:border-white/[0.14]";

  if (variant === "compact") {
    return (
      <div className={`relative ${className}`.trim()}>
        <button
          type="button"
          onClick={onClick}
          className={`group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-all duration-200 ${glassBase} ${activeRing}`}
        >
          <ArtworkBlock artworkUrl={artworkUrl} title={title} variant="compact" />
          <div className="min-w-0 flex-1 pr-6">
            <p className="truncate font-sans text-sm font-semibold text-zinc-100 group-hover:text-amber-400">
              {title}
            </p>
            {subtitle && (
              <p className="mt-0.5 truncate font-sans text-xs text-zinc-500">{subtitle}</p>
            )}
            {tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-400/85"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
        {actions && (
          <div className="absolute right-2 top-2 flex items-center gap-0.5">{actions}</div>
        )}
      </div>
    );
  }

  return (
    <div className={`relative w-[200px] sm:w-[240px] flex-shrink-0 snap-start ${className}`.trim()}>
      <button
        type="button"
        onClick={onClick}
        className={`group h-full w-full cursor-pointer rounded-xl p-3.5 text-left transition-all duration-200 ${glassBase} ${activeRing}`}
      >
        <ArtworkBlock artworkUrl={artworkUrl} title={title} variant="shelf" />
        <div className="min-w-0" style={{ paddingRight: actions ? 28 : 0 }}>
          {tags.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-white/[0.08] bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-400/90"
                >
                  {tag}
                </span>
              ))}
              {accentColor && (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/20"
                  style={{ backgroundColor: accentColor }}
                />
              )}
            </div>
          )}
          <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug text-zinc-100 transition-colors group-hover:text-amber-400">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-1 line-clamp-2 font-sans text-xs leading-relaxed text-zinc-500">
              {subtitle}
            </p>
          )}
        </div>
      </button>
      {actions && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-0.5">{actions}</div>
      )}
    </div>
  );
}
