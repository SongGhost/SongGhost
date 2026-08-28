import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — SongHost",
};

function PlaceholderMarker() {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-500/80">
      PLACEHOLDER — replace with lawyer-approved text
    </p>
  );
}

/**
 * Privacy policy page. Section bodies are placeholders for owner-supplied,
 * lawyer-approved copy. Do not treat the filler sentences as legal claims.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#09090b] px-4 py-16 text-zinc-100 sm:px-6">
      <article className="mx-auto max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">
          SongHost
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
          Privacy
        </h1>
        <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-400">
          This page is a layout stub. Every section below is marked for
          replacement; nothing here is a legal statement.
        </p>

        <section className="mt-10 space-y-2 border-t border-white/[0.06] pt-8">
          {/* PLACEHOLDER — replace with lawyer-approved text */}
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
            What we collect
          </h2>
          <PlaceholderMarker />
          <p className="font-sans text-sm leading-relaxed text-zinc-300">
            [Owner: describe what personal data SongHost collects. Do not
            publish this placeholder.]
          </p>
        </section>

        <section className="mt-8 space-y-2">
          {/* PLACEHOLDER — replace with lawyer-approved text */}
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
            How we use it
          </h2>
          <PlaceholderMarker />
          <p className="font-sans text-sm leading-relaxed text-zinc-300">
            [Owner: describe how collected data is used. Do not publish this
            placeholder.]
          </p>
        </section>

        <section className="mt-8 space-y-2">
          {/* PLACEHOLDER — replace with lawyer-approved text */}
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
            Marketing email and consent
          </h2>
          <PlaceholderMarker />
          <p className="font-sans text-sm leading-relaxed text-zinc-300">
            [Owner: replace with lawyer-approved wording on marketing email.]
            Product note for the owner (not legal copy): marketing email is
            opt-in, stored as consent on the account, and can be turned off on
            the unsubscribe page.
          </p>
          <p className="pt-1">
            <Link
              href="/unsubscribe"
              className="font-sans text-sm text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:text-amber-300 hover:decoration-amber-300"
            >
              Manage your email preferences
            </Link>
          </p>
        </section>

        <section className="mt-8 space-y-2">
          {/* PLACEHOLDER — replace with lawyer-approved text */}
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
            Data retention
          </h2>
          <PlaceholderMarker />
          <p className="font-sans text-sm leading-relaxed text-zinc-300">
            [Owner: describe retention periods. Do not publish this
            placeholder.]
          </p>
        </section>

        <section className="mt-8 space-y-2">
          {/* PLACEHOLDER — replace with lawyer-approved text */}
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
            Your rights / contact
          </h2>
          <PlaceholderMarker />
          <p className="font-sans text-sm leading-relaxed text-zinc-300">
            [Owner: describe listener rights and a contact path. Do not publish
            this placeholder.]
          </p>
        </section>

        <p className="mt-12">
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-300"
          >
            Back to SongHost
          </Link>
        </p>
      </article>
    </main>
  );
}
