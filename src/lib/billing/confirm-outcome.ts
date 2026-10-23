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

/**
 * The page where the customer enters the microdeposit amounts, or null. An ACH account that
 * skips instant verification resolves with this next action, and the payment waits for days.
 */
export function getMicrodepositVerificationUrl(intent: Pick<PaymentIntent, "next_action">): string | null {
  return intent.next_action?.verify_with_microdeposits?.hosted_verification_url ?? null;
}
