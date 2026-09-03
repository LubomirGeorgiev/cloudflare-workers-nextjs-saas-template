import type Stripe from "stripe";

type BillingStatusKey =
  | "statusActive"
  | "statusTrialing"
  | "statusPastDue"
  | "statusCanceled"
  | "statusIncomplete"
  | "statusUnpaid"
  | "statusPaused";

interface StripeSubscriptionTransitionPolicy {
  // Whether the team retains the plan represented by the Stripe subscription's price.
  plan: "retain" | "free";
  // Whether the local Stripe subscription reference must remain available for the next action.
  subscription: "retain" | "clear";
  // Whether the local subscription status is written or cleared (an abandoned checkout
  // should leave no lingering status on the team).
  statusWrite: "retain" | "clear";
  // How a request to begin a new subscription handles this existing Stripe subscription.
  subscribe: "block" | "cancel" | "allow";
  // Whether cancelling from this status must raise a final invoice for money already owed —
  // pending prorations and un-invoiced metered usage. Required on every status, not optional, so
  // a status added later cannot default silently into discarding revenue. Only reachable where
  // `subscribe` is "cancel"; every other status sets it false because it never cancels here.
  invoiceOnCancel: boolean;
  // Whether the paid plan's entitlements are unlocked.
  grantsPaidAccess: boolean;
  needsPaymentAction: boolean;
  statusKey: BillingStatusKey;
}

// Keep all Stripe subscription statuses and their local lifecycle decisions together.
// `unpaid` and `paused` are retained only long enough to cancel before a replacement
// subscription is created; neither state keeps the team's paid plan or entitlements.
export const STRIPE_SUBSCRIPTION_TRANSITION_POLICY = {
  active: {
    plan: "retain",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "block",
    // Not reachable: `subscribe` blocks, so this status never cancels here.
    invoiceOnCancel: false,
    grantsPaidAccess: true,
    needsPaymentAction: false,
    statusKey: "statusActive",
  },
  trialing: {
    plan: "retain",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "block",
    // Not reachable: `subscribe` blocks, so this status never cancels here.
    invoiceOnCancel: false,
    grantsPaidAccess: true,
    needsPaymentAction: false,
    statusKey: "statusTrialing",
  },
  past_due: {
    plan: "retain",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "block",
    // Not reachable: `subscribe` blocks, so this status never cancels here.
    invoiceOnCancel: false,
    grantsPaidAccess: false,
    needsPaymentAction: true,
    statusKey: "statusPastDue",
  },
  incomplete: {
    plan: "retain",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "cancel",
    // Nothing was ever collected, so there is nothing owed to invoice.
    invoiceOnCancel: false,
    grantsPaidAccess: false,
    needsPaymentAction: true,
    statusKey: "statusIncomplete",
  },
  incomplete_expired: {
    plan: "free",
    subscription: "clear",
    statusWrite: "clear",
    subscribe: "allow",
    // Not reachable: `subscribe` allows, so nothing is cancelled here.
    invoiceOnCancel: false,
    grantsPaidAccess: false,
    needsPaymentAction: false,
    statusKey: "statusIncomplete",
  },
  canceled: {
    plan: "free",
    subscription: "clear",
    statusWrite: "retain",
    subscribe: "allow",
    // Not reachable: `subscribe` allows, so nothing is cancelled here.
    invoiceOnCancel: false,
    grantsPaidAccess: false,
    needsPaymentAction: false,
    statusKey: "statusCanceled",
  },
  unpaid: {
    plan: "free",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "cancel",
    // The subscription ran. Any proration or usage on it is owed to us.
    invoiceOnCancel: true,
    grantsPaidAccess: false,
    needsPaymentAction: false,
    statusKey: "statusUnpaid",
  },
  paused: {
    plan: "free",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "cancel",
    // The subscription ran. Any proration or usage on it is owed to us.
    invoiceOnCancel: true,
    grantsPaidAccess: false,
    needsPaymentAction: false,
    statusKey: "statusPaused",
  },
} as const satisfies Record<Stripe.Subscription.Status, StripeSubscriptionTransitionPolicy>;

export function getStripeSubscriptionTransitionPolicy(status: string | null | undefined) {
  if (!status || !(status in STRIPE_SUBSCRIPTION_TRANSITION_POLICY)) {
    return null;
  }

  return STRIPE_SUBSCRIPTION_TRANSITION_POLICY[
    status as keyof typeof STRIPE_SUBSCRIPTION_TRANSITION_POLICY
  ];
}

/**
 * The cancel parameters every revenue-affecting cancellation passes.
 *
 * Both Stripe defaults are wrong here, so both are stated:
 * - `invoice_now: true` raises a final invoice covering pending proration items and any
 *   un-invoiced metered usage. With both flags false Stripe DELETES pending prorations, which is
 *   money we are already owed.
 * - `prorate: false` keeps the default deliberately. Setting it true would credit the customer
 *   for unused time, which is a pricing policy change, not a bug fix.
 *
 * The rule for a fork that adds metered billing: the ban and cancel paths must bill unbilled
 * usage and must never credit unused time. Never reach for `clear_usage` on these paths.
 *
 * Deliberately NOT used by the race and orphan cleanups (`convergeOnWinningCheckout`,
 * `discardLosingTrial`, `cancelOrphanIfPresent`): those cancel an `incomplete` subscription the
 * customer never used, and invoicing one would bill them for something that never existed.
 */
export const REVENUE_PRESERVING_CANCEL_PARAMS = {
  invoice_now: true,
  prorate: false,
} as const;
