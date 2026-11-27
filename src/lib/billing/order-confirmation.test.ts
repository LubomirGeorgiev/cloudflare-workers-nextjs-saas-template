import { afterEach, describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import { EMAIL_TEMPLATE_TYPES } from "@/lib/scheduler/jobs";

const { sendSavedEmailMock } = vi.hoisted(() => ({ sendSavedEmailMock: vi.fn(async () => undefined) }));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/email", () => ({
  saveOrderConfirmationEmail: vi.fn(),
  sendSavedEmail: sendSavedEmailMock,
}));

const { isOrderConfirmationDue, sendOrderConfirmation } = await import("@/lib/billing/order-confirmation");

const SUBSCRIPTION = { id: "sub_1", status: "active" } as Stripe.Subscription;
const NOT_YET_ORDERED = { subscriptionStatus: "incomplete", stripeSubscriptionId: "sub_1" };
const ALREADY_ACTIVE = { subscriptionStatus: "active", stripeSubscriptionId: "sub_1" };

describe("isOrderConfirmationDue", () => {
  test("the first access of the team's subscription is due", () => {
    expect(isOrderConfirmationDue({ previous: NOT_YET_ORDERED, subscription: SUBSCRIPTION })).toBe(true);
    expect(isOrderConfirmationDue({
      previous: { subscriptionStatus: null, stripeSubscriptionId: null },
      subscription: SUBSCRIPTION,
    })).toBe(true);
  });

  test("a replay, a replaced subscription, and a status with no access are not due", () => {
    expect(isOrderConfirmationDue({ previous: ALREADY_ACTIVE, subscription: SUBSCRIPTION })).toBe(false);
    expect(isOrderConfirmationDue({
      previous: { subscriptionStatus: "incomplete", stripeSubscriptionId: "sub_other" },
      subscription: SUBSCRIPTION,
    })).toBe(false);
    expect(isOrderConfirmationDue({
      previous: NOT_YET_ORDERED,
      subscription: { id: "sub_1", status: "incomplete" },
    })).toBe(false);
  });
});

describe("sendOrderConfirmation", () => {
  const saved = [{
    dedupeKey: "order-confirmation:sub_1:hash",
    runAt: new Date(),
    payload: {
      to: "buyer@example.com",
      template: EMAIL_TEMPLATE_TYPES.ORDER_CONFIRMATION,
      locale: "en",
      data: {
        username: "buyer",
        teamName: "Acme",
        teamSlug: "acme",
        planName: "Pro",
        startedAt: "2026-03-01T09:30:00.000Z",
        withdrawal: null,
      },
    },
  }] as Parameters<typeof sendOrderConfirmation>[0]["saved"];

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("sends the saved rows when this write claimed the first activation", async () => {
    await sendOrderConfirmation({ saved, subscription: SUBSCRIPTION, previous: NOT_YET_ORDERED });

    expect(sendSavedEmailMock).toHaveBeenCalledWith(saved[0]);
  });

  // The winner saved the same keys and sends them; a second send here would race it.
  test("leaves the rows when a concurrent write claimed the activation first", async () => {
    await sendOrderConfirmation({ saved, subscription: SUBSCRIPTION, previous: ALREADY_ACTIVE });

    expect(sendSavedEmailMock).not.toHaveBeenCalled();
  });
});
