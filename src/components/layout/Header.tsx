"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type BrandHeaderProps = {
  /** When true, the "g" holds a stronger amber glow — a quiet nod during DJ breaks. */
  djBreakActive?: boolean;
  /** Optional right-side nav actions (music source, auth, etc.) */
  actions?: ReactNode;
  className?: string;
};

/**
 * SongHost brand mark + minimal top chrome.
 * Apple / Teenage Engineering: sparse, premium, one clear wordmark.
 * The wordmark loops SongHost ↔ SonGhost via fadeGHost keyframes.
 */
export default function BrandHeader({
  djBreakActive = false,
  actions,
  className = "",
}: BrandHeaderProps) {
  const pathname = usePathname();
  const isRadio = pathname === "/";
  const isStudio = pathname === "/studio" || pathname.startsWith("/studio/");

  const tabClass = (active: boolean) =>
    [
      "font-mono text-[9px] uppercase tracking-[0.22em] no-underline transition-colors",
      active ? "text-[#f59e0b]" : "text-zinc-600 hover:text-zinc-400",
    ].join(" ");

  return (
    <div
      className={`flex items-center justify-between gap-3 ${className}`}
      data-brand="songhost"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <Link
          href="/"
          className="group flex min-w-0 items-baseline no-underline"
          aria-label="SongHost home"
        >
          <span className="font-sans text-lg font-semibold tracking-[-0.03em] text-zinc-100 sm:text-xl">
            <span>Son</span>
            <span
              className={[
                "inline-block animate-logo-g",
                djBreakActive
                  ? "text-amber-400 [text-shadow:0_0_10px_rgba(245,158,11,0.85),0_0_22px_rgba(245,158,11,0.45)]"
                  : "group-hover:text-amber-400/90",
              ].join(" ")}
              aria-hidden="true"
            >
              g
            </span>
            <span
              className="inline-block animate-logo-H [animation-delay:120ms]"
              aria-hidden="true"
            >
              H
            </span>
            <span>ost</span>
          </span>
        </Link>
        <nav
          className="hidden items-baseline gap-2 sm:flex"
          aria-label="Mode"
        >
          <Link
            href="/studio"
            className={tabClass(isStudio)}
            aria-current={isStudio ? "page" : undefined}
          >
            Studio
          </Link>
          <Link
            href="/"
            className={tabClass(isRadio)}
            aria-current={isRadio ? "page" : undefined}
          >
            Radio
          </Link>
        </nav>
      </div>

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
