import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The template ships an EMPTY add-on catalog; inject a synthetic one so the add-on
// price plumbing has real ids to resolve against.
vi.mock("@/constants/addons", () => ({
  TEAM_ADDON_IDS: ["extra-seats", "priority-support"],
}));

import { IS_YEARLY_BILLING_ENABLED, PAID_PLAN_IDS } from "@/constants/plans";

const SYNTHETIC_ADDON_IDS = ["extra-seats", "priority-support"];

const originalEnv = process.env;

function setPriceEnvVars() {
  // Derive env var names + price ids from the catalog so this stays correct if the
  // template's plans change.
  for (const planId of PAID_PLAN_IDS) {
    process.env[`STRIPE_PRICE_${planId.toUpperCase()}`] = `price_${planId}_test`;
    process.env[`STRIPE_PRICE_${planId.toUpperCase()}_YEAR`] = `price_${planId}_year_test`;
  }
}

function setAddonPriceEnvVars() {
  for (const addonId of SYNTHETIC_ADDON_IDS) {
    const envSegment = addonId.toUpperCase().replace(/-/g, "_");
    process.env[`STRIPE_PRICE_ADDON_${envSegment}`] = `price_addon_${addonId}_test`;
    process.env[`STRIPE_PRICE_ADDON_${envSegment}_YEAR`] = `price_addon_${addonId}_year_test`;
  }
}

describe("plan-prices", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("getPlanPriceId resolves monthly and yearly env vars per plan", async () => {
    setPriceEnvVars();

    const { getPlanPriceId } = await import("./plan-prices");

    for (const planId of PAID_PLAN_IDS) {
      expect(getPlanPriceId({ planId })).toBe(`price_${planId}_test`);
      expect(getPlanPriceId({ planId, interval: "month" })).toBe(`price_${planId}_test`);
      expect(getPlanPriceId({ planId, interval: "year" })).toBe(`price_${planId}_year_test`);
    }
  });

  test("planIdFromPriceId round-trips every paid plan's configured price ids", async () => {
    setPriceEnvVars();

    const { planIdFromPriceId } = await import("./plan-prices");

    for (const planId of PAID_PLAN_IDS) {
      expect(planIdFromPriceId(`price_${planId}_test`)).toBe(planId);
      // Yearly prices resolve to the same plan: entitlements ignore the interval.
      expect(planIdFromPriceId(`price_${planId}_year_test`)).toBe(planId);
    }
  });

  test("planIdFromPriceId returns null for unknown or empty price ids", async () => {
    setPriceEnvVars();

    const { planIdFromPriceId } = await import("./plan-prices");

    expect(planIdFromPriceId("price_unknown")).toBeNull();
    expect(planIdFromPriceId(null)).toBeNull();
    expect(planIdFromPriceId(undefined)).toBeNull();
  });

  test("getAddonPriceId resolves monthly and yearly env vars per add-on", async () => {
    setAddonPriceEnvVars();

    const { getAddonPriceId } = await import("./plan-prices");

    for (const addonId of SYNTHETIC_ADDON_IDS) {
      expect(getAddonPriceId({ addonId })).toBe(`price_addon_${addonId}_test`);
      expect(getAddonPriceId({ addonId, interval: "year" })).toBe(`price_addon_${addonId}_year_test`);
    }
  });

  test("getAddonPriceId throws when the add-on price env var is missing", async () => {
    const { getAddonPriceId } = await import("./plan-prices");

    expect(() => getAddonPriceId({ addonId: SYNTHETIC_ADDON_IDS[0] })).toThrow(/STRIPE_PRICE_ADDON_EXTRA_SEATS/);
  });

  test("addonIdFromPriceId round-trips every add-on's configured price ids", async () => {
    setAddonPriceEnvVars();

    const { addonIdFromPriceId } = await import("./plan-prices");

    for (const addonId of SYNTHETIC_ADDON_IDS) {
      expect(addonIdFromPriceId(`price_addon_${addonId}_test`)).toBe(addonId);
      expect(addonIdFromPriceId(`price_addon_${addonId}_year_test`)).toBe(addonId);
    }
    expect(addonIdFromPriceId("price_unknown")).toBeNull();
    expect(addonIdFromPriceId(null)).toBeNull();
  });

  test("resolveSubscriptionPriceId classifies plan, add-on, and unknown prices", async () => {
    setPriceEnvVars();
    setAddonPriceEnvVars();

    const { resolveSubscriptionPriceId } = await import("./plan-prices");

    expect(resolveSubscriptionPriceId(`price_${PAID_PLAN_IDS[0]}_test`))
      .toEqual({ kind: "plan", planId: PAID_PLAN_IDS[0] });
    expect(resolveSubscriptionPriceId(`price_addon_${SYNTHETIC_ADDON_IDS[0]}_test`))
      .toEqual({ kind: "addon", addonId: SYNTHETIC_ADDON_IDS[0] });
    expect(resolveSubscriptionPriceId("price_unknown")).toBeNull();
    expect(resolveSubscriptionPriceId(undefined)).toBeNull();
  });

  test("getPlanPriceId throws when the price env var is missing", async () => {
    // Derive the env var from the catalog instead of assuming a plan named "pro".
    Reflect.deleteProperty(process.env, `STRIPE_PRICE_${PAID_PLAN_IDS[0].toUpperCase()}`);
    Reflect.deleteProperty(process.env, `STRIPE_PRICE_${PAID_PLAN_IDS[0].toUpperCase()}_YEAR`);

    const { getPlanPriceId } = await import("./plan-prices");

    expect(() => getPlanPriceId({ planId: PAID_PLAN_IDS[0] })).toThrow();
    if (IS_YEARLY_BILLING_ENABLED) {
      expect(() => getPlanPriceId({ planId: PAID_PLAN_IDS[0], interval: "year" })).toThrow();
    }
  });
});
