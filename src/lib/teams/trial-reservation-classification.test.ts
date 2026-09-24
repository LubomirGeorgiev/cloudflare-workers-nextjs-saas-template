import { describe, expect, test } from "vitest";
import Stripe from "stripe";

import { isDefiniteStripeFailure, isPaymentMethodRejection } from "./trial-reservation-classification";

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

describe("isPaymentMethodRejection", () => {
  // Stripe refused the request itself, so the same payment method fails on every retry.
  test.each([
    ["StripeCardError", Stripe.errors.StripeCardError],
    ["StripeInvalidRequestError", Stripe.errors.StripeInvalidRequestError],
  ])("classifies %s as a rejection", (_name, ErrorClass) => {
    const error = makeStripeError(ErrorClass);

    expect(isPaymentMethodRejection(error)).toBe(true);
    // A rejection must also release the reservation: Stripe created nothing.
    expect(isDefiniteStripeFailure(error)).toBe(true);
  });

  test("classifies an unsupported payment method type as a rejection", () => {
    const error = new Stripe.errors.StripeInvalidRequestError({
      message: "unsupported currency",
      param: "default_payment_method",
    });

    expect(isPaymentMethodRejection(error)).toBe(true);
  });

  // Definite failures of our own credentials or account are not the customer's payment method.
  test.each([
    ["StripeAuthenticationError", Stripe.errors.StripeAuthenticationError],
    ["StripePermissionError", Stripe.errors.StripePermissionError],
    ["StripeInvalidGrantError", Stripe.errors.StripeInvalidGrantError],
  ])("does not classify %s as a rejection", (_name, ErrorClass) => {
    expect(isPaymentMethodRejection(makeStripeError(ErrorClass))).toBe(false);
  });

  // Ambiguous failures stay retryable: Stripe may still create the subscription.
  test.each([
    ["StripeIdempotencyError", Stripe.errors.StripeIdempotencyError],
    ["StripeRateLimitError", Stripe.errors.StripeRateLimitError],
    ["StripeConnectionError", Stripe.errors.StripeConnectionError],
    ["StripeAPIError", Stripe.errors.StripeAPIError],
  ])("does not classify ambiguous %s as a rejection", (_name, ErrorClass) => {
    expect(isPaymentMethodRejection(makeStripeError(ErrorClass))).toBe(false);
  });

  test("rejects non-Stripe throws", () => {
    expect(isPaymentMethodRejection(new Error("boom"))).toBe(false);
    expect(isPaymentMethodRejection({ type: "StripeCardError" })).toBe(false);
    expect(isPaymentMethodRejection(undefined)).toBe(false);
  });
});
