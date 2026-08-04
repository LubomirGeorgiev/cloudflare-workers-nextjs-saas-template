import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ApiEnv } from "@/api/types";
import type { ApiPrincipal } from "@/lib/api/principal";
import { __INTERNAL_TRUSTED_CLIENT_IP_HEADER } from "@/utils/trusted-client-ip";

const { checkRateLimitMock } = vi.hoisted(() => ({ checkRateLimitMock: vi.fn() }));

vi.mock("server-only", () => ({}));

// The middleware only throttles in production; the KV limiter itself is mocked so the assertions
// are about keying and the 429 contract, not about KV.
vi.mock("@/utils/is-prod", () => ({ default: true }));

vi.mock("@/utils/is-test-mode", () => ({ isTestMode: () => false }));

vi.mock("@/utils/get-IP", () => ({ getIP: vi.fn() }));

vi.mock("@/utils/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  resetRateLimit: vi.fn(),
}));

const { ActionError } = await import("@/lib/action-error");
const { PROBLEM_JSON_CONTENT_TYPE } = await import("@/lib/api/errors");
const { problemJsonErrorHandler } = await import("@/api/middleware/problem-json");
const { authedRateLimit, chargeAnonRateLimit, enforceAnonRateLimit } = await import("@/api/middleware/rate-limit");
const { RATE_LIMITS } = await import("@/utils/with-rate-limit");

const CLIENT_IP = "203.0.113.10";

// Only the fields the limiter keys on: the middleware never touches identity or permissions.
function principal(overrides: Record<string, unknown>): ApiPrincipal {
  return {
    kind: "api-key",
    userId: "user_1",
    scopes: [],
    keyId: "akey_1",
    user: {},
    teams: [],
    audience: { type: "personal" },
    ...overrides,
  } as unknown as ApiPrincipal;
}

function allow(limit: number) {
  checkRateLimitMock.mockResolvedValue({
    success: true,
    remaining: limit - 1,
    reset: Math.floor(Date.now() / 1000) + 60,
    limit,
  });
}

function createApp(caller: ApiPrincipal | null) {
  const app = new Hono<ApiEnv>();
  app.onError(problemJsonErrorHandler);

  app.use("*", async (c, next) => {
    if (!caller) {
      await enforceAnonRateLimit(c);
      return c.text("unauthorized", 401);
    }

    c.set("principal", caller);
    return next();
  });
  app.use("*", authedRateLimit);
  app.get("/ping", (c) => c.text("ok"));
  // Stands in for any handler that throws: the response is built by `onError`, past this middleware.
  app.get("/boom", () => {
    throw new ActionError("NOT_FOUND", "gone");
  });

  return app;
}

async function call({
  caller,
  headers,
  path = "/ping",
}: {
  caller: ApiPrincipal | null;
  headers?: Record<string, string>;
  path?: string;
}) {
  return createApp(caller).request(path, { headers });
}

// draft-polli-ratelimit-headers-02, as the three fields a client reads off any response.
function readQuotaHeaders(response: Response) {
  return {
    limit: response.headers.get("ratelimit-limit"),
    remaining: response.headers.get("ratelimit-remaining"),
    reset: Number(response.headers.get("ratelimit-reset")),
  };
}

describe("API rate limit middleware", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("charges the anon bucket against the trusted client IP", async () => {
    allow(RATE_LIMITS.API_ANON.limit);

    const response = await call({
      caller: null,
      headers: { [__INTERNAL_TRUSTED_CLIENT_IP_HEADER]: CLIENT_IP },
    });

    expect(response.status).toBe(401);
    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: CLIENT_IP,
      options: {
        identifier: RATE_LIMITS.API_ANON.identifier,
        limit: RATE_LIMITS.API_ANON.limit,
        windowInSeconds: RATE_LIMITS.API_ANON.windowInSeconds,
        deferWrite: undefined,
      },
    });
  });

  // The worker entrypoint charges this bucket without a Hono context, since the OAuth provider
  // rejects a bad credential before the middleware above ever runs.
  test("charges the same bucket when called without a request context", async () => {
    allow(RATE_LIMITS.API_ANON.limit);

    await chargeAnonRateLimit({ clientIp: CLIENT_IP });

    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: CLIENT_IP,
      options: {
        identifier: RATE_LIMITS.API_ANON.identifier,
        limit: RATE_LIMITS.API_ANON.limit,
        windowInSeconds: RATE_LIMITS.API_ANON.windowInSeconds,
        deferWrite: undefined,
      },
    });
  });

  test("falls back to a shared key when no client IP is known", async () => {
    allow(RATE_LIMITS.API_ANON.limit);

    await chargeAnonRateLimit({ clientIp: null });

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "unknown-ip" }),
    );
  });

  test("falls back to a shared key when no trusted client IP is forwarded", async () => {
    allow(RATE_LIMITS.API_ANON.limit);

    await call({ caller: null });

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "unknown-ip" }),
    );
  });

  test("charges the authed bucket against the credential, not the user", async () => {
    allow(RATE_LIMITS.API_AUTHED.limit);

    const response = await call({ caller: principal({ keyId: "key_1" }) });

    expect(response.status).toBe(200);
    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: "key_1",
      options: {
        identifier: RATE_LIMITS.API_AUTHED.identifier,
        limit: RATE_LIMITS.API_AUTHED.limit,
        windowInSeconds: RATE_LIMITS.API_AUTHED.windowInSeconds,
        // Asserted true rather than read from the constant: the counter write staying off the
        // happy path is the policy, not a budget a fork is expected to retune.
        deferWrite: true,
      },
    });
  });

  test("keys an OAuth grant by its grant id, falling back to the user when it has none", async () => {
    allow(RATE_LIMITS.API_AUTHED.limit);

    await call({
      caller: principal({ kind: "oauth-grant", clientId: "client_1", grantId: "grant_1" }),
    });
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "grant_1" }),
    );

    // A token the exchange callback never stamped has no per-grant identity to key on.
    await call({ caller: principal({ kind: "oauth-grant", clientId: "client_1" }) });
    expect(checkRateLimitMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "user_1" }),
    );
  });

  test("answers an exhausted bucket with a problem+json 429 and retry-after", async () => {
    const reset = Math.floor(Date.now() / 1000) + 42;
    checkRateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      reset,
      limit: RATE_LIMITS.API_AUTHED.limit,
    });

    const response = await call({ caller: principal({ keyId: "key_1" }) });

    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain(PROBLEM_JSON_CONTENT_TYPE);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);

    const body = await response.json() as { code: string; retryAfter: number };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  test("states the charged bucket on a successful response", async () => {
    allow(RATE_LIMITS.API_AUTHED.limit);

    const response = await call({ caller: principal({ keyId: "key_1" }) });

    const quota = readQuotaHeaders(response);

    expect(response.status).toBe(200);
    // The quota policy the draft appends is what tells a client the window without being refused.
    expect(quota.limit).toBe(
      `${RATE_LIMITS.API_AUTHED.limit}, ${RATE_LIMITS.API_AUTHED.limit};w=${RATE_LIMITS.API_AUTHED.windowInSeconds}`,
    );
    expect(quota.remaining).toBe(String(RATE_LIMITS.API_AUTHED.limit - 1));
    expect(quota.reset).toBeGreaterThan(0);
  });

  // The handler unwinds past the middleware, so the quota has to be published by the error handler.
  test("states the charged bucket on a response built by the error handler", async () => {
    allow(RATE_LIMITS.API_AUTHED.limit);

    const response = await call({ caller: principal({ keyId: "key_1" }), path: "/boom" });

    expect(response.status).toBe(404);
    expect(readQuotaHeaders(response).remaining).toBe(
      String(RATE_LIMITS.API_AUTHED.limit - 1),
    );
  });

  test("states the exhausted bucket on the 429 itself", async () => {
    checkRateLimitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Math.floor(Date.now() / 1000) + 42,
      limit: RATE_LIMITS.API_AUTHED.limit,
    });

    const response = await call({ caller: principal({ keyId: "key_1" }) });

    expect(readQuotaHeaders(response)).toEqual({
      limit: `${RATE_LIMITS.API_AUTHED.limit}, ${RATE_LIMITS.API_AUTHED.limit};w=${RATE_LIMITS.API_AUTHED.windowInSeconds}`,
      remaining: "0",
      reset: Number(response.headers.get("retry-after")),
    });
  });
});
