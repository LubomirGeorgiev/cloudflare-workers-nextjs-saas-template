import type Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";

import { EU_EEA_COUNTRY_CODES } from "@/constants/eu-withdrawal";

vi.mock("server-only", () => ({}));

const { getWithdrawalExtraCharges, isConsumerCustomer } = await import("./eu-withdrawal-seams");

describe("isConsumerCustomer", () => {
  // GP, GF, MQ, RE, YT, and MF are French outermost regions: EU territory with their own ISO codes.
  test.each(["BG", "DE", "NO", "GP", "GF", "MQ", "RE", "YT", "MF"])("a customer in %s without a tax ID is an EU consumer", (country) => {
    expect(isConsumerCustomer({ customer: customer({ country }), paymentMethod: null })).toBe(true);
  });

  // The right of withdrawal is EU/EEA law: a consumer in the US or the UK does not have it.
  test.each(["US", "GB", "CH"])("a customer in %s without a tax ID has no right of withdrawal", (country) => {
    expect(isConsumerCustomer({ customer: customer({ country }), paymentMethod: null })).toBe(false);
  });

  test("a customer with a tax ID is a business, also in the EU", () => {
    expect(isConsumerCustomer({ customer: customer({ country: "DE", taxIds: [{ id: "txi_1" }] }), paymentMethod: null })).toBe(false);
  });

  test.each([
    ["the customer's address", { customer: customer({ country: "US" }), paymentMethod: paymentMethod({ billing: "DE", card: "DE" }) }],
    ["the billing address", { customer: customer({}), paymentMethod: paymentMethod({ billing: "US", card: "DE" }) }],
    ["the card's issuing country", { customer: customer({}), paymentMethod: paymentMethod({ card: "US" }) }],
  ])("reads the country from %s first", (__source, params) => {
    expect(isConsumerCustomer(params)).toBe(false);
  });

  test.each([
    ["the billing address", paymentMethod({ billing: "DE" })],
    ["the card's issuing country", paymentMethod({ card: "DE" })],
  ])("falls back to %s", (__source, method) => {
    expect(isConsumerCustomer({ customer: customer({}), paymentMethod: method })).toBe(true);
  });

  // A missed EU consumer is a legal risk; an extra refund is only a cost.
  test("a customer with no known country counts as an EU consumer", () => {
    expect(isConsumerCustomer({ customer: customer({}), paymentMethod: null })).toBe(true);
    expect(isConsumerCustomer({ customer: customer({}), paymentMethod: paymentMethod({}) })).toBe(true);
  });

  test("the list holds the 27 EU members, the 3 EEA states, and the 6 French outermost regions", () => {
    expect(new Set(EU_EEA_COUNTRY_CODES).size).toBe(36);
  });

  test("a deleted customer is not a consumer", () => {
    expect(isConsumerCustomer({ customer: { id: "cus_1", object: "customer", deleted: true }, paymentMethod: null })).toBe(false);
  });

  test("refuses to guess without the tax IDs", () => {
    const unexpanded = { id: "cus_1", object: "customer", address: { country: "DE" } } as unknown as Stripe.Customer;
    expect(() => isConsumerCustomer({ customer: unexpanded, paymentMethod: null })).toThrow("tax_ids");
  });
});

describe("getWithdrawalExtraCharges", () => {
  test("charges nothing extra by default", async () => {
    await expect(getWithdrawalExtraCharges({ subscription: {} as Stripe.Subscription, withdrawnAt: new Date() })).resolves.toBe(0);
  });
});

function customer({ country, taxIds = [] }: { country?: string; taxIds?: unknown[] }): Stripe.Customer {
  return {
    id: "cus_1",
    object: "customer",
    address: country ? { country } : null,
    tax_ids: { data: taxIds },
  } as unknown as Stripe.Customer;
}

function paymentMethod({ billing, card }: { billing?: string; card?: string }): Stripe.PaymentMethod {
  return {
    id: "pm_1",
    object: "payment_method",
    billing_details: { address: billing ? { country: billing } : null },
    card: card ? { country: card } : undefined,
  } as unknown as Stripe.PaymentMethod;
}
