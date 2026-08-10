"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";

export type CheckoutSessionResult =
  | { ok: true; mode: "stripe"; url: string }
  | { ok: true; mode: "dev" }
  | { ok: false; error: string };

function resolveOrigin(headerList: Headers): string {
  const fromHeader = headerList.get("origin");
  if (fromHeader) return fromHeader.replace(/\/$/, "");

  const host =
    headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (host) {
    const proto = headerList.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/**
 * Create a Stripe Checkout Session for SongGhost Pro ($9.99/mo subscription).
 *
 * When `STRIPE_SECRET_KEY` is omitted or `NODE_ENV === "development"` without a
 * configured price, returns `{ mode: "dev" }` so the client can flip the local
 * tier to Pro (localStorage via TierContext) without a live Stripe call.
 */
export async function createCheckoutSession(): Promise<CheckoutSessionResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId =
    process.env.STRIPE_PRICE_ID?.trim() ||
    process.env.STRIPE_PRO_PRICE_ID?.trim();
  const isDev = process.env.NODE_ENV === "development";

  if (!secretKey || (isDev && !priceId)) {
    return { ok: true, mode: "dev" };
  }

  if (!priceId) {
    return {
      ok: false,
      error:
        "Stripe is configured but STRIPE_PRICE_ID (or STRIPE_PRO_PRICE_ID) is missing.",
    };
  }

  const { userId } = await auth();
  const headerList = await headers();
  const origin = resolveOrigin(headerList);
  const returnUrl = `${origin}/?session_id={CHECKOUT_SESSION_ID}`;

  try {
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: returnUrl,
      cancel_url: returnUrl,
      client_reference_id: userId ?? undefined,
      metadata: {
        userId: userId ?? "",
      },
      subscription_data: {
        metadata: {
          userId: userId ?? "",
        },
      },
    });

    if (!session.url) {
      return { ok: false, error: "Stripe Checkout Session missing redirect URL." };
    }

    return { ok: true, mode: "stripe", url: session.url };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create Checkout Session.";
    console.error("[stripe] createCheckoutSession failed", err);

    // Local/dev without a valid Stripe account should still unlock Pro UI.
    if (isDev || !secretKey) {
      return { ok: true, mode: "dev" };
    }

    return { ok: false, error: message };
  }
}
