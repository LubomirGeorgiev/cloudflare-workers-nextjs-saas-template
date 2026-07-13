/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { handleStripeEvent } from "@/utils/stripe-webhook-handler";
import { POST } from "@/app/api/stripe/webhook/route";

// Delegate to the real handler by default; individual tests can override to probe the
// route's error contract without real Stripe traffic.
vi.mock("@/utils/stripe-webhook-handler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/stripe-webhook-handler")>();
  return { ...actual, handleStripeEvent: vi.fn(actual.handleStripeEvent) };
});

const WEBHOOK_SECRET = "whsec_integration_test";
const BILLING_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
] as const;

function enableBilling(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_integration";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_integration";
}

function disableBilling(): void {
  for (const key of BILLING_ENV_KEYS) {
    Reflect.deleteProperty(process.env, key);
  }
}

// Stripe's signature scheme: HMAC-SHA256 over `${timestamp}.${payload}`, sent as
// `t=<ts>,v1=<hex>`. Computed with Web Crypto because stripe-node's synchronous
// generateTestHeaderString cannot run on the Workers SubtleCrypto provider.
async function signedRequest(payload: string): Promise<Request> {
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": `t=${timestamp},v1=${hex}` },
  });
}

function eventPayload(type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id: "evt_test", object: "event", type, data: { object } });
}

describe("Stripe webhook route", () => {
  beforeEach(() => {
    enableBilling();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.mocked(handleStripeEvent).mockRestore?.();
  });

  afterAll(() => {
    disableBilling();
  });

  test("no-ops with 200 when billing is not configured", async () => {
    disableBilling();

    const response = await POST(new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    }));

    expect(response.status).toBe(200);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  test("rejects with 400 when Stripe is partially configured (webhook secret missing)", async () => {
    disableBilling();
    // Checkout keys present but no STRIPE_WEBHOOK_SECRET: a 200 here would make Stripe
    // mark deliveries successful and silently drop lifecycle events.
    process.env.STRIPE_SECRET_KEY = "sk_test_integration";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_integration";

    const response = await POST(new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      body: eventPayload("customer.subscription.updated", { object: "subscription", id: "sub_x" }),
      headers: { "stripe-signature": "t=1,v1=irrelevant" },
    }));

    expect(response.status).toBe(400);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  test("rejects a request without a signature header", async () => {
    const response = await POST(new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      body: eventPayload("customer.subscription.updated", { object: "subscription", id: "sub_x" }),
    }));

    expect(response.status).toBe(400);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  test("rejects a request with an invalid signature", async () => {
    const response = await POST(new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      body: eventPayload("customer.subscription.updated", { object: "subscription", id: "sub_x" }),
      headers: { "stripe-signature": "t=1,v1=invalid" },
    }));

    expect(response.status).toBe(400);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  test("acks unhandled event types with 200", async () => {
    const response = await POST(await signedRequest(
      eventPayload("customer.created", { object: "customer", id: "cus_x" }),
    ));

    expect(response.status).toBe(200);
    expect(handleStripeEvent).toHaveBeenCalledOnce();
  });

  test("acks handled events with no resolvable subscription with 200", async () => {
    const response = await POST(await signedRequest(eventPayload("invoice.paid", { object: "invoice" })));

    expect(response.status).toBe(200);
  });

  test("returns 500 when the handler fails so Stripe retries", async () => {
    vi.mocked(handleStripeEvent).mockRejectedValueOnce(new Error("boom"));

    const response = await POST(await signedRequest(
      eventPayload("customer.subscription.updated", { object: "subscription", id: "sub_boom" }),
    ));

    expect(response.status).toBe(500);
  });
});
