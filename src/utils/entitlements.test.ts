import { describe, expect, test } from "vitest";

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
