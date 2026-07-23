import { describe, expect, test } from "vitest";
import Stripe from "stripe";

import { isDefiniteStripeFailure } from "./trial-reservation-classification";

// A minimal factory: the real Stripe error classes only need a message to construct.
function makeStripeError<T extends new (raw: Stripe.StripeRawError) => Error>(ErrorClass: T): InstanceType<T> {
  return new ErrorClass({ message: "test" }) as InstanceType<T>;
}

describe("isDefiniteStripeFailure", () => {
  // These prove Stripe rejected the request outright — nothing was created — so releasing
  // the reservation for a retry is safe.
  test.each([
    ["StripeCardError", Stripe.errors.StripeCardError],
    ["StripeInvalidRequestError", Stripe.errors.StripeInvalidRequestError],
    ["StripeAuthenticationError", Stripe.errors.StripeAuthenticationError],
    ["StripePermissionError", Stripe.errors.StripePermissionError],
    ["StripeInvalidGrantError", Stripe.errors.StripeInvalidGrantError],
  ])("classifies %s as a definite failure (release)", (_name, ErrorClass) => {
    expect(isDefiniteStripeFailure(makeStripeError(ErrorClass))).toBe(true);
  });

  // These are AMBIGUOUS: Stripe may have created the subscription, so the reservation must
  // be retained. Idempotency and rate-limit errors are the security-critical members — an
  // `idempotency_key_in_use` conflict means a sibling request holding the same key is live
  // right now; releasing would let a fresh key mint a SECOND trial.
  test.each([
    ["StripeIdempotencyError", Stripe.errors.StripeIdempotencyError],
    ["StripeRateLimitError", Stripe.errors.StripeRateLimitError],
    ["StripeConnectionError", Stripe.errors.StripeConnectionError],
    ["StripeAPIError", Stripe.errors.StripeAPIError],
  ])("classifies %s as ambiguous (retain)", (_name, ErrorClass) => {
    expect(isDefiniteStripeFailure(makeStripeError(ErrorClass))).toBe(false);
  });

  test("rejects non-Stripe throws", () => {
    expect(isDefiniteStripeFailure(new Error("boom"))).toBe(false);
    // A plain object merely shaped like a Stripe error must not qualify.
    expect(isDefiniteStripeFailure({ type: "StripeCardError" })).toBe(false);
    expect(isDefiniteStripeFailure(null)).toBe(false);
    expect(isDefiniteStripeFailure(undefined)).toBe(false);
  });
});
