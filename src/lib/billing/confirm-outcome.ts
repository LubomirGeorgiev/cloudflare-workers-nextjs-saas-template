import type { PaymentIntent, SetupIntent } from "@stripe/stripe-js";

type ConfirmOutcome = "success" | "cancel";

// "processing" also goes on: the server retries a processing SetupIntent, and payment mode polls.
const PROCEEDING_INTENT_STATUSES: ReadonlySet<SetupIntent.Status | PaymentIntent.Status> = new Set([
  "succeeded",
  "processing",
]);

/**
 * What the checkout dialog does after a confirm that returned no error. Stripe.js resolves without
 * an error when the customer closes a QR or wallet modal (Cash App Pay), so the status decides.
 */
export function classifyConfirmedIntentStatus(status: SetupIntent.Status | PaymentIntent.Status): ConfirmOutcome {
  return PROCEEDING_INTENT_STATUSES.has(status) ? "success" : "cancel";
}
