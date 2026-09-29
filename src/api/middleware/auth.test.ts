import { Hono } from "hono";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ApiEnv } from "@/api/types";
import { API_KEY_PREFIX_LIVE } from "@/constants";
import type { ApiPrincipal } from "@/lib/api/principal";
import { generateApiKey } from "@/utils/api-key-format";

const {
  enforceAnonRateLimitMock,
  fakeSpan,
  getApiKeyPrincipalMock,
  principalFromBearerPropsMock,
  spanAttributes,
} = vi.hoisted(() => {
  const attributes = new Map<string, unknown>();
  const span = {
    isTraced: true,
    recordException: vi.fn(),
    setAttribute: vi.fn((key: string, value: unknown) => {
      attributes.set(key, value);

      return span;
    }),
    setAttributes: vi.fn(),
  };

  return {
    enforceAnonRateLimitMock: vi.fn(async () => null),
    fakeSpan: span,
    getApiKeyPrincipalMock: vi.fn(),
    principalFromBearerPropsMock: vi.fn(),
    spanAttributes: attributes,
  };
});

vi.mock("server-only", () => ({}));

// The problem mapper reaches the KV limiter through `with-rate-limit`; stubbing it keeps the
// Worker-only `cloudflare:workers` import out of a plain unit run.
vi.mock("@/utils/get-IP", () => ({ getIP: vi.fn() }));

vi.mock("@/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
}));

vi.mock("@/api/middleware/rate-limit", () => ({ enforceAnonRateLimit: enforceAnonRateLimitMock }));

vi.mock("@/lib/oauth/bearer-props", () => ({
  principalFromBearerProps: principalFromBearerPropsMock,
}));

vi.mock("@/utils/kv-api-key", () => ({ getApiKeyPrincipal: getApiKeyPrincipalMock }));

vi.mock("@/utils/trace", () => ({
  withSpan: ({ run }: { run: (span: typeof fakeSpan) => Promise<unknown> }) => run(fakeSpan),
  recordSpanException: vi.fn(),
}));

const { apiAuth } = await import("@/api/middleware/auth");
const { getBearerPrincipal, runWithPrincipal } = await import("@/lib/api/principal");

const AUTH_OUTCOME_ATTRIBUTE = "app.api.auth.outcome";
const PRINCIPAL = {
  kind: "api-key",
  keyId: "akey_1",
  userId: "user_1",
  scopes: [],
} as unknown as ApiPrincipal;

describe("auth span outcome", () => {
  beforeEach(() => {
    spanAttributes.clear();
    vi.clearAllMocks();
    principalFromBearerPropsMock.mockResolvedValue(null);
    getApiKeyPrincipalMock.mockResolvedValue(null);
  });

  test("tags a request without a bearer header as missing", async () => {
    const { status } = await call({});

    expect(status).toBe(401);
    expect(spanAttributes.get(AUTH_OUTCOME_ATTRIBUTE)).toBe("missing");
  });

  test("tags a token that fails the format check as malformed", async () => {
    const { status } = await call({ token: "not-an-api-key" });

    expect(status).toBe(401);
    expect(getApiKeyPrincipalMock).not.toHaveBeenCalled();
    expect(spanAttributes.get(AUTH_OUTCOME_ATTRIBUTE)).toBe("malformed");
  });

  test("tags a well-formed key that resolves to nothing as invalid", async () => {
    const { secret } = await generateApiKey({ prefix: API_KEY_PREFIX_LIVE });

    const { status } = await call({ token: secret });

    expect(status).toBe(401);
    expect(spanAttributes.get(AUTH_OUTCOME_ATTRIBUTE)).toBe("invalid");
  });

  test("tags a key from the header and publishes its principal", async () => {
    const { secret } = await generateApiKey({ prefix: API_KEY_PREFIX_LIVE });
    getApiKeyPrincipalMock.mockResolvedValue(PRINCIPAL);

    const { status, body } = await call({ token: secret });

    expect(status).toBe(200);
    expect(body).toEqual({ published: true });
    expect(spanAttributes.get(AUTH_OUTCOME_ATTRIBUTE)).toBe("header");
  });

  test("tags a principal from provider props", async () => {
    principalFromBearerPropsMock.mockResolvedValue(PRINCIPAL);

    const { status, body } = await call({});

    expect(status).toBe(200);
    expect(body).toEqual({ published: true });
    expect(spanAttributes.get(AUTH_OUTCOME_ATTRIBUTE)).toBe("props");
  });

  test("tags a principal inherited from in-process dispatch", async () => {
    const { status, body } = await runWithPrincipal(PRINCIPAL, () => call({}));

    expect(status).toBe(200);
    expect(body).toEqual({ published: true });
    expect(principalFromBearerPropsMock).not.toHaveBeenCalled();
    expect(spanAttributes.get(AUTH_OUTCOME_ATTRIBUTE)).toBe("inherited");
  });
});

async function call({ token }: { token?: string }) {
  const app = new Hono<ApiEnv>();
  app.use("*", apiAuth);
  // The handler must see the same principal in the context and in the ALS the services read.
  app.get("/", (c) => c.json({ published: getBearerPrincipal() === c.get("principal") }));

  const request = new Request("http://localhost/", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const ctx = { props: {}, waitUntil: () => undefined, passThroughOnException: () => undefined };
  const response = await app.fetch(request, {}, ctx);
  const body: Record<string, unknown> = await response.json();

  return { status: response.status, body };
}
