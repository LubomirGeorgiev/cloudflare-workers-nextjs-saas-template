import type Stripe from "stripe";
import { afterEach, describe, expect, test, vi } from "vitest";

import { EU_WITHDRAWAL_ENABLED } from "@/constants";

const { flagFailedWithdrawalRefundMock, reconcileMock } = vi.hoisted(() => ({
  flagFailedWithdrawalRefundMock: vi.fn(async () => true),
  reconcileMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/team-subscription", () => ({ reconcileTeamFromSubscription: reconcileMock }));
vi.mock("@/lib/billing/eu-withdrawal-recovery", () => ({ flagFailedWithdrawalRefund: flagFailedWithdrawalRefundMock }));

const { handleStripeEvent, STRIPE_EVENT_RESULT } = await import("./stripe-webhook-handler");

const REFUND = { id: "re_1", object: "refund", payment_intent: "pi_1" } as Stripe.Refund;
const REFUND_FAILED = { type: "refund.failed", data: { object: REFUND } } as Stripe.Event;

describe("handleStripeEvent refund.failed", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("passes a failed refund to the EU withdrawal flow", async () => {
    await expect(handleStripeEvent(REFUND_FAILED)).resolves.toBe(STRIPE_EVENT_RESULT.OK);

    expect(flagFailedWithdrawalRefundMock).toHaveBeenCalledWith({ refund: REFUND });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("ignores a failed refund that is not a withdrawal refund", async () => {
    flagFailedWithdrawalRefundMock.mockResolvedValueOnce(false);

    await expect(handleStripeEvent(REFUND_FAILED)).resolves.toBe(STRIPE_EVENT_RESULT.IGNORED);
  });

  test.skipIf(EU_WITHDRAWAL_ENABLED)("ignores a failed refund while the EU withdrawal is off", async () => {
    await expect(handleStripeEvent(REFUND_FAILED)).resolves.toBe(STRIPE_EVENT_RESULT.IGNORED);

    expect(flagFailedWithdrawalRefundMock).not.toHaveBeenCalled();
  });
});
