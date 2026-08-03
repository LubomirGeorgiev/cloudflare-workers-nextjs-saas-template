import "server-only";

import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";
import { reconcileTeamFromSubscription } from "@/utils/team-subscription";

// Events we act on. All of them resolve to a subscription that we re-fetch and snapshot,
// so replays and out-of-order delivery converge to the same team state (idempotent).
const HANDLED_EVENTS = new Set<Stripe.Event["type"]>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Fires ~3 days before a trial ends; we re-snapshot, and it's the natural hook point
  // for a "trial ending soon" email in downstream projects.
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
]);

// Minimal shape we depend on so tests can inject a fake Stripe client.
// oxlint-disable-next-line project/no-unused-module-exports -- exported for injection in tests.
export interface StripeSubscriptionFetcher {
  subscriptions: {
    retrieve: (id: string) => Promise<Stripe.Subscription>;
  };
}

function getEventSubscriptionId(event: Stripe.Event): string | null {
  const object = event.data.object as unknown as Record<string, unknown>;

  if (object.object === "subscription" && typeof object.id === "string") {
    return object.id;
  }

  if (object.object === "invoice") {
    // On the current API version the subscription lives under invoice.parent.
    const parent = object.parent as
      | { subscription_details?: { subscription?: string | { id?: string } } }
      | undefined;
    const fromParent = parent?.subscription_details?.subscription;
    if (typeof fromParent === "string") {
      return fromParent;
    }
    if (fromParent && typeof fromParent === "object" && typeof fromParent.id === "string") {
      return fromParent.id;
    }

    // Fallback for older payload shapes.
    const legacy = (object as { subscription?: string | { id?: string } }).subscription;
    if (typeof legacy === "string") {
      return legacy;
    }
    if (legacy && typeof legacy === "object" && typeof legacy.id === "string") {
      return legacy.id;
    }
  }

  return null;
}

interface HandleStripeEventOptions {
  // Injectable for tests; defaults to the shared Stripe client.
  stripe?: StripeSubscriptionFetcher;
}

export async function handleStripeEvent(
  event: Stripe.Event,
  { stripe }: HandleStripeEventOptions = {},
): Promise<void> {
  if (!HANDLED_EVENTS.has(event.type)) {
    return;
  }

  const subscriptionId = getEventSubscriptionId(event);
  if (!subscriptionId) {
    return;
  }

  const client = stripe ?? (getStripe() as unknown as StripeSubscriptionFetcher);

  // Re-fetch the subscription so we always write Stripe's latest state (source of truth).
  let subscription: Stripe.Subscription;
  try {
    subscription = await client.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.error("Failed to retrieve subscription for webhook", { subscriptionId, error });
    throw error;
  }

  await reconcileTeamFromSubscription({ subscription });
}
