import type Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readContractStart } = await import("./contract-start");

const OPENED_AT = new Date("2026-03-01T05:44:00.000Z");
const PAID_AT = new Date("2026-03-02T01:44:00.000Z");

describe("readContractStart", () => {
  test("reads the expanded first invoice with no Stripe call", async () => {
    const stripe = fakeStripe({});

    await expect(readContractStart({ stripe, subscription: subscription({ latest_invoice: firstInvoice() }) }))
      .resolves.toEqual(PAID_AT);
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
    expect(stripe.invoices.list).not.toHaveBeenCalled();
  });

  test("retrieves the latest invoice when it is not expanded", async () => {
    const stripe = fakeStripe({ retrieved: firstInvoice() });

    await expect(readContractStart({ stripe, subscription: subscription({ latest_invoice: "in_first" }) })).resolves.toEqual(PAID_AT);
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_first");
  });

  // A later invoice in the window, for example after a change from monthly to yearly.
  test("finds the first invoice when the latest one is a later invoice", async () => {
    const later = { id: "in_later", billing_reason: "subscription_update", status_transitions: { paid_at: seconds(PAID_AT) + 3600 } };
    const stripe = fakeStripe({ listed: [later, firstInvoice()] });

    await expect(readContractStart({ stripe, subscription: subscription({ latest_invoice: later }) })).resolves.toEqual(PAID_AT);
    expect(stripe.invoices.list).toHaveBeenCalledWith(expect.objectContaining({ subscription: "sub_1", created: { gte: seconds(OPENED_AT) } }));
  });

  test("a trial starts at its subscription, with no Stripe call", async () => {
    const stripe = fakeStripe({});

    await expect(readContractStart({ stripe, subscription: subscription({ trial_start: seconds(OPENED_AT), latest_invoice: "in_first" }) }))
      .resolves.toEqual(OPENED_AT);
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
  });
});

function fakeStripe({ retrieved, listed = [] }: { retrieved?: unknown; listed?: unknown[] }) {
  return {
    invoices: {
      retrieve: vi.fn(async () => retrieved as Stripe.Invoice),
      list: vi.fn(async () => ({ data: listed as Stripe.Invoice[] })),
    },
  };
}

function firstInvoice() {
  return { id: "in_first", billing_reason: "subscription_create", status_transitions: { paid_at: seconds(PAID_AT) } };
}

function subscription(fields: Record<string, unknown>): Stripe.Subscription {
  return { id: "sub_1", start_date: seconds(OPENED_AT), trial_start: null, ...fields } as unknown as Stripe.Subscription;
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
