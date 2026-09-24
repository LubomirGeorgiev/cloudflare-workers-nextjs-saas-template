import { v } from "@/lib/validation";
import { idField, teamIdField } from "@/schemas/fields";
import { AVAILABLE_BILLING_INTERVALS, PAID_PLAN_IDS, type TeamPlanId } from "@/constants/plans";
import { ADDON_MAX_QUANTITY } from "@/constants/addons";

// Only paid plans can be subscribed to / switched to; the free plan is the implicit
// "no active subscription" state handled by cancellation. Typed as a non-empty
// TeamPlanId tuple so parsed planId needs no downstream casts.
const paidPlanIds = PAID_PLAN_IDS as [TeamPlanId, ...TeamPlanId[]];

// Derived from the catalog: "year" only validates when yearly billing is enabled.
const billingInterval = v.optional(v.picklist(AVAILABLE_BILLING_INTERVALS), "month");

export const createSubscriptionSchema = v.object({
  teamId: teamIdField(),
  planId: v.picklist(paidPlanIds),
  interval: billingInterval,
});

export const changePlanSchema = v.object({
  teamId: teamIdField(),
  planId: v.picklist(paidPlanIds),
  interval: billingInterval,
});

// Completes the card-first trial flow: the client passes back the SetupIntent it confirmed.
// The plan and interval come from the SetupIntent metadata, never from the client.
export const completeTrialSchema = v.object({
  teamId: teamIdField(),
  setupIntentId: idField(),
});

// What startTrialSetupAction stamps on the SetupIntent. The interval has no default here, so a
// SetupIntent without complete metadata cannot start a trial.
export const trialSetupMetadataSchema = v.object({
  teamId: teamIdField(),
  planId: v.picklist(paidPlanIds),
  interval: v.picklist(AVAILABLE_BILLING_INTERVALS),
});

export type TrialSetupMetadata = v.InferOutput<typeof trialSetupMetadataSchema>;

// Stripe does not document every redirect_status value. Only "succeeded" and "processing"
// continue a checkout, so any other value reads as "failed".
const redirectStatus = v.fallback(v.picklist(["succeeded", "processing", "failed"]), "failed");

// The query a redirect-based payment method brings back to the billing page. Anyone can craft
// that link, so this only picks the next UI step; completeTrialAction re-verifies the SetupIntent.
export const paymentReturnSchema = v.object({
  setupIntentId: v.nullish(idField()),
  paymentIntentId: v.nullish(idField()),
  redirectStatus: v.nullish(redirectStatus),
});

export const cancelSubscriptionSchema = v.object({
  teamId: teamIdField(),
  atPeriodEnd: v.optional(v.boolean(), true),
});

export const teamBillingSchema = v.object({
  teamId: teamIdField(),
});

// Sets the ABSOLUTE quantity of one add-on on the team's subscription (0 removes it).
// addonId is a plain string here — the catalog is data downstream projects edit, so
// membership (and the per-addon maxQuantity cap) is validated in the action.
export const updateAddonQuantitySchema = v.object({
  teamId: teamIdField(),
  addonId: idField(),
  quantity: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(ADDON_MAX_QUANTITY)),
});
