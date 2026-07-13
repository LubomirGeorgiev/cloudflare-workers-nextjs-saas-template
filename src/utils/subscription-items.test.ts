import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));

// The template ships an EMPTY add-on catalog; inject a synthetic one so classification
// has add-on prices to resolve against.
vi.mock("@/constants/addons", () => ({
  TEAM_ADDON_IDS: ["extra-seats"],
}));

import { PAID_PLAN_IDS } from "@/constants/plans";

const PLAN_ID = PAID_PLAN_IDS[0];
const PLAN_PRICE_ID = `price_${PLAN_ID}_test`;
const ADDON_PRICE_ID = "price_addon_extra_seats_test";

const originalEnv = process.env;

// Minimal fake subscription items — only the fields classification reads.
function fakeItem(id: string, priceId: string, quantity?: number): Stripe.SubscriptionItem {
  return { id, price: { id: priceId }, quantity } as Stripe.SubscriptionItem;
}

function fakeSubscription(items: Stripe.SubscriptionItem[]): Stripe.Subscription {
  return { items: { data: items } } as Stripe.Subscription;
}

describe("classifySubscriptionItems", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env[`STRIPE_PRICE_${PLAN_ID.toUpperCase()}`] = PLAN_PRICE_ID;
    process.env.STRIPE_PRICE_ADDON_EXTRA_SEATS = ADDON_PRICE_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("a single plan item classifies as the plan with no add-ons", async () => {
    const { classifySubscriptionItems } = await import("./subscription-items");

    const classified = classifySubscriptionItems(fakeSubscription([fakeItem("si_1", PLAN_PRICE_ID)]));

    expect(classified.planItem?.id).toBe("si_1");
    expect(classified.planId).toBe(PLAN_ID);
    expect(classified.addonItems).toEqual([]);
    expect(classified.unknownItems).toEqual([]);
  });

  test("finds the plan item regardless of item order", async () => {
    const { classifySubscriptionItems } = await import("./subscription-items");

    // Add-on first: items.data[0] is NOT the plan — the old assumption this replaces.
    const classified = classifySubscriptionItems(fakeSubscription([
      fakeItem("si_addon", ADDON_PRICE_ID),
      fakeItem("si_plan", PLAN_PRICE_ID),
    ]));

    expect(classified.planItem?.id).toBe("si_plan");
    expect(classified.planId).toBe(PLAN_ID);
    expect(classified.addonItems).toEqual([
      { item: expect.objectContaining({ id: "si_addon" }), addonId: "extra-seats" },
    ]);
  });

  test("unresolvable prices land in unknownItems, never in add-ons or the plan", async () => {
    const { classifySubscriptionItems } = await import("./subscription-items");

    const classified = classifySubscriptionItems(fakeSubscription([
      fakeItem("si_plan", PLAN_PRICE_ID),
      fakeItem("si_mystery", "price_added_in_dashboard"),
    ]));

    expect(classified.planItem?.id).toBe("si_plan");
    expect(classified.unknownItems.map((item) => item.id)).toEqual(["si_mystery"]);
    expect(classified.addonItems).toEqual([]);
  });

  test("a second plan-priced item is treated as unknown, not as the plan", async () => {
    const { classifySubscriptionItems } = await import("./subscription-items");

    const classified = classifySubscriptionItems(fakeSubscription([
      fakeItem("si_first", PLAN_PRICE_ID),
      fakeItem("si_duplicate", PLAN_PRICE_ID),
    ]));

    expect(classified.planItem?.id).toBe("si_first");
    expect(classified.unknownItems.map((item) => item.id)).toEqual(["si_duplicate"]);
  });

  test("resolvePlanItem falls back to the first unknown item but never an add-on", async () => {
    const { classifySubscriptionItems, resolvePlanItem } = await import("./subscription-items");

    // Rotated plan price env: the plan item no longer resolves, but the add-on does.
    const rotated = classifySubscriptionItems(fakeSubscription([
      fakeItem("si_addon", ADDON_PRICE_ID),
      fakeItem("si_old_plan", "price_rotated_away"),
    ]));
    expect(resolvePlanItem(rotated)?.id).toBe("si_old_plan");

    // Add-on-only subscription: no candidate — callers must not touch any item.
    const addonOnly = classifySubscriptionItems(fakeSubscription([fakeItem("si_addon", ADDON_PRICE_ID)]));
    expect(resolvePlanItem(addonOnly)).toBeNull();
  });

  test("addonQuantitiesFromItems mirrors item quantities, defaulting a missing one to 1", async () => {
    const { classifySubscriptionItems, addonQuantitiesFromItems } = await import("./subscription-items");

    const withQuantity = classifySubscriptionItems(fakeSubscription([
      fakeItem("si_plan", PLAN_PRICE_ID),
      fakeItem("si_addon", ADDON_PRICE_ID, 7),
    ]));
    expect(addonQuantitiesFromItems(withQuantity)).toEqual({ "extra-seats": 7 });

    const withoutQuantity = classifySubscriptionItems(fakeSubscription([
      fakeItem("si_addon", ADDON_PRICE_ID),
    ]));
    expect(addonQuantitiesFromItems(withoutQuantity)).toEqual({ "extra-seats": 1 });
  });
});
