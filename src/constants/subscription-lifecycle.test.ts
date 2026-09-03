import { describe, expect, test } from "vitest";
import type Stripe from "stripe";

import {
  getStripeSubscriptionTransitionPolicy,
  REVENUE_PRESERVING_CANCEL_PARAMS,
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

  // A status that cancels but does not invoice discards money we are already owed. Pinned per
  // status so a new status cannot default silently into the wrong half.
  test.each([
    ["incomplete", false],
    ["unpaid", true],
    ["paused", true],
  ] as const)("%s invoices on cancel: %s", (status, invoiceOnCancel) => {
    expect(getStripeSubscriptionTransitionPolicy(status)).toMatchObject({
      subscribe: "cancel",
      invoiceOnCancel,
    });
  });

  test("only the cancelling statuses can ever reach the invoice decision", () => {
    for (const policy of Object.values(STRIPE_SUBSCRIPTION_TRANSITION_POLICY)) {
      if (policy.subscribe !== "cancel") {
        expect(policy.invoiceOnCancel).toBe(false);
      }
    }
  });

  // `prorate: true` would credit a cancelling customer for unused time, which is a pricing policy
  // change rather than a bug fix. `invoice_now: true` bills what is already owed. Both are stated
  // because both Stripe defaults are wrong for this path.
  test("the shared cancel parameters bill what is owed and credit nothing", () => {
    expect(REVENUE_PRESERVING_CANCEL_PARAMS).toEqual({ invoice_now: true, prorate: false });
  });
});
