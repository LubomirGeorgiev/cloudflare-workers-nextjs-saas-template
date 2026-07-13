import plansData from "./plans.json";

import { v } from "@/lib/validation";

// Plain-data plan catalog — the single source of truth shared by client components,
// server code, tests, and the `pnpm stripe:setup` script (which imports the JSON directly).
// No env access here: Stripe price IDs live server-only in `src/utils/plan-prices.ts`.

export type BillingInterval = "month" | "year";

export interface TeamPlanLimits {
  seats: number;
  projects: number;
}

export interface TeamPlan {
  id: string;
  name: string;
  // Amount in the currency's smallest unit (e.g. cents).
  amount: number;
  currency: string;
  interval: BillingInterval;
  // Free-trial length for new subscribers; omit (or 0) for no trial.
  trialDays?: number;
  limits: TeamPlanLimits;
}

const teamPlanSchema = v.object({
  id: v.string(),
  name: v.string(),
  amount: v.number(),
  currency: v.string(),
  interval: v.picklist(["month", "year"]),
  trialDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  limits: v.object({ seats: v.number(), projects: v.number() }),
});

const planCatalogSchema = v.object({
  yearlyDiscountPercent: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99))),
  plans: v.record(v.string(), teamPlanSchema),
});

// The `as` casts below are unchecked over JSON; catch malformed catalog edits (e.g.
// "interval": "monthly") at module init in dev/test instead of at Stripe call time.
if (process.env.NODE_ENV !== "production") {
  v.parse(planCatalogSchema, plansData);
}

export const TEAM_PLANS = plansData.plans as Record<string, TeamPlan>;

export type TeamPlanId = keyof typeof plansData.plans;

// Yearly billing knob: set to offer every monthly paid plan as a yearly subscription at
// this percentage off (0 = yearly offered at no discount); remove the key from
// plans.json to keep billing monthly-only.
export const YEARLY_DISCOUNT_PERCENT: number | null =
  (plansData as { yearlyDiscountPercent?: number }).yearlyDiscountPercent ?? null;

export const IS_YEARLY_BILLING_ENABLED = YEARLY_DISCOUNT_PERCENT !== null;

// Intervals a subscription can be created with; drives schema validation so "year"
// inputs are rejected outright when yearly billing is not configured.
export const AVAILABLE_BILLING_INTERVALS: [BillingInterval, ...BillingInterval[]] =
  IS_YEARLY_BILLING_ENABLED ? ["month", "year"] : ["month"];

export const DEFAULT_PLAN_ID = "free" satisfies TeamPlanId;

export const TEAM_PLAN_IDS = Object.keys(TEAM_PLANS) as TeamPlanId[];

// Paid plans are the ones that create a Stripe subscription (amount > 0).
export const PAID_PLAN_IDS = TEAM_PLAN_IDS.filter((id) => TEAM_PLANS[id].amount > 0);

function isTeamPlanId(value: string | null | undefined): value is TeamPlanId {
  return typeof value === "string" && value in TEAM_PLANS;
}

// Coalesce any stored planId (including null on legacy rows) to a concrete plan.
export function getPlan(planId: string | null | undefined): TeamPlan {
  return isTeamPlanId(planId) ? TEAM_PLANS[planId] : TEAM_PLANS[DEFAULT_PLAN_ID];
}

// Derived yearly amount, in the currency's smallest unit. Keep the formula in sync with
// scripts/stripe-setup.mjs, which provisions the matching Stripe price from the JSON.
export function getYearlyAmount(plan: TeamPlan): number {
  if (plan.interval === "year") return plan.amount;
  return Math.round((plan.amount * 12 * (100 - (YEARLY_DISCOUNT_PERCENT ?? 0))) / 100);
}

export function getPlanAmount({ plan, interval }: { plan: TeamPlan; interval: BillingInterval }): number {
  return interval === "year" ? getYearlyAmount(plan) : plan.amount;
}
