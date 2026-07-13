import "server-only";

import { PAID_PLAN_IDS, type BillingInterval, type TeamPlanId } from "@/constants/plans";

// Maps our plan ids to the env vars holding their Stripe price IDs, per billing
// interval. Only paid plans have prices; the free plan never creates a Stripe
// subscription. The *_YEAR vars are only required when yearly billing is enabled
// (yearlyDiscountPercent in plans.json). Keep price IDs server-only — they must
// never ship in the client bundle.
const PRICE_ENV_BY_PLAN: Partial<Record<TeamPlanId, Record<BillingInterval, string>>> = {
  pro: { month: "STRIPE_PRICE_PRO", year: "STRIPE_PRICE_PRO_YEAR" },
  enterprise: { month: "STRIPE_PRICE_ENTERPRISE", year: "STRIPE_PRICE_ENTERPRISE_YEAR" },
};

const BILLING_INTERVALS: BillingInterval[] = ["month", "year"];

export function getPlanPriceId({
  planId,
  interval = "month",
}: {
  planId: TeamPlanId;
  interval?: BillingInterval;
}): string {
  const envKey = PRICE_ENV_BY_PLAN[planId]?.[interval];

  if (!envKey) {
    throw new Error(`Plan "${planId}" has no Stripe price (not a paid plan)`);
  }

  const priceId = process.env[envKey as keyof typeof process.env];

  if (!priceId) {
    throw new Error(`Missing ${envKey} environment variable for plan "${planId}" (${interval})`);
  }

  return priceId;
}

// Reverse lookup for the webhook: resolve a Stripe price ID back to our plan id.
// Monthly and yearly prices of the same plan resolve identically (entitlements do
// not depend on the billing interval).
export function planIdFromPriceId(priceId: string | null | undefined): TeamPlanId | null {
  if (!priceId) return null;

  for (const planId of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      const envKey = PRICE_ENV_BY_PLAN[planId]?.[interval];
      if (envKey && process.env[envKey as keyof typeof process.env] === priceId) {
        return planId;
      }
    }
  }

  return null;
}
