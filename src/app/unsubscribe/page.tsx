import type { Metadata } from "next";
import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, getDb, users } from "@/lib/db";
import UnsubscribeControls from "./UnsubscribeControls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe — SongHost",
};

function isDatabaseConfigured(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * Email-preference page.
 *
 * A per-user token-based unsubscribe link (`?token=...`) will be added later
 * when email sending is wired up. Do not implement token logic now — unsigned
 * visitors must sign in; we do not opt out by guessing an email address.
 */
export default async function UnsubscribePage() {
  const { userId } = await auth();

  let initialOptedIn = false;
  let dbUnavailable = false;

  if (userId) {
    if (!isDatabaseConfigured()) {
      dbUnavailable = true;
    } else {
      const [row] = await db
        .select({ marketingOptIn: users.marketingOptIn })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      initialOptedIn = row?.marketingOptIn === true;
    }
  }

  return (
    <main className="min-h-screen bg-[#09090b] px-4 py-16 text-zinc-100 sm:px-6">
      <article className="mx-auto max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">
          SongHost
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
          Email preferences
        </h1>
        <p className="mt-3 font-sans text-sm leading-relaxed text-zinc-400">
          Turn marketing email on or off for the account you are signed in with.
        </p>

        {!userId ? (
          <div className="mt-8 space-y-4">
            <p className="font-sans text-sm leading-relaxed text-zinc-300">
              Sign in to manage your email preferences. We do not accept an
              email address typed here — that would risk changing someone
              else&apos;s consent.
            </p>
            <SignInButton mode="modal">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Sign in
              </button>
            </SignInButton>
          </div>
        ) : dbUnavailable ? (
          <p className="mt-8 font-sans text-sm text-zinc-400" role="status">
            Email preferences are unavailable right now. Try again later.
          </p>
        ) : (
          <UnsubscribeControls initialOptedIn={initialOptedIn} />
        )}

        <p className="mt-12">
          <Link
            href="/privacy"
            className="font-sans text-sm text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:text-amber-300 hover:decoration-amber-300"
          >
            Privacy
          </Link>
        </p>
      </article>
    </main>
  );
}
