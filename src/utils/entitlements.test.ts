import { afterEach, describe, expect, test, vi } from "vitest";

// The template ships an EMPTY add-on catalog; inject synthetic add-ons so the limit
// merge has grants to apply.
vi.mock("@/constants/addons", () => ({
  getAddon: (addonId: string | null | undefined) => {
    const addons: Record<string, { limits?: { seats?: number; projects?: number } }> = {
      "extra-seats": { limits: { seats: 5 } },
      "extra-projects": { limits: { projects: 10 } },
      "no-grants": {},
    };
    return (addonId && addons[addonId]) || null;
  },
}));

import { getTeamEntitlements, selectLimitOverridesReset } from "./entitlements";
import { TEAM_PLANS, PAID_PLAN_IDS, DEFAULT_PLAN_ID, TEAM_PLAN_LIMIT_KEYS, type TeamPlanLimits } from "@/constants/plans";
import { TEAM_LIMIT_OVERRIDE_BOUNDS, type TeamLimitOverrides } from "@/constants/limit-overrides";
import { STRIPE_SUBSCRIPTION_TRANSITION_POLICY } from "@/constants/subscription-lifecycle";
import { toStoredLimitOverrides } from "@/schemas/limit-overrides.schema";

const somePaidPlanId = PAID_PLAN_IDS[0];

// The lifecycle statuses by `grantsPaidAccess`, so a status added later lands in one of the two lists.
const LIFECYCLE_STATUSES = Object.keys(STRIPE_SUBSCRIPTION_TRANSITION_POLICY) as (keyof typeof STRIPE_SUBSCRIPTION_TRANSITION_POLICY)[];
const PAID_ACCESS_STATUSES = LIFECYCLE_STATUSES.filter((status) => STRIPE_SUBSCRIPTION_TRANSITION_POLICY[status].grantsPaidAccess);
const NO_PAID_ACCESS_STATUSES = LIFECYCLE_STATUSES.filter((status) => !STRIPE_SUBSCRIPTION_TRANSITION_POLICY[status].grantsPaidAccess);

// A custom deal from the catalog and the bounds, so a fork passes: one key above the Free value,
// and one other key below it. A fork whose Free limits leave no room for both skips those cases.
const freeLimits = TEAM_PLANS[DEFAULT_PLAN_ID].limits;
const raiseKey = TEAM_PLAN_LIMIT_KEYS.find((key) => TEAM_LIMIT_OVERRIDE_BOUNDS[key].max > freeLimits[key]);
const restrictionKey = TEAM_PLAN_LIMIT_KEYS.find(
  (key) => key !== raiseKey && TEAM_LIMIT_OVERRIDE_BOUNDS[key].min < freeLimits[key],
);
const HAS_DEAL = Boolean(raiseKey && restrictionKey);
const raise: TeamLimitOverrides = raiseKey ? { [raiseKey]: TEAM_LIMIT_OVERRIDE_BOUNDS[raiseKey].max } : {};
const restriction: TeamLimitOverrides = restrictionKey
  ? { [restrictionKey]: TEAM_LIMIT_OVERRIDE_BOUNDS[restrictionKey].min }
  : {};
const deal: TeamLimitOverrides = { ...raise, ...restriction };

describe("getTeamEntitlements", () => {
  test("null planId coalesces to the default (free) plan and is always active", () => {
    const result = getTeamEntitlements({ planId: null, subscriptionStatus: null });

    expect(result.plan).toEqual(TEAM_PLANS[DEFAULT_PLAN_ID]);
    expect(result.isActive).toBe(true);
    expect(result.limits).toEqual(TEAM_PLANS[DEFAULT_PLAN_ID].limits);
  });

  test("unknown planId falls back to the default plan", () => {
    const result = getTeamEntitlements({ planId: "does-not-exist", subscriptionStatus: null });
    expect(result.plan).toEqual(TEAM_PLANS[DEFAULT_PLAN_ID]);
  });

  test("a paid plan is active when the subscription is active or trialing", () => {
    for (const status of ["active", "trialing"]) {
      const result = getTeamEntitlements({ planId: somePaidPlanId, subscriptionStatus: status });
      expect(result.plan.id).toBe(somePaidPlanId);
      expect(result.isActive).toBe(true);
    }
  });

  test("a paid plan falls back to Free limits for non-active statuses", () => {
    for (const status of ["past_due", "canceled", "incomplete", null]) {
      const result = getTeamEntitlements({ planId: somePaidPlanId, subscriptionStatus: status });
      expect(result.isActive).toBe(false);
      expect(result.limits).toEqual(TEAM_PLANS[DEFAULT_PLAN_ID].limits);
    }
  });

  test("limits come from the plan catalog", () => {
    const result = getTeamEntitlements({ planId: somePaidPlanId, subscriptionStatus: "active" });
    expect(result.limits).toEqual(TEAM_PLANS[somePaidPlanId].limits);
  });

  test("active add-ons stack their limit grants on top of the plan's limits", () => {
    const planLimits = TEAM_PLANS[somePaidPlanId].limits;

    const result = getTeamEntitlements({
      planId: somePaidPlanId,
      subscriptionStatus: "active",
      addons: { "extra-seats": 1, "extra-projects": 1, "no-grants": 1 },
    });

    expect(result.limits).toEqual({
      seats: planLimits.seats + 5,
      projects: planLimits.projects + 10,
    });
  });

  test("add-on grants multiply by the held quantity", () => {
    const planLimits = TEAM_PLANS[somePaidPlanId].limits;

    const result = getTeamEntitlements({
      planId: somePaidPlanId,
      subscriptionStatus: "active",
      addons: { "extra-seats": 4, "extra-projects": 2 },
    });

    expect(result.limits).toEqual({
      seats: planLimits.seats + 5 * 4,
      projects: planLimits.projects + 10 * 2,
    });
  });

  test("add-on ids no longer in the catalog contribute nothing", () => {
    const result = getTeamEntitlements({
      planId: somePaidPlanId,
      subscriptionStatus: "active",
      addons: { "removed-from-catalog": 3 },
    });

    expect(result.limits).toEqual(TEAM_PLANS[somePaidPlanId].limits);
  });

  test("add-ons grant nothing when the subscription is not active", () => {
    const result = getTeamEntitlements({
      planId: somePaidPlanId,
      subscriptionStatus: "canceled",
      addons: { "extra-seats": 2 },
    });

    expect(result.limits).toEqual(TEAM_PLANS[DEFAULT_PLAN_ID].limits);
  });

  test("paid access lapses after the period end plus grace even if the status is stale", () => {
    const dayMs = 24 * 60 * 60 * 1000;

    // Webhook-failure backstop: an "active" status with a long-expired period is stale.
    const stale = getTeamEntitlements({
      planId: somePaidPlanId,
      subscriptionStatus: "active",
      planExpiresAt: new Date(Date.now() - 4 * dayMs),
    });
    expect(stale.isActive).toBe(false);
    expect(stale.limits).toEqual(TEAM_PLANS[DEFAULT_PLAN_ID].limits);

    // Within the grace window a delayed renewal webhook must not lock anyone out.
    const withinGrace = getTeamEntitlements({
      planId: somePaidPlanId,
      subscriptionStatus: "active",
      planExpiresAt: new Date(Date.now() - 1 * dayMs),
    });
    expect(withinGrace.isActive).toBe(true);

    // Callers without the team row (e.g. KV sessions) still gate on status alone.
    const withoutExpiry = getTeamEntitlements({
      planId: somePaidPlanId,
      subscriptionStatus: "active",
      planExpiresAt: null,
    });
    expect(withoutExpiry.isActive).toBe(true);
  });
});

// The staff limit overrides of one team. The values come from the bounds and the catalogs, so a
// fork with other plans passes.
describe("staff limit overrides", () => {
  const paidLimits = TEAM_PLANS[somePaidPlanId].limits;
  const active = { planId: somePaidPlanId, subscriptionStatus: "active" };
  // A value that is in bounds and differs from the given one.
  const otherValue = ({ key, than }: { key: keyof TeamPlanLimits; than: number }) => {
    const { min, max } = TEAM_LIMIT_OVERRIDE_BOUNDS[key];
    return than === max ? min : max;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("no stored value changes nothing", () => {
    expect(getTeamEntitlements({ ...active, limitOverrides: null }).limits).toEqual(paidLimits);
    expect(getTeamEntitlements({ ...active, limitOverrides: JSON.stringify({ limits: {} }) }).limits).toEqual(paidLimits);
  });

  test.each(TEAM_PLAN_LIMIT_KEYS)("an override of %s replaces that key only", (key) => {
    const value = otherValue({ key, than: paidLimits[key] });

    const result = getTeamEntitlements({ ...active, limitOverrides: stored({ [key]: value }) });

    expect(result.limits).toEqual({ ...paidLimits, [key]: value });
  });

  test("the order is plan, then add-ons, then the override: the override replaces the add-on total", () => {
    const addons = { "extra-seats": 4, "extra-projects": 2 };
    const withAddons = getTeamEntitlements({ ...active, addons }).limits;
    const seats = otherValue({ key: "seats", than: withAddons.seats });

    const result = getTeamEntitlements({ ...active, addons, limitOverrides: stored({ seats }) });

    // Not additive: the add-on seats do not stack on the override.
    expect(result.limits.seats).toBe(seats);
    // A key with no override keeps the plan value with its add-ons.
    expect(result.limits.projects).toBe(withAddons.projects);
  });

  test.each(TEAM_PLAN_LIMIT_KEYS)("an override can lower %s below the plan value", (key) => {
    const { min } = TEAM_LIMIT_OVERRIDE_BOUNDS[key];

    const result = getTeamEntitlements({ ...active, limitOverrides: stored({ [key]: min }) });

    expect(result.limits[key]).toBe(min);
  });

  test.skipIf(!HAS_DEAL).each([...NO_PAID_ACCESS_STATUSES, null])(
    "a paid plan with the status %s gets the Free limits, and only the restrictions below them",
    (subscriptionStatus) => {
      const result = getTeamEntitlements({
        planId: somePaidPlanId,
        subscriptionStatus,
        addons: { "extra-seats": 2 },
        limitOverrides: stored(deal),
      });

      expect(result.isActive).toBe(false);
      expect(result.limits).toEqual({ ...freeLimits, ...restriction });
      expect(result.appliedLimitOverrides).toEqual(restriction);
    },
  );

  test.skipIf(!HAS_DEAL)("a paid plan past its period end plus grace gets only the restrictions", () => {
    const result = getTeamEntitlements({
      ...active,
      planExpiresAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      limitOverrides: stored(deal),
    });

    expect(result.isActive).toBe(false);
    expect(result.limits).toEqual({ ...freeLimits, ...restriction });
  });

  test.skipIf(!HAS_DEAL).each(PAID_ACCESS_STATUSES)("a paid plan with the status %s gets every override", (subscriptionStatus) => {
    const result = getTeamEntitlements({ planId: somePaidPlanId, subscriptionStatus, limitOverrides: stored(deal) });

    expect(result.isActive).toBe(true);
    expect(result.limits).toEqual({ ...paidLimits, ...deal });
    expect(result.appliedLimitOverrides).toEqual(deal);
  });

  test.skipIf(!HAS_DEAL)("the overrides return when a failed payment recovers: the stored value did not change", () => {
    const limitOverrides = stored(deal);

    const failed = getTeamEntitlements({ planId: somePaidPlanId, subscriptionStatus: "past_due", limitOverrides });
    const recovered = getTeamEntitlements({ ...active, limitOverrides });

    expect(failed.limits).toEqual({ ...freeLimits, ...restriction });
    expect(recovered.limits).toEqual({ ...paidLimits, ...deal });
  });

  test.skipIf(!HAS_DEAL)("a team on the Free plan gets every override: no payment can fail", () => {
    for (const subscriptionStatus of [null, "canceled", "unpaid"]) {
      const result = getTeamEntitlements({ planId: DEFAULT_PLAN_ID, subscriptionStatus, limitOverrides: stored(deal) });

      expect(result.limits).toEqual({ ...freeLimits, ...deal });
    }
  });

  test.skipIf(!HAS_DEAL)("staff hide the overrides from the customer: the limits apply, and no override is named", () => {
    const visible = getTeamEntitlements({ ...active, limitOverrides: stored(deal) });
    const hidden = getTeamEntitlements({ ...active, limitOverrides: stored(deal, { hideFromCustomer: true }) });

    expect(visible.customerLimitOverrides).toEqual(deal);
    expect(hidden.customerLimitOverrides).toEqual({});
    expect(hidden.limits).toEqual(visible.limits);
    expect(hidden.appliedLimitOverrides).toEqual(deal);
  });

  test.skipIf(!HAS_DEAL)("the customer sees only the overrides in effect: a suspended raise is not named", () => {
    const result = getTeamEntitlements({ planId: somePaidPlanId, subscriptionStatus: "past_due", limitOverrides: stored(deal) });

    expect(result.customerLimitOverrides).toEqual(restriction);
  });

  test.each(["{not json", "[]", "42"])("the bad stored value %s falls back to the plan and does not throw", (limitOverrides) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(getTeamEntitlements({ ...active, limitOverrides }).limits).toEqual(paidLimits);
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("a bad key falls back to the plan value alone; the good key applies", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seats = otherValue({ key: "seats", than: paidLimits.seats });
    const limitOverrides = JSON.stringify({
      limits: {
        seats,
        projects: TEAM_LIMIT_OVERRIDE_BOUNDS.projects.max + 1,
        unknownLimit: 5,
      },
    });

    const result = getTeamEntitlements({ ...active, limitOverrides });

    expect(result.limits).toEqual({ ...paidLimits, seats });
    expect(log).toHaveBeenCalledTimes(1);
  });
});

// The write that ends paid access for good.
describe("the reset of the limit overrides when paid access ends", () => {
  const paid = { planId: somePaidPlanId };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.skipIf(!raiseKey)("a raise goes, and the empty result is null", () => {
    const reset = selectLimitOverridesReset({ ...paid, limitOverrides: stored(raise) });

    expect(reset).toEqual({ limitOverrides: null, previous: { limits: raise, hideFromCustomer: false } });
  });

  test.skipIf(!HAS_DEAL)("a restriction stays, with its hide flag", () => {
    const limitOverrides = stored(deal, { hideFromCustomer: true });

    const reset = selectLimitOverridesReset({ ...paid, limitOverrides });

    expect(reset?.limitOverrides).toBe(stored(restriction, { hideFromCustomer: true }));
    expect(reset?.previous).toEqual({ limits: deal, hideFromCustomer: true });
  });

  test.skipIf(!raiseKey)("the reset keeps what the team got while it had no paid access", () => {
    const limitOverrides = stored(deal);
    const suspended = getTeamEntitlements({ ...paid, subscriptionStatus: "past_due", limitOverrides });

    const reset = selectLimitOverridesReset({ ...paid, limitOverrides });
    const afterReset = getTeamEntitlements({
      planId: DEFAULT_PLAN_ID,
      subscriptionStatus: "canceled",
      limitOverrides: reset?.limitOverrides,
    });

    expect(afterReset.limits).toEqual(suspended.limits);
    expect(afterReset.appliedLimitOverrides).toEqual(suspended.appliedLimitOverrides);
  });

  test.skipIf(!restrictionKey)("nothing to drop writes nothing, so a replay is a no-op", () => {
    expect(selectLimitOverridesReset({ ...paid, limitOverrides: null })).toBeNull();
    expect(selectLimitOverridesReset({ ...paid, limitOverrides: stored(restriction) })).toBeNull();
  });

  test.skipIf(!raiseKey)("a row that is already Free keeps its overrides: a later staff grant survives a replay", () => {
    expect(selectLimitOverridesReset({ planId: DEFAULT_PLAN_ID, limitOverrides: stored(raise) })).toBeNull();
    expect(selectLimitOverridesReset({ planId: null, limitOverrides: stored(raise) })).toBeNull();
  });

  test("a bad stored value writes nothing and does not throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(selectLimitOverridesReset({ ...paid, limitOverrides: "{not json" })).toBeNull();
  });
});

// The stored text of a set of limits, as `setTeamLimitOverridesAsStaff` writes it.
function stored(limits: TeamLimitOverrides, { hideFromCustomer = false }: { hideFromCustomer?: boolean } = {}): string | null {
  return toStoredLimitOverrides({ limits, hideFromCustomer });
}
