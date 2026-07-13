import { describe, expect, test, vi } from "vitest";

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

import { getTeamEntitlements } from "./entitlements";
import { TEAM_PLANS, PAID_PLAN_IDS, DEFAULT_PLAN_ID } from "@/constants/plans";

const somePaidPlanId = PAID_PLAN_IDS[0];

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
