/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";

import { OAUTH_REGISTER_PATH } from "@/constants";
import { getDB } from "@/db";
import { oauthAppTable } from "@/db/schema";
import { PROBLEM_JSON_CONTENT_TYPE, PROBLEM_BY_CODE } from "@/lib/api/errors";
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

const CLIENT_IP = "203.0.113.71";
const REGISTER_URL = `https://example.com${OAUTH_REGISTER_PATH}`;

function registrationRequest(): Request {
  return new Request(REGISTER_URL, {
    method: "POST",
    headers: {
      "cf-connecting-ip": CLIENT_IP,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_name: "Rate Limited Agent",
      redirect_uris: ["https://agent.example/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
}

async function callRegistration(): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(registrationRequest(), env as Env, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

async function countMirroredApps(): Promise<number> {
  const [result] = await getDB()
    .select({ count: sql<number>`count(*)` })
    .from(oauthAppTable);

  return result.count;
}

beforeEach(() => {
  vi.clearAllMocks();
  innerFetchMock.mockResolvedValue(new Response("next-app"));
  checkRateLimitMock.mockResolvedValue({
    success: true,
    remaining: RATE_LIMITS.OAUTH_DCR.limit - 1,
    reset: Math.floor(Date.now() / 1000) + RATE_LIMITS.OAUTH_DCR.windowInSeconds,
    limit: RATE_LIMITS.OAUTH_DCR.limit,
  });
});

test("charges DCR registrations against a dedicated trusted-IP bucket", async () => {
  const response = await callRegistration();

  expect(response.status).toBe(201);
  expect(checkRateLimitMock).toHaveBeenCalledWith({
    key: CLIENT_IP,
    options: {
      identifier: RATE_LIMITS.OAUTH_DCR.identifier,
      limit: RATE_LIMITS.OAUTH_DCR.limit,
      windowInSeconds: RATE_LIMITS.OAUTH_DCR.windowInSeconds,
      deferWrite: undefined,
    },
  });
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("rejects an exhausted DCR bucket before the provider allocates a client", async () => {
  const clientsBefore = await env.OAUTH_KV.list({ prefix: "client:" });
  const mirroredAppsBefore = await countMirroredApps();
  checkRateLimitMock.mockResolvedValue({
    success: false,
    remaining: 0,
    reset: Math.floor(Date.now() / 1000) + RATE_LIMITS.OAUTH_DCR.windowInSeconds,
    limit: RATE_LIMITS.OAUTH_DCR.limit,
  });

  const response = await callRegistration();

  expect(response.status).toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(response.headers.get("content-type")).toContain(PROBLEM_JSON_CONTENT_TYPE);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  await expect(response.json()).resolves.toMatchObject({
    code: "RATE_LIMITED",
    status: PROBLEM_BY_CODE.RATE_LIMITED.status,
  });

  const clientsAfter = await env.OAUTH_KV.list({ prefix: "client:" });
  expect(clientsAfter.keys.map(({ name }) => name).sort()).toEqual(
    clientsBefore.keys.map(({ name }) => name).sort(),
  );
  await expect(countMirroredApps()).resolves.toBe(mirroredAppsBefore);
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("fails open when the DCR limiter infrastructure is unavailable", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  checkRateLimitMock.mockRejectedValue(new Error("KV unavailable"));

  const response = await callRegistration();

  expect(response.status).toBe(201);
  expect(consoleError).toHaveBeenCalledWith(
    "OAuth DCR rate limiting failed",
    expect.objectContaining({ message: "KV unavailable" }),
  );

  consoleError.mockRestore();
});
