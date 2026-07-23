import Stripe from "stripe";

// Error classes that PROVE Stripe rejected the request outright — no subscription was
// created — so the reservation is safe to release for a retry. Everything NOT listed here
// is ambiguous (Stripe may have created the subscription) and MUST retain the reservation:
//   - StripeConnectionError / StripeAPIError: the request may or may not have landed.
//   - StripeRateLimitError: Stripe can accept and process a call before throttling the
//     connection, so a rate-limited attempt may still have created the subscription.
//   - StripeIdempotencyError (`idempotency_key_in_use`): a sibling request with the SAME
//     key is executing RIGHT NOW. Releasing would let a fresh reservation mint a fresh key
//     and create a SECOND live trial, whose webhook the stripeSubscriptionId mismatch guard
//     would then ignore.
//
// This module is intentionally free of `server-only`/DB imports so the classification can
// be unit-tested in a plain Node environment.
const DEFINITE_STRIPE_FAILURE_ERRORS = [
  Stripe.errors.StripeCardError,
  Stripe.errors.StripeInvalidRequestError,
  Stripe.errors.StripeAuthenticationError,
  Stripe.errors.StripePermissionError,
  Stripe.errors.StripeInvalidGrantError,
] as const;

// True only when the error proves Stripe created nothing. The instanceof check also rejects
// any non-Stripe throw (a plain object with a matching `type` string does not qualify);
// connection, generic API, rate-limit, and idempotency errors are ambiguous (false), so the
// caller keeps the reservation.
export function isDefiniteStripeFailure(error: unknown): boolean {
  return DEFINITE_STRIPE_FAILURE_ERRORS.some((errorClass) => error instanceof errorClass);
}
