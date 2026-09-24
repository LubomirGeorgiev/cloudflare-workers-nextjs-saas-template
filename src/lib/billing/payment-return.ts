import type { ActionErrorMessageKey } from "@/lib/action-error";
import { v } from "@/lib/validation";
import { paymentReturnSchema } from "@/schemas/billing.schema";

// Query keys that Stripe appends to the return URL of a redirect-based payment method.
export const PAYMENT_RETURN_URL_KEYS = {
  setupIntentId: "setup_intent",
  setupIntentClientSecret: "setup_intent_client_secret",
  paymentIntentId: "payment_intent",
  paymentIntentClientSecret: "payment_intent_client_secret",
  redirectStatus: "redirect_status",
} as const;

// completeTrialAction failures that a later call can fix. A repeat call is safe: the server
// re-verifies the SetupIntent and refuses a second trial (see completeTrialSubscription).
const RETRYABLE_TRIAL_ERROR_CODES: ReadonlySet<string> = new Set(["INTERNAL_SERVER_ERROR", "RATE_LIMITED"]);

// The ActionError reason completeTrialSubscription sends for a SetupIntent that is still
// "processing". Only this reason keeps the return query; every other refusal is final.
export const TRIAL_SETUP_PENDING_REASON = "Client.Dashboard.Billing.trialSetupPending" satisfies ActionErrorMessageKey;

export type PaymentReturnQuery = Record<keyof typeof PAYMENT_RETURN_URL_KEYS, string | null>;

// The server reads the plan and interval from the SetupIntent metadata, so its id is enough.
export interface TrialReturn {
  setupIntentId: string;
}

export type PaymentReturnAction =
  | { kind: "none" }
  | { kind: "failed" }
  | ({ kind: "trialPending" } & TrialReturn)
  | ({ kind: "completeTrial" } & TrialReturn)
  | { kind: "poll" };

// "final" clears the return query; "retry" keeps it, so a reload runs the return again.
export type PaymentReturnOutcome = "final" | "retry";

type TrialCompletionFailure = PaymentReturnOutcome | "pending";

/**
 * The URL Stripe sends the customer back to: the current page on the current host, so a preview
 * deployment returns to itself. The keys of an earlier return go, because Stripe appends new ones.
 */
export function buildPaymentReturnUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  for (const key of Object.values(PAYMENT_RETURN_URL_KEYS)) {
    url.searchParams.delete(key);
  }
  url.hash = "";

  return url.toString();
}

// Stripe adds an intent key to every return.
export function hasPaymentReturnQuery(query: PaymentReturnQuery): boolean {
  return query.setupIntentId !== null || query.paymentIntentId !== null;
}

/**
 * Decides the UI step after Stripe sends the customer back. The server stays the authority: a
 * trial completes only after completeTrialAction verifies the SetupIntent, and a payment only
 * after the webhook activates the team.
 */
export function resolvePaymentReturn(query: PaymentReturnQuery): PaymentReturnAction {
  const parsed = v.safeParse(paymentReturnSchema, query);
  if (!parsed.success) {
    return { kind: "none" };
  }

  const { setupIntentId, paymentIntentId, redirectStatus } = parsed.output;
  if (!setupIntentId && !paymentIntentId) {
    return { kind: "none" };
  }

  // A missing status is not a failure: the server check below decides instead.
  if (redirectStatus === "failed") {
    return { kind: "failed" };
  }

  // Only startTrialSetupAction confirms a SetupIntent. It can succeed after the redirect, so a
  // "processing" return still asks the server.
  if (setupIntentId) {
    return redirectStatus === "processing"
      ? { kind: "trialPending", setupIntentId }
      : { kind: "completeTrial", setupIntentId };
  }

  return { kind: "poll" };
}

/**
 * Decides what a failed completeTrialAction call means for the return query. A missing code is
 * a network failure. Only the pending reason means "not confirmed yet": a card that later fails
 * gets a different refusal, so the page clears the query and shows the real message.
 */
export function classifyTrialCompletionFailure({
  code,
  reason,
}: {
  code: string | undefined;
  reason: string | undefined;
}): TrialCompletionFailure {
  if (reason === TRIAL_SETUP_PENDING_REASON) {
    return "pending";
  }
  if (!code || RETRYABLE_TRIAL_ERROR_CODES.has(code)) {
    return "retry";
  }
  return "final";
}
