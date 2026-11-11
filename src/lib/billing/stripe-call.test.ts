import { afterEach, describe, expect, test, vi } from "vitest";

const { fakeSpan, spanAttributes } = vi.hoisted(() => {
  const attributes = new Map<string, unknown>();
  const span = {
    isTraced: true,
    recordException: vi.fn(),
    setAttribute: vi.fn((key: string, value: unknown) => {
      attributes.set(key, value);

      return span;
    }),
  };

  return { fakeSpan: span, spanAttributes: attributes };
});

vi.mock("server-only", () => ({}));

// Pass-through, like the runtime: the real `withSpan` runs, so its exception policy is under test.
vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tracing: {
    enterSpan: (_name: string, callback: (span: unknown) => unknown) => callback(fakeSpan),
  },
}));

const { callStripe, classifyStripeError, STRIPE_OPERATIONS } = await import("./stripe-call");

const OPERATION = STRIPE_OPERATIONS.subscriptionsRetrieve;

describe("classifyStripeError", () => {
  test.each([
    [{ type: "StripeRateLimitError", statusCode: 429 }, "rate_limited"],
    [{ type: "StripeConnectionError", message: "Request timed out" }, "timeout"],
    [{ type: "StripeConnectionError", message: "socket hang up" }, "network_error"],
    [{ type: "StripeInvalidRequestError", statusCode: 404, code: "resource_missing" }, "refused"],
    [{ type: "StripeCardError", statusCode: 402 }, "refused"],
    [{ type: "StripeAuthenticationError", statusCode: 401 }, "upstream_error"],
    [{ type: "StripePermissionError", statusCode: 403 }, "upstream_error"],
    [{ type: "StripeAPIError", statusCode: 500 }, "upstream_error"],
    [new Error("unknown"), "upstream_error"],
    [null, "upstream_error"],
  ])("classifies %o as %s", (error, outcome) => {
    expect(classifyStripeError(error)).toBe(outcome);
  });
});

describe("callStripe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    spanAttributes.clear();
  });

  test("returns the result and records the operation and an ok outcome", async () => {
    await expect(callStripe({ operation: OPERATION, run: async () => "sub_123" })).resolves.toBe("sub_123");

    expect(spanAttributes.get("app.stripe.operation")).toBe(OPERATION);
    expect(spanAttributes.get("app.stripe.call.outcome")).toBe("ok");
  });

  // The log line names the failure class and codes only, never the Stripe message.
  test("rethrows the same error after one structured log line", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("No such subscription: 'sub_secret'"), {
      type: "StripeInvalidRequestError",
      statusCode: 404,
      code: "resource_missing",
    });

    await expect(callStripe({ operation: OPERATION, run: async () => Promise.reject(error) })).rejects.toBe(error);

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "stripe_call_failed",
      provider: "stripe",
      operation: OPERATION,
      outcome: "refused",
      statusCode: 404,
      providerCode: "resource_missing",
    });
    expect(line).not.toContain("sub_secret");
    // A 4xx is an answer, so the span records no exception.
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  test("records a revoked or restricted key as a span exception", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("Invalid API Key"), { type: "StripeAuthenticationError", statusCode: 401 });

    await expect(callStripe({ operation: OPERATION, run: async () => Promise.reject(error) })).rejects.toBe(error);

    expect(spanAttributes.get("app.stripe.call.outcome")).toBe("upstream_error");
    expect(fakeSpan.recordException).toHaveBeenCalled();
  });

  test("records a 5xx as a span exception", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("boom"), { type: "StripeAPIError", statusCode: 500 });

    await expect(callStripe({ operation: OPERATION, run: async () => Promise.reject(error) })).rejects.toBe(error);

    expect(spanAttributes.get("app.stripe.call.outcome")).toBe("upstream_error");
    expect(fakeSpan.recordException).toHaveBeenCalled();
  });
});
