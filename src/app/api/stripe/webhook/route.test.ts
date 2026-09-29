import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { STRIPE_EVENT_RESULT } from "@/utils/stripe-webhook-handler";

const WEBHOOK_SPAN_NAME = "app.stripe.webhook";
const EVENT_TYPE_ATTRIBUTE = "app.stripe.event_type";
const OUTCOME_ATTRIBUTE = "app.stripe.outcome";
const HANDLED_EVENT_TYPE = "customer.subscription.updated";
const UNHANDLED_EVENT_TYPE = "charge.succeeded";

const {
  constructEventMock,
  enteredSpans,
  reconcileMock,
  recordSpanExceptionMock,
  retrieveSubscriptionMock,
  spanAttributes,
} = vi.hoisted(() => ({
  constructEventMock: vi.fn(),
  enteredSpans: [] as string[],
  reconcileMock: vi.fn(),
  recordSpanExceptionMock: vi.fn(),
  retrieveSubscriptionMock: vi.fn(),
  spanAttributes: new Map<string, unknown>(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/trace", () => ({
  recordSpanException: recordSpanExceptionMock,
  withSpan: ({ name, run }: { name: string; run: (span: unknown) => Promise<unknown> }) => {
    enteredSpans.push(name);

    return run({
      isTraced: true,
      setAttribute: (key: string, value: unknown) => {
        spanAttributes.set(key, value);
      },
      setAttributes: (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) {
          spanAttributes.set(key, value);
        }
      },
    });
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(async () => ({
    subscriptions: { retrieve: retrieveSubscriptionMock },
    webhooks: { constructEventAsync: constructEventMock },
  })),
}));

vi.mock("@/utils/team-subscription", () => ({
  reconcileTeamFromSubscription: reconcileMock,
}));

const { POST } = await import("./route");

describe("Stripe webhook span", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_unit");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_unit");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.error).mockRestore();
    vi.clearAllMocks();
    enteredSpans.length = 0;
    spanAttributes.clear();
  });

  test("tags a reconciled subscription event as ok", async () => {
    constructEventMock.mockResolvedValue(buildEvent(HANDLED_EVENT_TYPE));
    retrieveSubscriptionMock.mockResolvedValue({ id: "sub_1" });

    const response = await POST(signedRequest());

    expect(response.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledOnce();
    expect(enteredSpans).toEqual([WEBHOOK_SPAN_NAME]);
    expect(Object.fromEntries(spanAttributes)).toEqual({
      [EVENT_TYPE_ATTRIBUTE]: HANDLED_EVENT_TYPE,
      [OUTCOME_ATTRIBUTE]: STRIPE_EVENT_RESULT.OK,
    });
  });

  test("tags an event type with no handler branch as ignored", async () => {
    constructEventMock.mockResolvedValue(buildEvent(UNHANDLED_EVENT_TYPE));

    const response = await POST(signedRequest());

    expect(response.status).toBe(200);
    expect(retrieveSubscriptionMock).not.toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(STRIPE_EVENT_RESULT.IGNORED);
  });

  test("tags a handled event with no subscription", async () => {
    constructEventMock.mockResolvedValue({
      type: "invoice.paid",
      data: { object: { object: "invoice", id: "in_1" } },
    });

    const response = await POST(signedRequest());

    expect(response.status).toBe(200);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(STRIPE_EVENT_RESULT.NO_SUBSCRIPTION);
  });

  test("tags a refused signature without an exception", async () => {
    const failure = new Error("signature mismatch");
    constructEventMock.mockRejectedValue(failure);

    const response = await POST(signedRequest());

    expect(response.status).toBe(400);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("bad_signature");
    expect(spanAttributes.has(EVENT_TYPE_ATTRIBUTE)).toBe(false);
    expect(recordSpanExceptionMock).not.toHaveBeenCalled();
  });

  test("tags a missing signature header as a bad request", async () => {
    const response = await POST(new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    }));

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("bad_request");
  });

  test("tags a template with no Stripe config as not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");

    const response = await POST(signedRequest());

    expect(response.status).toBe(200);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("not_configured");
  });

  test("tags a handler failure, records it, and still returns 500 so Stripe retries", async () => {
    const failure = new Error("stripe unavailable");
    constructEventMock.mockResolvedValue(buildEvent(HANDLED_EVENT_TYPE));
    retrieveSubscriptionMock.mockRejectedValue(failure);

    const response = await POST(signedRequest());

    expect(response.status).toBe(500);
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("handler_error");
    expect(recordSpanExceptionMock).toHaveBeenCalledWith(expect.objectContaining({ error: failure }));
  });
});

function buildEvent(type: string) {
  return { type, data: { object: { object: "subscription", id: "sub_1" } } };
}

// Signature checks are mocked, so any header value reaches `constructEventAsync`.
function signedRequest(): Request {
  return new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "t=1,v1=unit" },
  });
}
