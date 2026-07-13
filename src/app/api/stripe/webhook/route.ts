import "server-only";

import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { isBillingEnabled } from "@/flags";
import { handleStripeEvent } from "@/utils/stripe-webhook-handler";

// Stripe webhook endpoint. Unauthenticated (Stripe calls it directly) — do NOT wrap in
// auth/CSRF/rate-limit middleware. Signature verification is the auth boundary.
export async function POST(request: Request): Promise<Response> {
  // When billing isn't configured, no-op so unconfigured downstream templates don't error.
  if (!isBillingEnabled()) {
    return new Response(null, { status: 200 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!secret || !signature) {
    return new Response("Bad request", { status: 400 });
  }

  // RAW body is required for signature verification — never request.json() here.
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      body,
      signature,
      secret,
      undefined,
      // Workers-compatible crypto — the synchronous constructEvent() uses Node crypto
      // and does not run on Cloudflare Workers.
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  try {
    await handleStripeEvent(event);
  } catch (error) {
    console.error("Stripe webhook handler failed", { type: event.type, error });
    // 500 tells Stripe to retry; our handlers are idempotent so retries are safe.
    return new Response("Webhook handler error", { status: 500 });
  }

  return new Response(null, { status: 200 });
}
