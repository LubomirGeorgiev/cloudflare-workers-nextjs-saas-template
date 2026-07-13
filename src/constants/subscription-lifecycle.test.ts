import { describe, expect, test } from "vitest";
import type Stripe from "stripe";

import {
  getStripeSubscriptionTransitionPolicy,
  STRIPE_SUBSCRIPTION_TRANSITION_POLICY,
} from "./subscription-lifecycle";

describe("Stripe subscription lifecycle policy", () => {
  test("covers every Stripe subscription status", () => {
    const statuses: Stripe.Subscription.Status[] = [
      "active",
      "trialing",
      "past_due",
      "incomplete",
      "incomplete_expired",
      "canceled",
      "unpaid",
      "paused",
    ];

    expect(Object.keys(STRIPE_SUBSCRIPTION_TRANSITION_POLICY).sort()).toEqual([...statuses].sort());
  });

  test.each([
    ["active", "retain", "retain", "block", true],
    ["trialing", "retain", "retain", "block", true],
    ["past_due", "retain", "retain", "block", false],
    ["incomplete", "retain", "retain", "cancel", false],
    ["incomplete_expired", "free", "clear", "allow", false],
    ["canceled", "free", "clear", "allow", false],
    ["unpaid", "free", "retain", "cancel", false],
    ["paused", "free", "retain", "cancel", false],
  ] as const)(
    "%s has the intended local lifecycle",
    (status, plan, subscription, subscribe, grantsPaidAccess) => {
      expect(getStripeSubscriptionTransitionPolicy(status)).toMatchObject({
        plan,
        subscription,
        subscribe,
        grantsPaidAccess,
      });
    },
  );

  test("rejects unknown stored statuses instead of treating them as active", () => {
    expect(getStripeSubscriptionTransitionPolicy("unknown")).toBeNull();
  });
});
