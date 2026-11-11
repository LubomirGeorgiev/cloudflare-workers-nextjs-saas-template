import { DEFAULT_PLAN_ID, getPlan, TEAM_PLAN_LIMIT_KEYS, type TeamPlan, type TeamPlanLimits } from "@/constants/plans";
import { fromStoredAddonQuantities, getAddon, type TeamAddonQuantities } from "@/constants/addons";
import {
  LIMIT_SOURCES,
  type LimitSource,
  type StoredLimitOverrides,
  type TeamLimitOverrides,
} from "@/constants/limit-overrides";
import {
  fromStoredLimitOverrides,
  limitOverridesForCustomer,
  limitOverridesWithoutPaidAccess,
  toStoredLimitOverrides,
} from "@/schemas/limit-overrides.schema";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";

// Backstop for lost/delayed webhooks: paid access lapses this long after the recorded
// period end even if the status was never updated. Stripe retries failed webhook
// deliveries for up to 3 days, and every renewal refreshes planExpiresAt, so a healthy
// subscription never comes near this window.
const EXPIRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

interface TeamEntitlements {
  plan: TeamPlan;
  // Whether the plan's paid features are currently unlocked. The Free plan is always
  // active; paid plans require a status with paid access in the lifecycle policy.
  isActive: boolean;
  limits: TeamPlanLimits;
  // The staff overrides in effect now. A paid plan with no paid access keeps only the
  // restrictions below the Free values; `limits` already has these in place.
  appliedLimitOverrides: TeamLimitOverrides;
  // The overrides that customer-facing code may name: none when staff hide them. Meters,
  // allowance lines, and refusals read `limits`, which do not change with the flag.
  customerLimitOverrides: TeamLimitOverrides;
}

interface EntitlementInput {
  planId: string | null | undefined;
  subscriptionStatus: string | null | undefined;
  // Recorded subscription period end. Optional: callers without it (e.g. KV sessions)
  // gate on status alone; callers with the team row get the expiry backstop.
  planExpiresAt?: Date | null;
  // Active add-on units per add-on id (fromStoredAddonQuantities of the team row).
  // Their per-unit limit grants stack on the plan's limits only while the
  // subscription is active.
  addons?: TeamAddonQuantities | null;
  // The stored `team.limitOverrides` JSON. Staff set it for one team. A paid plan with no paid
  // access gets only its restrictions below the Free values.
  limitOverrides?: string | null;
}

// The team row columns that decide the entitlements.
interface TeamEntitlementColumns {
  subscriptionPlanId: string | null;
  subscriptionStatus: string | null;
  planExpiresAt: Date | null;
  subscriptionAddonIds: unknown;
  limitOverrides: string | null;
}

/** The one mapping from a stored team row to the input of getTeamEntitlements. */
export function toEntitlementInput(team: TeamEntitlementColumns): EntitlementInput {
  return {
    planId: team.subscriptionPlanId,
    subscriptionStatus: team.subscriptionStatus,
    planExpiresAt: team.planExpiresAt,
    addons: fromStoredAddonQuantities(team.subscriptionAddonIds),
    limitOverrides: team.limitOverrides,
  };
}

// Add-on limit grants are additive on top of the plan's limits, multiplied by the held
// quantity; ids no longer in the catalog contribute nothing (stale rows degrade to
// plan limits, never crash).
function applyAddonLimits(base: TeamPlanLimits, addons: TeamAddonQuantities): TeamPlanLimits {
  return Object.entries(addons).reduce((limits, [addonId, quantity]) => {
    const grants = getAddon(addonId)?.limits;
    if (!grants || quantity <= 0) {
      return limits;
    }

    const next = { ...limits };
    for (const key of TEAM_PLAN_LIMIT_KEYS) {
      next[key] += (grants[key] ?? 0) * quantity;
    }
    return next;
  }, base);
}

// A staff override replaces the final value of each key that it sets. It is not additive: staff
// state the limit that the team gets, add-ons included. A key that it does not set keeps its value.
function applyLimitOverrides({
  limits,
  overrides,
}: {
  limits: TeamPlanLimits;
  overrides: TeamLimitOverrides;
}): TeamPlanLimits {
  return { ...limits, ...overrides };
}

// Pure mapping from a team's stored plan + status to its entitlements. Legacy rows with
// a null planId coalesce to Free (see getPlan). Kept dependency-free so it's usable on
// both server and client and trivial to unit test.
export function getTeamEntitlements({
  planId,
  subscriptionStatus,
  planExpiresAt,
  addons,
  limitOverrides,
}: EntitlementInput): TeamEntitlements {
  const plan = getPlan(planId);
  const freePlan = getPlan(DEFAULT_PLAN_ID);

  const isFree = isFreePlan(plan);
  const grantsPaidAccess =
    getStripeSubscriptionTransitionPolicy(subscriptionStatus)?.grantsPaidAccess ?? false;
  const withinGrace =
    !planExpiresAt || Date.now() < planExpiresAt.getTime() + EXPIRY_GRACE_MS;

  const isActive = isFree ? true : grantsPaidAccess && withinGrace;

  // A failed payment stops the custom limits at once. The stored value stays, so they return
  // when Stripe collects. The Free plan is a staff grant with no payment that can fail.
  const stored = fromStoredLimitOverrides(limitOverrides);
  const appliedLimitOverrides = isActive
    ? stored.limits
    : limitOverridesWithoutPaidAccess({ overrides: stored.limits, freeLimits: freePlan.limits });

  // The order is the rule: the plan, then the add-ons, then the staff overrides.
  const limits = applyLimitOverrides({
    limits: isActive ? applyAddonLimits(plan.limits, addons ?? {}) : freePlan.limits,
    overrides: appliedLimitOverrides,
  });

  return {
    plan,
    isActive,
    limits,
    appliedLimitOverrides,
    customerLimitOverrides: limitOverridesForCustomer({
      applied: appliedLimitOverrides,
      hideFromCustomer: stored.hideFromCustomer,
    }),
  };
}

// The team-row form of getTeamEntitlements, so the seat gate and the seat counter read one rule.
export function getTeamRowEntitlements(team: TeamEntitlementColumns): TeamEntitlements {
  return getTeamEntitlements(toEntitlementInput(team));
}

/**
 * Where the value in effect of one limit key comes from: the plan, or a staff override that the
 * customer may see or not. Copy that tells the customer to upgrade is true only for `plan`.
 */
export function selectLimitSource({
  entitlements,
  key,
}: {
  entitlements: Pick<TeamEntitlements, "appliedLimitOverrides" | "customerLimitOverrides">;
  key: keyof TeamPlanLimits;
}): LimitSource {
  if (entitlements.appliedLimitOverrides[key] === undefined) {
    return LIMIT_SOURCES.PLAN;
  }

  return entitlements.customerLimitOverrides[key] === undefined
    ? LIMIT_SOURCES.HIDDEN_CUSTOM
    : LIMIT_SOURCES.CUSTOM;
}

export interface LimitOverridesReset {
  /** The new column value: only the restrictions below the Free values, or null. */
  limitOverrides: string | null;
  /** The stored value before the reset. It goes to the log line, so staff can restore a deal. */
  previous: StoredLimitOverrides;
}

/**
 * The `limitOverrides` write for a team row that leaves a paid plan for good. Null: write nothing.
 * A row that is already Free gives null, so a replay never removes a later staff grant.
 */
export function selectLimitOverridesReset({
  planId,
  limitOverrides,
}: {
  planId: string | null | undefined;
  limitOverrides: string | null | undefined;
}): LimitOverridesReset | null {
  if (isFreePlan(getPlan(planId))) {
    return null;
  }

  const previous = fromStoredLimitOverrides(limitOverrides);
  const kept = limitOverridesWithoutPaidAccess({
    overrides: previous.limits,
    freeLimits: getPlan(DEFAULT_PLAN_ID).limits,
  });
  if (Object.keys(kept).length === Object.keys(previous.limits).length) {
    return null;
  }

  // The hide flag stays with a restriction that stays. With no limit left the value is null.
  return {
    limitOverrides: toStoredLimitOverrides({ limits: kept, hideFromCustomer: previous.hideFromCustomer }),
    previous,
  };
}

// A Free plan has no payment that can fail, so the lifecycle status never gates it.
function isFreePlan(plan: TeamPlan): boolean {
  return plan.amount === 0;
}
