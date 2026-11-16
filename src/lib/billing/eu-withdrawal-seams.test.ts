import type Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getWithdrawalExtraCharges, isConsumerCustomer } = await import("./eu-withdrawal-seams");

describe("isConsumerCustomer", () => {
  test("a customer without tax IDs is a consumer", () => {
    expect(isConsumerCustomer(customer({ tax_ids: { data: [] } }))).toBe(true);
  });

  test("a customer with a tax ID is a business", () => {
    expect(isConsumerCustomer(customer({ tax_ids: { data: [{ id: "txi_1" }] } }))).toBe(false);
  });

  test("a deleted customer is not a consumer", () => {
    expect(isConsumerCustomer({ id: "cus_1", object: "customer", deleted: true })).toBe(false);
  });

  test("refuses to guess without the tax IDs", () => {
    expect(() => isConsumerCustomer(customer({}))).toThrow("tax_ids");
  });
});

describe("getWithdrawalExtraCharges", () => {
  test("charges nothing extra by default", async () => {
    await expect(getWithdrawalExtraCharges({ subscription: {} as Stripe.Subscription, withdrawnAt: new Date() })).resolves.toBe(0);
  });
});

function customer(fields: Record<string, unknown>): Stripe.Customer {
  return { id: "cus_1", object: "customer", ...fields } as unknown as Stripe.Customer;
}
