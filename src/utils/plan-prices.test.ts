import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { IS_YEARLY_BILLING_ENABLED, PAID_PLAN_IDS } from "@/constants/plans";

const originalEnv = process.env;

function setPriceEnvVars() {
  // Derive env var names + price ids from the catalog so this stays correct if the
  // template's plans change.
  for (const planId of PAID_PLAN_IDS) {
    process.env[`STRIPE_PRICE_${planId.toUpperCase()}`] = `price_${planId}_test`;
    process.env[`STRIPE_PRICE_${planId.toUpperCase()}_YEAR`] = `price_${planId}_year_test`;
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
