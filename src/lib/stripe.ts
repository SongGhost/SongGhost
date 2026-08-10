import { clerkClient } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { db, getDb, users } from "@/lib/db";
import type { SubscriptionTier } from "@/lib/usage/dj-breaks";

export type { SubscriptionTier };

const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

let stripeSingleton: Stripe | undefined;

/** Shared Stripe SDK client (requires `STRIPE_SECRET_KEY`). */
export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
    });
  }
  return stripeSingleton;
}

export function isActiveSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  return status === "active" || status === "trialing";
}

export function isCanceledSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  return status === "canceled";
}

/** Map a Stripe subscription status onto SongHost Free / Pro. */
export function tierFromSubscriptionStatus(
  status: string | null | undefined,
): SubscriptionTier | null {
  if (isActiveSubscriptionStatus(status)) return "pro";
  if (isCanceledSubscriptionStatus(status)) return "free";
  return null;
}

function extractMetadataUserId(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const raw = metadata?.userId?.trim();
  return raw ? raw : null;
}

/** Resolve Clerk user id from Checkout Session fields. */
export function userIdFromCheckoutSession(
  session: Stripe.Checkout.Session,
): string | null {
  const fromRef = session.client_reference_id?.trim();
  if (fromRef) return fromRef;
  return extractMetadataUserId(session.metadata);
}

/** Resolve Clerk user id from a Subscription object. */
export function userIdFromSubscription(
  subscription: Stripe.Subscription,
): string | null {
  return extractMetadataUserId(subscription.metadata);
}

function isDatabaseConfigured(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

export type SyncSubscriptionTierOptions = {
  userId: string;
  tier: SubscriptionTier;
  stripeCustomerId?: string | null;
  subscriptionStatus?: string | null;
};

/**
 * Authoritative Pro / Free sync: Clerk `unsafeMetadata.tier` + Postgres `users.tier`.
 * Stripe webhooks are the production source of truth for paid state.
 */
export async function syncSubscriptionTier(
  options: SyncSubscriptionTierOptions,
): Promise<void> {
  const { userId, tier } = options;
  if (!userId.trim()) {
    throw new Error("syncSubscriptionTier requires a Clerk userId");
  }

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    unsafeMetadata: { tier },
  });

  if (!isDatabaseConfigured()) {
    console.warn(
      "[stripe] DATABASE_URL unset — skipped Postgres users.tier sync for",
      userId,
    );
    return;
  }

  const subscriptionStatus =
    options.subscriptionStatus?.trim() ||
    (tier === "pro" ? "active" : "inactive");
  const stripeCustomerId = options.stripeCustomerId?.trim() || null;

  let email = `${userId}@users.clerk`;
  try {
    const clerkUser = await client.users.getUser(userId);
    email =
      clerkUser.primaryEmailAddress?.emailAddress?.trim() ||
      clerkUser.emailAddresses[0]?.emailAddress?.trim() ||
      email;
  } catch (err) {
    console.warn(
      "[stripe] Could not load Clerk email for Postgres upsert",
      userId,
      err,
    );
  }

  await db
    .insert(users)
    .values({
      id: userId,
      email,
      tier,
      subscriptionStatus,
      stripeCustomerId: stripeCustomerId ?? undefined,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        tier,
        subscriptionStatus,
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
      },
    });
}

/**
 * Apply Checkout Session completion: upgrade when the session completed a
 * subscription purchase (or already reports an active/trialing sub status).
 */
export async function applyCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = userIdFromCheckoutSession(session);
  if (!userId) {
    console.warn(
      "[stripe] checkout.session.completed missing client_reference_id / metadata.userId",
      session.id,
    );
    return;
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  // Completed subscription checkout is the upgrade moment.
  const shouldUpgrade =
    session.mode === "subscription" && session.status === "complete";

  if (!shouldUpgrade) {
    console.info(
      "[stripe] checkout.session.completed ignored (not an upgradeable subscription session)",
      session.id,
      session.mode,
      session.status,
    );
    return;
  }

  await syncSubscriptionTier({
    userId,
    tier: "pro",
    stripeCustomerId: customerId,
    subscriptionStatus: "active",
  });
}

/** Apply subscription created/updated/deleted → Pro or Free. */
export async function applySubscriptionEvent(
  subscription: Stripe.Subscription,
  options?: { forceTier?: SubscriptionTier },
): Promise<void> {
  const userId = userIdFromSubscription(subscription);
  if (!userId) {
    console.warn(
      "[stripe] subscription event missing metadata.userId",
      subscription.id,
    );
    return;
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const tier =
    options?.forceTier ?? tierFromSubscriptionStatus(subscription.status);

  if (!tier) {
    console.info(
      "[stripe] subscription status left tier unchanged",
      subscription.id,
      subscription.status,
    );
    return;
  }

  await syncSubscriptionTier({
    userId,
    tier,
    stripeCustomerId: customerId,
    subscriptionStatus: subscription.status,
  });
}
