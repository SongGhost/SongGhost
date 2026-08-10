import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  applyCheckoutSessionCompleted,
  applySubscriptionEvent,
  getStripe,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe → SongHost Pro state sync.
 *
 * Verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`, then upgrades /
 * downgrades Clerk `unsafeMetadata.tier` and Postgres `users.tier` for:
 * - checkout.session.completed
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 */
export async function POST(request: Request): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe-Signature header" },
      { status: 400 },
    );
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid Stripe webhook signature";
    console.error("[stripe webhook] Signature verification failed", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await applyCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        await applySubscriptionEvent(
          event.data.object as Stripe.Subscription,
        );
        break;
      }
      case "customer.subscription.deleted": {
        await applySubscriptionEvent(
          event.data.object as Stripe.Subscription,
          { forceTier: "free" },
        );
        break;
      }
      default:
        console.info("[stripe webhook] Unhandled event type", event.type);
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] Handler failed", event.type, err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
