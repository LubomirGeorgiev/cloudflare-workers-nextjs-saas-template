import { describe, expect, test } from "vitest";

import { LIMIT_SOURCES, TEAM_LIMIT_OVERRIDE_BOUNDS, type TeamLimitOverrides } from "@/constants/limit-overrides";
import { DEFAULT_PLAN_ID, PAID_PLAN_IDS, TEAM_PLAN_LIMIT_KEYS, TEAM_PLANS } from "@/constants/plans";
import { toStoredLimitOverrides } from "@/schemas/limit-overrides.schema";

import { getTeamEntitlements, selectLimitSource } from "./entitlements";

// No mocks: the selector reads two plain objects, and the real catalog builds them below.
const FREE_LIMITS = TEAM_PLANS[DEFAULT_PLAN_ID].limits;
// A key that staff can raise above the Free value, so a lapsed paid plan drops the override.
const RAISE_KEY = TEAM_PLAN_LIMIT_KEYS.find((key) => TEAM_LIMIT_OVERRIDE_BOUNDS[key].max > FREE_LIMITS[key]);
const SOME_PAID_PLAN_ID = PAID_PLAN_IDS[0];

describe.each(TEAM_PLAN_LIMIT_KEYS)("selectLimitSource for %s", (key) => {
  const override: TeamLimitOverrides = { [key]: TEAM_LIMIT_OVERRIDE_BOUNDS[key].min };

  test("is the plan when no override sets the key", () => {
    expect(selectLimitSource({
      entitlements: { appliedLimitOverrides: {}, customerLimitOverrides: {} },
      key,
    })).toBe(LIMIT_SOURCES.PLAN);
  });

  test("is custom when the customer may see the override", () => {
    expect(selectLimitSource({
      entitlements: { appliedLimitOverrides: override, customerLimitOverrides: override },
      key,
    })).toBe(LIMIT_SOURCES.CUSTOM);
  });

  test("is hidden custom when the override applies but the customer may not see it", () => {
    expect(selectLimitSource({
      entitlements: { appliedLimitOverrides: override, customerLimitOverrides: {} },
      key,
    })).toBe(LIMIT_SOURCES.HIDDEN_CUSTOM);
  });

  test("reads the stored hide flag through getTeamEntitlements", () => {
    const entitlementsFor = (hideFromCustomer: boolean) => getTeamEntitlements({
      planId: DEFAULT_PLAN_ID,
      subscriptionStatus: null,
      limitOverrides: toStoredLimitOverrides({ limits: override, hideFromCustomer }),
    });

    expect(selectLimitSource({ entitlements: entitlementsFor(false), key })).toBe(LIMIT_SOURCES.CUSTOM);
    expect(selectLimitSource({ entitlements: entitlementsFor(true), key })).toBe(LIMIT_SOURCES.HIDDEN_CUSTOM);
  });

  test("is the plan for a key that another override sets", () => {
    const otherKey = TEAM_PLAN_LIMIT_KEYS.find((candidate) => candidate !== key);
    const other: TeamLimitOverrides = otherKey ? { [otherKey]: TEAM_LIMIT_OVERRIDE_BOUNDS[otherKey].min } : {};

    expect(selectLimitSource({
      entitlements: { appliedLimitOverrides: other, customerLimitOverrides: other },
      key,
    })).toBe(LIMIT_SOURCES.PLAN);
  });
});

// A raise is suspended while a paid plan has no paid access, so the plan value applies again.
test.skipIf(!RAISE_KEY || !SOME_PAID_PLAN_ID)("is the plan while a failed payment suspends a raise", () => {
  const key = RAISE_KEY ?? TEAM_PLAN_LIMIT_KEYS[0];
  const entitlements = getTeamEntitlements({
    planId: SOME_PAID_PLAN_ID,
    subscriptionStatus: "past_due",
    limitOverrides: toStoredLimitOverrides({
      limits: { [key]: TEAM_LIMIT_OVERRIDE_BOUNDS[key].max },
      hideFromCustomer: false,
    }),
  });

  expect(selectLimitSource({ entitlements, key })).toBe(LIMIT_SOURCES.PLAN);
});
