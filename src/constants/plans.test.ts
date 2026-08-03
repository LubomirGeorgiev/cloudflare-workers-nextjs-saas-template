import { describe, expect, test } from "vitest";

import {
  AVAILABLE_BILLING_INTERVALS,
  IS_YEARLY_BILLING_ENABLED,
  PAID_PLAN_IDS,
  TEAM_PLANS,
  YEARLY_DISCOUNT_PERCENT,
  getPlanAmount,
  getYearlyAmount,
} from "./plans";

describe("plans catalog yearly billing", () => {
  test("available intervals follow the yearlyDiscountPercent flag", () => {
    if (IS_YEARLY_BILLING_ENABLED) {
      expect(AVAILABLE_BILLING_INTERVALS).toEqual(["month", "year"]);
    } else {
      expect(AVAILABLE_BILLING_INTERVALS).toEqual(["month"]);
    }
  });

  test("yearly amounts apply the configured discount to 12 monthly payments", () => {
    for (const planId of PAID_PLAN_IDS) {
      const plan = TEAM_PLANS[planId];
      if (plan.interval !== "month") {
        continue;
      }

      const fullYear = plan.amount * 12;
      const expected = Math.round((fullYear * (100 - (YEARLY_DISCOUNT_PERCENT ?? 0))) / 100);

      expect(getYearlyAmount(plan)).toBe(expected);
      expect(getYearlyAmount(plan)).toBeLessThanOrEqual(fullYear);
      expect(getYearlyAmount(plan)).toBeGreaterThan(0);
    }
  });

  test("getPlanAmount picks the interval-specific amount", () => {
    for (const planId of PAID_PLAN_IDS) {
      const plan = TEAM_PLANS[planId];
      expect(getPlanAmount({ plan, interval: "month" })).toBe(plan.amount);
      expect(getPlanAmount({ plan, interval: "year" })).toBe(getYearlyAmount(plan));
    }
  });
});
