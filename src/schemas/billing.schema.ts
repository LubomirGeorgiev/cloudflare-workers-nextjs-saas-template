import { requiredString, v } from "@/lib/validation";
import { AVAILABLE_BILLING_INTERVALS, PAID_PLAN_IDS, type TeamPlanId } from "@/constants/plans";

// Only paid plans can be subscribed to / switched to; the free plan is the implicit
// "no active subscription" state handled by cancellation. Typed as a non-empty
// TeamPlanId tuple so parsed planId needs no downstream casts.
const paidPlanIds = PAID_PLAN_IDS as [TeamPlanId, ...TeamPlanId[]];

// Derived from the catalog: "year" only validates when yearly billing is enabled.
const billingInterval = v.optional(v.picklist(AVAILABLE_BILLING_INTERVALS), "month");

export const createSubscriptionSchema = v.object({
  teamId: requiredString(),
  planId: v.picklist(paidPlanIds),
  interval: billingInterval,
});

export const changePlanSchema = v.object({
  teamId: requiredString(),
  planId: v.picklist(paidPlanIds),
  interval: billingInterval,
});

// Completes the card-first trial flow: the client passes back the SetupIntent it
// confirmed so the server can verify it before creating the trialing subscription.
export const completeTrialSchema = v.object({
  teamId: requiredString(),
  planId: v.picklist(paidPlanIds),
  interval: billingInterval,
  setupIntentId: requiredString(),
});

export const cancelSubscriptionSchema = v.object({
  teamId: requiredString(),
  atPeriodEnd: v.optional(v.boolean(), true),
});

export const teamBillingSchema = v.object({
  teamId: requiredString(),
});
