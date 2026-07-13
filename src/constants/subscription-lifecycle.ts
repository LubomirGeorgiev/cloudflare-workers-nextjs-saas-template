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
    grantsPaidAccess: true,
    needsPaymentAction: false,
    statusKey: "statusActive",
  },
  trialing: {
    plan: "retain",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "block",
    grantsPaidAccess: true,
    needsPaymentAction: false,
    statusKey: "statusTrialing",
  },
  past_due: {
    plan: "retain",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "block",
    grantsPaidAccess: false,
    needsPaymentAction: true,
    statusKey: "statusPastDue",
  },
  incomplete: {
    plan: "retain",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "cancel",
    grantsPaidAccess: false,
    needsPaymentAction: true,
    statusKey: "statusIncomplete",
  },
  incomplete_expired: {
    plan: "free",
    subscription: "clear",
    statusWrite: "clear",
    subscribe: "allow",
    grantsPaidAccess: false,
    needsPaymentAction: false,
    statusKey: "statusIncomplete",
  },
  canceled: {
    plan: "free",
    subscription: "clear",
    statusWrite: "retain",
    subscribe: "allow",
    grantsPaidAccess: false,
    needsPaymentAction: false,
    statusKey: "statusCanceled",
  },
  unpaid: {
    plan: "free",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "cancel",
    grantsPaidAccess: false,
    needsPaymentAction: false,
    statusKey: "statusUnpaid",
  },
  paused: {
    plan: "free",
    subscription: "retain",
    statusWrite: "retain",
    subscribe: "cancel",
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
