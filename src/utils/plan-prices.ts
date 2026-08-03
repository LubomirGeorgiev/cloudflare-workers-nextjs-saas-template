import "server-only";

import { PAID_PLAN_IDS, type BillingInterval, type TeamPlanId } from "@/constants/plans";
import { TEAM_ADDON_IDS, type TeamAddonId } from "@/constants/addons";

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
  if (!priceId) {
    return null;
  }

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

// Add-on price env naming convention (kebab-case addon id -> underscored env segment).
// Monthly keeps the unsuffixed name; yearly gets _YEAR — mirroring the plan envs above.
// Must match envVarForAddon in scripts/stripe-setup.mjs.
function addonPriceEnvVar({ addonId, interval }: { addonId: TeamAddonId; interval: BillingInterval }): string {
  const base = `STRIPE_PRICE_ADDON_${addonId.toUpperCase().replace(/-/g, "_")}`;
  return interval === "year" ? `${base}_YEAR` : base;
}

export function getAddonPriceId({
  addonId,
  interval = "month",
}: {
  addonId: TeamAddonId;
  interval?: BillingInterval;
}): string {
  const envKey = addonPriceEnvVar({ addonId, interval });
  const priceId = process.env[envKey as keyof typeof process.env];

  if (!priceId) {
    throw new Error(`Missing ${envKey} environment variable for add-on "${addonId}" (${interval})`);
  }

  return priceId;
}

// Reverse lookup: resolve a Stripe price ID back to our add-on id, either interval.
export function addonIdFromPriceId(priceId: string | null | undefined): TeamAddonId | null {
  if (!priceId) {
    return null;
  }

  for (const addonId of TEAM_ADDON_IDS) {
    for (const interval of BILLING_INTERVALS) {
      const envKey = addonPriceEnvVar({ addonId, interval });
      if (process.env[envKey as keyof typeof process.env] === priceId) {
        return addonId;
      }
    }
  }

  return null;
}

type ResolvedSubscriptionPrice =
  | { kind: "plan"; planId: TeamPlanId }
  | { kind: "addon"; addonId: TeamAddonId };

// Classifies a subscription item's price as a plan or an add-on price. Null means the
// price is unknown to this deployment (rotated envs, or created outside the app).
export function resolveSubscriptionPriceId(priceId: string | null | undefined): ResolvedSubscriptionPrice | null {
  const planId = planIdFromPriceId(priceId);
  if (planId) {
    return { kind: "plan", planId };
  }

  const addonId = addonIdFromPriceId(priceId);
  if (addonId) {
    return { kind: "addon", addonId };
  }

  return null;
}
