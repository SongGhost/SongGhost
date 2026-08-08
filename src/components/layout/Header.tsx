"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AnimatedLogo from "@/components/layout/AnimatedLogo";

type BrandHeaderProps = {
  /** When true, the "g" holds a stronger brand accent glow — a quiet nod during DJ breaks. */
  djBreakActive?: boolean;
  /** Optional right-side nav actions (music source, auth, etc.) */
  actions?: ReactNode;
  className?: string;
};

/**
 * SongHost brand mark + minimal top chrome.
 * Apple / Teenage Engineering: sparse, premium, one clear wordmark.
 * The wordmark loops SongHost ↔ SonGhost via the AnimatedLogo crumble/shift cycle.
 *
 * Accent handoff (AnimatedLogo):
 * - SongHost: "Song" + "ost" white, accent on "H"
 * - Morphed: accent moves onto "g"/"G"; "h" settles to solid white
 * - "g" and "H"/"h" use transition-colors duration-300 ease-in-out
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
      active ? "text-accent" : "text-[#525866] hover:text-zinc-400",
    ].join(" ");

  return (
    <div
      className={`flex items-center justify-between gap-3 ${className}`}
      data-brand="songhost"
      data-dj-break={djBreakActive ? "true" : undefined}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <AnimatedLogo />
        <nav className="flex items-baseline gap-2.5" aria-label="Mode">
          <Link
            href="/"
            className={tabClass(isRadio)}
            aria-current={isRadio ? "page" : undefined}
          >
            RADIO
          </Link>
          <Link
            href="/studio"
            className={tabClass(isStudio)}
            aria-current={isStudio ? "page" : undefined}
          >
            STUDIO
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
