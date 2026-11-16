import { describe, expect, test, vi } from "vitest";

import { runCheckoutSubmit } from "./checkout-submit";

function steps({ submitError, consentFailure }: { submitError?: string; consentFailure?: string } = {}) {
  const order: string[] = [];

  return {
    order,
    submit: vi.fn(async () => {
      order.push("submit");
      return submitError ? { error: { message: submitError } } : {};
    }),
    recordConsent: vi.fn(async () => {
      order.push("consent");
      return consentFailure ? { message: consentFailure } : null;
    }),
    confirm: vi.fn(async () => {
      order.push("confirm");
    }),
    onFailure: vi.fn(),
  };
}

describe("runCheckoutSubmit", () => {
  // The submit opens a wallet sheet, so it must come before the network call of the consent.
  test("submits, records the consent, then confirms", async () => {
    const { order, ...callbacks } = steps();

    await runCheckoutSubmit({ submitFirst: true, ...callbacks });
    expect(order).toEqual(["submit", "consent", "confirm"]);
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  test("a failed consent record blocks the confirm", async () => {
    const { order, ...callbacks } = steps({ consentFailure: "Could not record" });

    await runCheckoutSubmit({ submitFirst: true, ...callbacks });
    expect(order).toEqual(["submit", "consent"]);
    expect(callbacks.onFailure).toHaveBeenCalledWith("Could not record");
  });

  test("a failed submit blocks the consent and the confirm", async () => {
    const { order, ...callbacks } = steps({ submitError: "Card incomplete" });

    await runCheckoutSubmit({ submitFirst: true, ...callbacks });
    expect(order).toEqual(["submit"]);
    expect(callbacks.onFailure).toHaveBeenCalledWith("Card incomplete");
  });

  // With the EU flow off, a payment-mode checkout keeps its old order: confirm only.
  test("without consent and without a first submit it only confirms", async () => {
    const { order, submit, confirm, onFailure } = steps();

    await runCheckoutSubmit({ submitFirst: false, submit, recordConsent: null, confirm, onFailure });
    expect(order).toEqual(["confirm"]);
  });
});
