import "server-only";

import { withSpan } from "@/utils/trace";

// One span and one log line for each Stripe call of the billing flows ("Upstream Failures"
// in CLAUDE.md). The error goes back to the caller unchanged, so its handling stays the same.

const STRIPE_CALL_SPAN_NAME = "app.stripe.call";
const STRIPE_OPERATION_ATTRIBUTE = "app.stripe.operation";
const STRIPE_OUTCOME_ATTRIBUTE = "app.stripe.call.outcome";

/** The `app.stripe.call.outcome` values. `refused` is a 4xx answer (a decline, a missing resource), not 401 or 403. */
const STRIPE_CALL_OUTCOMES = {
  ok: "ok",
  refused: "refused",
  rateLimited: "rate_limited",
  upstreamError: "upstream_error",
  timeout: "timeout",
  networkError: "network_error",
} as const;

type StripeCallOutcome = (typeof STRIPE_CALL_OUTCOMES)[keyof typeof STRIPE_CALL_OUTCOMES];

/** Low-cardinality names of the Stripe calls, for the span and the log line. */
export const STRIPE_OPERATIONS = {
  subscriptionsCreate: "subscriptions.create",
  subscriptionsRetrieve: "subscriptions.retrieve",
  subscriptionsUpdate: "subscriptions.update",
  subscriptionsCancel: "subscriptions.cancel",
  setupIntentsCreate: "setupIntents.create",
  setupIntentsRetrieve: "setupIntents.retrieve",
  customersCreate: "customers.create",
  customersUpdate: "customers.update",
  invoicesList: "invoices.list",
  billingPortalSessionsCreate: "billingPortal.sessions.create",
} as const;

type StripeOperation = (typeof STRIPE_OPERATIONS)[keyof typeof STRIPE_OPERATIONS];

interface StripeErrorFields {
  type?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
}

export function classifyStripeError(error: unknown): StripeCallOutcome {
  const { type, statusCode, message } = (error ?? {}) as StripeErrorFields;

  if (type === "StripeRateLimitError" || statusCode === 429) {
    return STRIPE_CALL_OUTCOMES.rateLimited;
  }
  if (type === "StripeConnectionError") {
    return typeof message === "string" && /timed? ?out/i.test(message)
      ? STRIPE_CALL_OUTCOMES.timeout
      : STRIPE_CALL_OUTCOMES.networkError;
  }
  // A 401 or 403 means our key is revoked or restricted: a fault on our side, not an answer.
  if (statusCode === 401 || statusCode === 403) {
    return STRIPE_CALL_OUTCOMES.upstreamError;
  }
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return STRIPE_CALL_OUTCOMES.refused;
  }

  return STRIPE_CALL_OUTCOMES.upstreamError;
}

export function callStripe<T>({
  operation,
  run,
}: {
  operation: StripeOperation;
  run: () => Promise<T>;
}): Promise<T> {
  return withSpan({
    name: STRIPE_CALL_SPAN_NAME,
    // A `refused` 4xx is Stripe's answer to our request, not a fault of Stripe.
    isExpected: (error) => classifyStripeError(error) === STRIPE_CALL_OUTCOMES.refused,
    run: async (span) => {
      span.setAttribute(STRIPE_OPERATION_ATTRIBUTE, operation);
      try {
        const result = await run();
        span.setAttribute(STRIPE_OUTCOME_ATTRIBUTE, STRIPE_CALL_OUTCOMES.ok);
        return result;
      } catch (error) {
        const outcome = classifyStripeError(error);
        const { statusCode, code } = (error ?? {}) as StripeErrorFields;
        span.setAttribute(STRIPE_OUTCOME_ATTRIBUTE, outcome);
        console.error(JSON.stringify({
          event: "stripe_call_failed",
          provider: "stripe",
          operation,
          outcome,
          statusCode: typeof statusCode === "number" ? statusCode : null,
          providerCode: typeof code === "string" ? code : null,
        }));
        throw error;
      }
    },
  });
}
