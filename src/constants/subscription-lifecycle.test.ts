import { describe, expect, test } from "vitest";
import type Stripe from "stripe";

import {
  cancelParamsForStatus,
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

  // A status that ran but does not invoice discards money we are already owed; a status that never
  // ran but invoices bills for nothing. Pinned per status so a new status cannot default silently.
  test.each([
    ["active", true],
    ["trialing", true],
    ["past_due", true],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["canceled", false],
    ["unpaid", true],
    ["paused", true],
  ] as const)("%s invoices on cancel: %s", (status, invoiceOnCancel) => {
    expect(getStripeSubscriptionTransitionPolicy(status)?.invoiceOnCancel).toBe(invoiceOnCancel);
  });

  // `prorate: true` would credit a cancelling customer for unused time, which is a pricing policy
  // change rather than a bug fix. Every cancel path takes `invoice_now` from the policy table.
  test.each(Object.entries(STRIPE_SUBSCRIPTION_TRANSITION_POLICY))(
    "the cancel parameters for %s follow the policy and credit nothing",
    (status, policy) => {
      expect(cancelParamsForStatus(status)).toEqual({
        invoice_now: policy.invoiceOnCancel,
        prorate: false,
      });
    },
  );

  test.each([null, undefined, "unknown"])(
    "an unrecognized status %s bills what is owed and credits nothing",
    (status) => {
      expect(cancelParamsForStatus(status)).toEqual({ invoice_now: true, prorate: false });
    },
  );
});
