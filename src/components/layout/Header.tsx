"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AnimatedLogo from "@/components/layout/AnimatedLogo";
import { version } from "../../../package.json";

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
  const commitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  const displayVersion =
    commitSha && commitSha !== "dev"
      ? `v-${commitSha.slice(0, 6)}`
      : `v${version}`;

  const tabClass = (active: boolean) =>
    [
      "font-mono text-[9px] uppercase tracking-[0.22em] no-underline transition-colors",
      active ? "text-accent" : "text-[#525866] hover:text-zinc-400",
    ].join(" ");

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:flex-nowrap sm:gap-3 ${className}`}
      data-brand="songhost"
      data-dj-break={djBreakActive ? "true" : undefined}
    >
      <div className="flex min-w-0 basis-full items-center gap-2.5 sm:basis-auto">
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

      <nav
        className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto"
        aria-label="Primary"
      >
        <span className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500 sm:inline">
          {displayVersion}
        </span>
        {actions}
      </nav>
    </div>
  );
}
