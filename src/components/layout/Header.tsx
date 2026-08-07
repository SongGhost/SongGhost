"use client";

import type { ReactNode } from "react";

type BrandHeaderProps = {
  /** When true, the "g" in SongHost glows — a quiet nod to SongGhost. */
  djBreakActive?: boolean;
  /** Optional right-side nav actions (music source, auth, etc.) */
  actions?: ReactNode;
  className?: string;
};

/**
 * SongHost brand mark + minimal top chrome.
 * Apple / Teenage Engineering: sparse, premium, one clear wordmark.
 */
export default function BrandHeader({
  djBreakActive = false,
  actions,
  className = "",
}: BrandHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${className}`}
      data-brand="songhost"
    >
      <a
        href="/"
        className="group flex min-w-0 items-baseline gap-2 no-underline"
        aria-label="SongHost home"
      >
        <span className="font-sans text-lg font-semibold tracking-[-0.03em] text-zinc-100 sm:text-xl">
          Son
          <span
            className={[
              "inline-block transition-[color,text-shadow,filter] duration-500",
              djBreakActive
                ? "text-amber-400 [text-shadow:0_0_10px_rgba(245,158,11,0.85),0_0_22px_rgba(245,158,11,0.45)]"
                : "text-zinc-100 group-hover:text-amber-400/90",
            ].join(" ")}
            aria-hidden="true"
          >
            g
          </span>
          Host
        </span>
        <span className="hidden font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600 sm:inline">
          Studio Radio
        </span>
      </a>

      {actions ? (
        <nav
          className="flex shrink-0 items-center gap-2"
          aria-label="Primary"
        >
          {actions}
        </nav>
      ) : null}
    </div>
  );
}
