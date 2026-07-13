import "server-only";

import type Stripe from "stripe";

import { resolveSubscriptionPriceId } from "@/utils/plan-prices";
import type { TeamPlanId } from "@/constants/plans";
import type { TeamAddonId, TeamAddonQuantities } from "@/constants/addons";

interface ClassifiedAddonItem {
  item: Stripe.SubscriptionItem;
  addonId: TeamAddonId;
}

export interface ClassifiedSubscriptionItems {
  // The item carrying the team's plan price, when one resolves. A subscription is only
  // ever created/updated with a single plan item; a second plan-priced item would be
  // external tampering and lands in unknownItems.
  planItem: Stripe.SubscriptionItem | null;
  planId: TeamPlanId | null;
  addonItems: ClassifiedAddonItem[];
  // Items whose price resolves to neither a plan nor an add-on: rotated price envs, or
  // items added outside the app. Callers should log these — never silently drop them.
  unknownItems: Stripe.SubscriptionItem[];
}

// Splits a subscription's items into plan / add-on / unknown. This is the ONLY sanctioned
// way to interpret subscription items — never assume items.data[0] is the plan, since
// add-on items have no guaranteed position.
export function classifySubscriptionItems(subscription: Stripe.Subscription): ClassifiedSubscriptionItems {
  const classified: ClassifiedSubscriptionItems = {
    planItem: null,
    planId: null,
    addonItems: [],
    unknownItems: [],
  };

  for (const item of subscription.items?.data ?? []) {
    const resolved = resolveSubscriptionPriceId(item.price?.id);

    if (resolved?.kind === "plan" && !classified.planItem) {
      classified.planItem = item;
      classified.planId = resolved.planId;
    } else if (resolved?.kind === "addon") {
      classified.addonItems.push({ item, addonId: resolved.addonId });
    } else {
      classified.unknownItems.push(item);
    }
  }

  return classified;
}

// The item to treat as the plan when acting on the subscription. Falls back to the first
// unknown item so deployments with rotated/unconfigured plan price envs keep working the
// way the old items.data[0] read did (add-on items are never mistaken for the plan).
export function resolvePlanItem(classified: ClassifiedSubscriptionItems): Stripe.SubscriptionItem | null {
  return classified.planItem ?? classified.unknownItems[0] ?? null;
}

// Aggregates classified add-on items into { addonId: quantity }. Stripe treats a
// missing quantity as 1; summing tolerates the (theoretical) duplicate-item case.
export function addonQuantitiesFromItems(classified: ClassifiedSubscriptionItems): TeamAddonQuantities {
  const quantities: TeamAddonQuantities = {};
  for (const { addonId, item } of classified.addonItems) {
    quantities[addonId] = (quantities[addonId] ?? 0) + (item.quantity ?? 1);
  }
  return quantities;
}
