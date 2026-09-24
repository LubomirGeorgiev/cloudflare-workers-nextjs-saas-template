import { describe, expect, test } from "vitest";

import { ID_MAX_LENGTH } from "@/constants";

import {
  buildPaymentReturnUrl,
  classifyTrialCompletionFailure,
  hasPaymentReturnQuery,
  PAYMENT_RETURN_URL_KEYS,
  resolvePaymentReturn,
  TRIAL_SETUP_PENDING_REASON,
  type PaymentReturnQuery,
} from "./payment-return";

const EMPTY_QUERY: PaymentReturnQuery = {
  setupIntentId: null,
  setupIntentClientSecret: null,
  paymentIntentId: null,
  paymentIntentClientSecret: null,
  redirectStatus: null,
};

function query(overrides: Partial<PaymentReturnQuery>): PaymentReturnQuery {
  return { ...EMPTY_QUERY, ...overrides };
}

function trialQuery(overrides: Partial<PaymentReturnQuery> = {}): PaymentReturnQuery {
  return query({
    setupIntentId: "seti_123",
    setupIntentClientSecret: "seti_123_secret_abc",
    redirectStatus: "succeeded",
    ...overrides,
  });
}

describe("resolvePaymentReturn", () => {
  test("does nothing without a Stripe intent in the query", () => {
    expect(resolvePaymentReturn(EMPTY_QUERY)).toEqual({ kind: "none" });
    expect(resolvePaymentReturn(query({ redirectStatus: "failed" }))).toEqual({ kind: "none" });
  });

  test.each(["succeeded", "processing", null])("polls after a payment returns with status %s", (redirectStatus) => {
    expect(resolvePaymentReturn(query({ paymentIntentId: "pi_123", redirectStatus }))).toEqual({ kind: "poll" });
  });

  // Stripe does not document every value, so an unknown one must not continue the checkout.
  test.each(["failed", "requires_payment_method", "canceled", "a_future_status"])("reports a failure for status %s", (redirectStatus) => {
    expect(resolvePaymentReturn(query({ paymentIntentId: "pi_123", redirectStatus }))).toEqual({ kind: "failed" });
  });

  test("ignores a query that fails validation", () => {
    const oversized = "x".repeat(ID_MAX_LENGTH + 1);

    expect(resolvePaymentReturn(query({ paymentIntentId: oversized }))).toEqual({ kind: "none" });
  });

  describe("trial setup", () => {
    test("completes the trial with the SetupIntent alone", () => {
      expect(resolvePaymentReturn(trialQuery())).toEqual({ kind: "completeTrial", setupIntentId: "seti_123" });
    });

    test("leaves a missing status to the server check", () => {
      expect(resolvePaymentReturn(trialQuery({ redirectStatus: null }))).toMatchObject({ kind: "completeTrial" });
    });

    test("marks a processing SetupIntent as pending and keeps what the server needs", () => {
      expect(resolvePaymentReturn(trialQuery({ redirectStatus: "processing" }))).toEqual({
        kind: "trialPending",
        setupIntentId: "seti_123",
      });
    });

    test("reports a failed setup before it reaches the server", () => {
      expect(resolvePaymentReturn(trialQuery({ redirectStatus: "failed" }))).toEqual({ kind: "failed" });
    });
  });
});

describe("hasPaymentReturnQuery", () => {
  test("is true only when Stripe added an intent key", () => {
    expect(hasPaymentReturnQuery(EMPTY_QUERY)).toBe(false);
    expect(hasPaymentReturnQuery(query({ paymentIntentId: "pi_123" }))).toBe(true);
    expect(hasPaymentReturnQuery(query({ setupIntentId: "seti_123" }))).toBe(true);
  });

  test("ignores stray keys without an intent", () => {
    expect(hasPaymentReturnQuery(query({ paymentIntentClientSecret: "pi_123_secret_abc" }))).toBe(false);
    expect(hasPaymentReturnQuery(query({ redirectStatus: "succeeded" }))).toBe(false);
  });
});

describe("buildPaymentReturnUrl", () => {
  const PAGE = "https://preview.example.test/es/dashboard/teams/acme/billing";

  test("returns to the current origin and path", () => {
    expect(buildPaymentReturnUrl(PAGE)).toBe(PAGE);
  });

  test("drops the keys of an earlier return and keeps other query keys", () => {
    const earlier = new URL(PAGE);
    for (const key of Object.values(PAYMENT_RETURN_URL_KEYS)) {
      earlier.searchParams.set(key, "old");
    }
    earlier.searchParams.set("tab", "plans");
    earlier.hash = "plans";

    expect(buildPaymentReturnUrl(earlier.toString())).toBe(`${PAGE}?tab=plans`);
  });
});

describe("classifyTrialCompletionFailure", () => {
  const REFUSAL_REASON = "Client.Dashboard.Billing.errorTrialUnavailable";

  test.each(["INTERNAL_SERVER_ERROR", "RATE_LIMITED", undefined])("keeps the query for a retry after %s", (code) => {
    expect(classifyTrialCompletionFailure({ code, reason: undefined })).toBe("retry");
  });

  test.each(["PRECONDITION_FAILED", "CONFLICT", "INPUT_PARSE_ERROR", "FORBIDDEN"])("is final after %s", (code) => {
    expect(classifyTrialCompletionFailure({ code, reason: undefined })).toBe("final");
  });

  test("reads only the pending reason as still pending", () => {
    expect(classifyTrialCompletionFailure({ code: "PRECONDITION_FAILED", reason: TRIAL_SETUP_PENDING_REASON })).toBe("pending");
  });

  // Stripe refused the payment method, so a reload must not repeat the same create call.
  test("is final when Stripe rejects the payment method", () => {
    expect(classifyTrialCompletionFailure({
      code: "PRECONDITION_FAILED",
      reason: "Client.Dashboard.Billing.errorTrialPaymentMethodUnsupported",
    })).toBe("final");
  });

  // A card that was pending and then failed must not show the pending toast on every reload.
  test("is final when a processing redirect later gets another refusal", () => {
    expect(classifyTrialCompletionFailure({ code: "PRECONDITION_FAILED", reason: REFUSAL_REASON })).toBe("final");
  });
});
