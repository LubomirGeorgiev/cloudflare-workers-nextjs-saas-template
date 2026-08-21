/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, expect, test, vi } from "vitest";

import { OAUTH_TOKEN_PATH } from "@/constants";
import { PROBLEM_JSON_CONTENT_TYPE, PROBLEM_BY_CODE } from "@/lib/api/errors";
import { inspectOAuthTokenRateLimitIdentity } from "@/lib/oauth/token-rate-limit";
import { RATE_LIMITS } from "@/utils/with-rate-limit";

const { checkRateLimitMock, innerFetchMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  innerFetchMock: vi.fn(),
}));

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

vi.mock("@/utils/is-prod", () => ({ default: true }));
vi.mock("@/utils/is-test-mode", () => ({ isTestMode: () => false }));

vi.mock("@/utils/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils/rate-limit")>();

  return { ...original, checkRateLimit: checkRateLimitMock };
});

const { default: worker } = await import("../../worker-entrypoint");

const CLIENT_IP = "203.0.113.72";
const CLIENT_ID = "public-client-id";
const GRANT_IDENTITY = "user-123:grant-456";
const REFRESH_TOKEN = `${GRANT_IDENTITY}:secret-refresh-token-that-must-not-enter-the-limiter`;
const TOKEN_URL = `https://example.com${OAUTH_TOKEN_PATH}`;

function tokenRequest(body?: URLSearchParams): Request {
  return new Request(TOKEN_URL, {
    method: "POST",
    headers: {
      "cf-connecting-ip": CLIENT_IP,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body ?? new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: REFRESH_TOKEN,
    }),
  });
}

function callTokenEndpoint(): Promise<Response> {
  return worker.fetch(tokenRequest(), env as Env, createExecutionContext());
}

beforeEach(() => {
  vi.clearAllMocks();
  innerFetchMock.mockResolvedValue(new Response("next-app"));
  checkRateLimitMock.mockResolvedValue({
    success: true,
    remaining: RATE_LIMITS.OAUTH_TOKEN_IP.limit - 1,
    reset: Math.floor(Date.now() / 1000) + RATE_LIMITS.OAUTH_TOKEN_IP.windowInSeconds,
    limit: RATE_LIMITS.OAUTH_TOKEN_IP.limit,
  });
});

test("charges separate trusted-IP and hashed grant-identity buckets", async () => {
  const { fingerprint } = await inspectOAuthTokenRateLimitIdentity(tokenRequest());
  const response = await callTokenEndpoint();

  expect(response.status).not.toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(checkRateLimitMock.mock.calls).toEqual([
    [{
      key: CLIENT_IP,
      options: {
        identifier: RATE_LIMITS.OAUTH_TOKEN_IP.identifier,
        limit: RATE_LIMITS.OAUTH_TOKEN_IP.limit,
        windowInSeconds: RATE_LIMITS.OAUTH_TOKEN_IP.windowInSeconds,
        deferWrite: undefined,
      },
    }],
    [{
      key: fingerprint,
      options: {
        identifier: RATE_LIMITS.OAUTH_TOKEN_IDENTITY.identifier,
        limit: RATE_LIMITS.OAUTH_TOKEN_IDENTITY.limit,
        windowInSeconds: RATE_LIMITS.OAUTH_TOKEN_IDENTITY.windowInSeconds,
        deferWrite: undefined,
      },
    }],
  ]);
  const limiterCalls = JSON.stringify(checkRateLimitMock.mock.calls);
  expect(limiterCalls).not.toContain(CLIENT_ID);
  expect(limiterCalls).not.toContain(GRANT_IDENTITY);
  expect(limiterCalls).not.toContain(REFRESH_TOKEN);
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("leaves RFC 7009 revocation requests available without charging issuance buckets", async () => {
  const response = await worker.fetch(
    tokenRequest(new URLSearchParams({
      token: REFRESH_TOKEN,
      token_type_hint: "refresh_token",
      client_id: CLIENT_ID,
    })),
    env as Env,
    createExecutionContext(),
  );

  expect(response.status).not.toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(checkRateLimitMock).not.toHaveBeenCalled();
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("does not mistake a token parameter alongside grant_type for revocation", async () => {
  await worker.fetch(
    tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
    })),
    env as Env,
    createExecutionContext(),
  );

  expect(checkRateLimitMock).toHaveBeenCalledTimes(2);
});

test("rejects an exhausted identity bucket before the provider creates a token", async () => {
  const tokensBefore = await env.OAUTH_KV.list({ prefix: "token:" });
  checkRateLimitMock
    .mockResolvedValueOnce({
      success: true,
      remaining: RATE_LIMITS.OAUTH_TOKEN_IP.limit - 1,
      reset: Math.floor(Date.now() / 1000) + RATE_LIMITS.OAUTH_TOKEN_IP.windowInSeconds,
      limit: RATE_LIMITS.OAUTH_TOKEN_IP.limit,
    })
    .mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Math.floor(Date.now() / 1000) + RATE_LIMITS.OAUTH_TOKEN_IDENTITY.windowInSeconds,
      limit: RATE_LIMITS.OAUTH_TOKEN_IDENTITY.limit,
    });

  const response = await callTokenEndpoint();

  expect(response.status).toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(response.headers.get("content-type")).toContain(PROBLEM_JSON_CONTENT_TYPE);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  await expect(response.json()).resolves.toMatchObject({
    code: "RATE_LIMITED",
    status: PROBLEM_BY_CODE.RATE_LIMITED.status,
  });

  const tokensAfter = await env.OAUTH_KV.list({ prefix: "token:" });
  expect(tokensAfter.keys.map(({ name }) => name).sort()).toEqual(
    tokensBefore.keys.map(({ name }) => name).sort(),
  );
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("rejects an exhausted IP bucket before inspecting the identity bucket", async () => {
  checkRateLimitMock.mockResolvedValue({
    success: false,
    remaining: 0,
    reset: Math.floor(Date.now() / 1000) + RATE_LIMITS.OAUTH_TOKEN_IP.windowInSeconds,
    limit: RATE_LIMITS.OAUTH_TOKEN_IP.limit,
  });

  const response = await callTokenEndpoint();

  expect(response.status).toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(checkRateLimitMock).toHaveBeenCalledOnce();
  expect(checkRateLimitMock).toHaveBeenCalledWith({
    key: CLIENT_IP,
    options: {
      identifier: RATE_LIMITS.OAUTH_TOKEN_IP.identifier,
      limit: RATE_LIMITS.OAUTH_TOKEN_IP.limit,
      windowInSeconds: RATE_LIMITS.OAUTH_TOKEN_IP.windowInSeconds,
      deferWrite: undefined,
    },
  });
});

test("fails open when the token limiter infrastructure is unavailable", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  checkRateLimitMock.mockRejectedValue(new Error("KV unavailable"));

  const response = await callTokenEndpoint();

  expect(response.status).not.toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(consoleError).toHaveBeenCalledWith(
    "OAuth token rate limiting failed",
    expect.objectContaining({ message: "KV unavailable" }),
  );

  consoleError.mockRestore();
});
