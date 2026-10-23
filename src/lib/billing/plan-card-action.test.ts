import { describe, expect, test } from "vitest";

import { mustPayOrCancel, STRIPE_SUBSCRIPTION_TRANSITION_POLICY } from "@/constants/subscription-lifecycle";
import { selectPlanCardAction } from "./plan-card-action";

const BASE = {
  canManage: true,
  isFree: false,
  isCurrent: true,
  status: null,
  hasActiveSubscription: false,
  cancelAtPeriodEnd: false,
  matchesCurrentInterval: true,
  offersTrial: false,
};

// Statuses where the server refuses a new checkout and the team has no paid access.
const PAY_OR_CANCEL_STATUSES = Object.entries(STRIPE_SUBSCRIPTION_TRANSITION_POLICY)
  .filter(([, policy]) => policy.subscribe === "block" && !policy.grantsPaidAccess)
  .map(([status]) => status);

describe("selectPlanCardAction", () => {
  test("past_due must pay or cancel", () => {
    expect(PAY_OR_CANCEL_STATUSES).toContain("past_due");
  });

  // The server refuses a checkout for these statuses, so no card may offer one.
  test.each(PAY_OR_CANCEL_STATUSES)("a %s team can cancel the current plan and cannot subscribe", (status) => {
    expect(mustPayOrCancel(status)).toBe(true);
    expect(selectPlanCardAction({ ...BASE, status })).toBe("cancelNow");
    expect(selectPlanCardAction({ ...BASE, status, isCurrent: false })).toBe("none");
  });

  test.each(["active", "trialing"])("a %s team cancels at period end", (status) => {
    expect(selectPlanCardAction({ ...BASE, status, hasActiveSubscription: true })).toBe("cancelAtPeriodEnd");
    expect(selectPlanCardAction({ ...BASE, status, hasActiveSubscription: true, isCurrent: false })).toBe("changePlan");
  });

  test("a scheduled cancel shows no second cancel", () => {
    expect(selectPlanCardAction({ ...BASE, status: "active", hasActiveSubscription: true, cancelAtPeriodEnd: true }))
      .toBe("cancelScheduled");
  });

  test("the other interval on the current plan switches the interval", () => {
    expect(selectPlanCardAction({ ...BASE, status: "active", hasActiveSubscription: true, matchesCurrentInterval: false }))
      .toBe("switchInterval");
  });

  test.each([null, "incomplete", "canceled", "unpaid"])("a team with status %s can subscribe", (status) => {
    expect(selectPlanCardAction({ ...BASE, status, isCurrent: false })).toBe("subscribe");
    expect(selectPlanCardAction({ ...BASE, status, isCurrent: false, offersTrial: true })).toBe("startTrial");
  });

  test("a free plan or a member without billing access gets no button", () => {
    expect(selectPlanCardAction({ ...BASE, isFree: true })).toBe("none");
    expect(selectPlanCardAction({ ...BASE, canManage: false, status: "past_due" })).toBe("none");
  });
});
