import addonsData from "./addons.json";

import { v } from "@/lib/validation";
import { deriveYearlyAmount, type BillingInterval, type TeamPlanLimits } from "@/constants/plans";

// Plain-data add-on catalog — the subscription add-on counterpart of `plans.ts`, shared
// by client components, server code, tests, and `pnpm stripe:setup`. Ships with an
// "extra-seats" example; downstream projects edit entries here to sell recurring
// add-ons on top of a paid plan.
// No env access here: Stripe price IDs live server-only in `src/utils/plan-prices.ts`
// under the STRIPE_PRICE_ADDON_<ID>[_YEAR] naming convention.

// Not exported (repo lint keeps unused exports file-local): consumers work with
// TEAM_ADDONS values, whose type is inferred.
interface TeamAddon {
  id: string;
  name: string;
  // Monthly amount PER UNIT in the currency's smallest unit; the yearly price is derived
  // with the same yearlyDiscountPercent formula as plans (see scripts/stripe-setup.mjs).
  amount: number;
  currency: string;
  // Cap on the quantity a team can hold; omit to fall back to ADDON_MAX_QUANTITY.
  maxQuantity?: number;
  // Additive limit grants applied PER UNIT on top of the plan's limits while the
  // subscription is active (e.g. { "seats": 1 } sells one extra seat per unit).
  limits?: Partial<TeamPlanLimits>;
}

// Deliberately NOT `keyof typeof addonsData.addons` (unlike TeamPlanId): an emptied
// downstream catalog would collapse it to `never`, and ids also arrive from stale DB
// snapshots/Stripe/action input — so membership is checked at runtime via isTeamAddonId.
export type TeamAddonId = string;

// Active add-on units per add-on id — the app-side mirror of Stripe subscription item
// quantities. Only positive entries are ever stored.
export type TeamAddonQuantities = Record<TeamAddonId, number>;

// Absolute quantity ceiling backing schema validation and per-addon caps; a stolen-card
// buyer should not be able to purchase 10,000 seats in one action.
export const ADDON_MAX_QUANTITY = 100;

const teamAddonSchema = v.object({
  id: v.string(),
  name: v.string(),
  amount: v.pipe(v.number(), v.minValue(1)),
  currency: v.string(),
  maxQuantity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(ADDON_MAX_QUANTITY))),
  limits: v.optional(v.partial(v.object({ seats: v.number(), projects: v.number() }))),
});

const addonCatalogSchema = v.object({
  addons: v.record(v.string(), teamAddonSchema),
});

// Catch malformed catalog edits at module init in dev/test instead of at Stripe call time.
if (process.env.NODE_ENV !== "production") {
  v.parse(addonCatalogSchema, addonsData);
}

export const TEAM_ADDONS = addonsData.addons as Record<TeamAddonId, TeamAddon>;

export const TEAM_ADDON_IDS = Object.keys(TEAM_ADDONS) as TeamAddonId[];

function isTeamAddonId(value: string | null | undefined): value is TeamAddonId {
  return typeof value === "string" && value in TEAM_ADDONS;
}

export function getAddon(addonId: string | null | undefined): TeamAddon | null {
  return isTeamAddonId(addonId) ? TEAM_ADDONS[addonId] : null;
}

export function getAddonMaxQuantity(addon: TeamAddon): number {
  return addon.maxQuantity ?? ADDON_MAX_QUANTITY;
}

// Per-unit amount for the given billing interval (add-on items must share the
// subscription's interval, so yearly plans carry the derived yearly add-on price).
export function getAddonAmount({ addon, interval }: { addon: TeamAddon; interval: BillingInterval }): number {
  return interval === "year" ? deriveYearlyAmount(addon.amount) : addon.amount;
}

// Validates the team row's `subscriptionAddonIds` snapshot ({ addonId: quantity },
// JSON-parsed by the drizzle column), dropping ids no longer in the catalog and
// non-positive/invalid quantities so stale rows degrade gracefully after a catalog change.
export function fromStoredAddonQuantities(value: unknown): TeamAddonQuantities {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const quantities: TeamAddonQuantities = {};
  for (const [addonId, quantity] of Object.entries(value)) {
    if (isTeamAddonId(addonId) && typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0) {
      quantities[addonId] = quantity;
    }
  }
  return quantities;
}

// Canonical write shape for the drizzle json column: sorted, positive-only entries so
// equal add-on states always serialize identically (stable snapshots/diffs).
export function toStoredAddonQuantities(quantities: TeamAddonQuantities): TeamAddonQuantities | null {
  const entries = Object.entries(quantities)
    .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (!entries.length) {
    return null;
  }
  return Object.fromEntries(entries);
}
