/**
 * App chrome footer — build identity for support / debugging.
 * Commit SHA is injected via `next.config.ts` (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`).
 */

import Link from "next/link";

function resolveCommitSha(): string {
  const raw = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  if (!raw || raw === "dev") return "dev";
  return raw.slice(0, 7);
}

export default function Footer() {
  const sha = resolveCommitSha();

  return (
    <footer className="relative z-10 border-t border-white/[0.06] px-4 py-4 text-center sm:px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
        SongHost
        <span className="mx-2 text-zinc-700" aria-hidden="true">
          ·
        </span>
        <span title="Git commit" className="text-zinc-500">
          {sha}
        </span>
      </p>
      <nav
        className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600"
        aria-label="Legal"
      >
        <Link
          href="/privacy"
          className="text-zinc-500 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-400"
        >
          Privacy
        </Link>
        <span className="mx-2 text-zinc-700" aria-hidden="true">
          ·
        </span>
        <Link
          href="/unsubscribe"
          className="text-zinc-500 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-400"
        >
          Unsubscribe
        </Link>
      </nav>
    </footer>
  );
}
