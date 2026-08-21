/// <reference types="@cloudflare/vitest-plugin/types" />

// The anonymous throttle for the public API, driven through the real Worker entrypoint against the
// real KV limiter. `@cloudflare/workers-oauth-provider` answers a bad or missing bearer itself and
// never calls the wrapped handler, so the Hono middleware inside `src/api` never sees a production
// authentication failure — only the entrypoint does. These tests exist to keep it that way.
//
// `withRateLimit` no-ops unless `isProd` and outside test mode, and the integration environment is
// both non-prod and `APP_TEST_MODE: "true"`. Both switches are mocked off here so the limiter, the
// KV counter, and the 429 are all real; nothing else about the limiter is stubbed.
//
// Assertions derive from the app's own constants so a fork that retunes the bucket or moves the
// API/MCP paths keeps them valid.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, expect, test, vi } from "vitest";

import { API_V1_BASE_PATH, MCP_PATH } from "@/constants";
import { getDB } from "@/db";
import { apiKeyTable, userTable } from "@/db/schema";
import { PROBLEM_JSON_CONTENT_TYPE, PROBLEM_BY_CODE } from "@/lib/api/errors";
import { generateApiKey } from "@/utils/api-key-format";
import { RATE_LIMITS } from "@/utils/with-rate-limit";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

vi.mock("@/utils/is-prod", () => ({ default: true }));

vi.mock("@/utils/is-test-mode", () => ({ isTestMode: () => false }));

const { default: worker } = await import("../../worker-entrypoint");

const ORIGIN = "https://example.com";
const ME_PATH = `${API_V1_BASE_PATH}/me`;
const INVALID_BEARER = "Bearer not-a-credential";
// A KV window can roll over mid-test and refund the counter, so the drain helper is given room to
// refill the bucket rather than asserting the 429 lands on an exact request number.
const MAX_DRAIN_ATTEMPTS = RATE_LIMITS.API_ANON.limit * 2 + 1;

const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

// Each test gets its own client IP: the bucket is keyed by IP, and the tests share one KV namespace.
function uniqueClientIp(): string {
  seq += 1;
  return `203.0.113.${seq % 250 + 1}`;
}

function callWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env as Env, createExecutionContext());
}

beforeEach(() => {
  innerFetchMock.mockReset();
  innerFetchMock.mockImplementation(async () => new Response("next-app"));
});

// `cf-connecting-ip` is the only client IP the entrypoint trusts; it forwards it as the internal
// trusted header, which is what the limiter keys on.
async function callAnonymously({
  path,
  clientIp,
  authorization,
}: {
  path: string;
  clientIp: string;
  authorization?: string;
}): Promise<Response> {
  return callWorker(path, {
    headers: {
      "cf-connecting-ip": clientIp,
      ...(authorization ? { authorization } : {}),
    },
  });
}

async function drainAnonBucket({
  path,
  clientIp,
  authorization,
}: {
  path: string;
  clientIp: string;
  authorization?: string;
}): Promise<Response> {
  for (let attempt = 0; attempt < MAX_DRAIN_ATTEMPTS; attempt += 1) {
    const response = await callAnonymously({ path, clientIp, authorization });

    if (response.status !== 401) {
      return response;
    }
  }

  throw new Error(`The anonymous bucket was never exhausted in ${MAX_DRAIN_ATTEMPTS} requests.`);
}

// draft-polli-ratelimit-headers-02, read off whichever bucket the request was charged against.
// The expectations derive from the bucket's own configuration, so retuning it keeps them valid.
function expectQuotaHeaders(
  response: Response,
  bucket: { limit: number; windowInSeconds: number },
): void {
  expect(response.headers.get("ratelimit-limit"))
    .toBe(`${bucket.limit}, ${bucket.limit};w=${bucket.windowInSeconds}`);

  const remaining = Number(response.headers.get("ratelimit-remaining"));
  expect(remaining).toBeGreaterThanOrEqual(0);
  expect(remaining).toBeLessThan(bucket.limit);

  const reset = Number(response.headers.get("ratelimit-reset"));
  expect(reset).toBeGreaterThan(0);
  expect(reset).toBeLessThanOrEqual(bucket.windowInSeconds);
}

async function expectRateLimitedProblem(response: Response): Promise<void> {
  expect(response.status).toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(response.headers.get("content-type")).toContain(PROBLEM_JSON_CONTENT_TYPE);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);

  // The 429 describes the bucket that refused it, exhausted.
  expectQuotaHeaders(response, RATE_LIMITS.API_ANON);
  expect(response.headers.get("ratelimit-remaining")).toBe("0");

  const body = await response.json() as { code: string; status: number; retryAfter: number };
  expect(body.code).toBe("RATE_LIMITED");
  expect(body.status).toBe(PROBLEM_BY_CODE.RATE_LIMITED.status);
  expect(body.retryAfter).toBeGreaterThan(0);
}

async function seedApiKey(): Promise<{ userId: string; email: string; secret: string }> {
  const userId = uid("usr");
  const email = `${userId}@example.com`;

  await db.insert(userTable).values({
    id: userId,
    email,
    firstName: "Throttled",
    lastName: "Caller",
    emailVerified: new Date(),
  });

  const generated = await generateApiKey();
  await db.insert(apiKeyTable).values({
    id: uid("akey"),
    userId,
    name: "throttling",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes: ["profile:read"],
  });

  return { userId, email, secret: generated.secret };
}

test("repeated invalid bearer tokens through the worker exhaust the anonymous bucket", async () => {
  const clientIp = uniqueClientIp();

  const first = await callAnonymously({ path: ME_PATH, clientIp, authorization: INVALID_BEARER });
  expect(first.status).toBe(401);
  // The provider's own rejection, annotated with the bucket the attempt was charged against.
  expectQuotaHeaders(first, RATE_LIMITS.API_ANON);

  await expectRateLimitedProblem(
    await drainAnonBucket({ path: ME_PATH, clientIp, authorization: INVALID_BEARER }),
  );

  // The provider rejects before the Hono app, and the API is never served by the Next app.
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("a request with no authorization header is charged too", async () => {
  const clientIp = uniqueClientIp();

  const first = await callAnonymously({ path: ME_PATH, clientIp });
  expect(first.status).toBe(401);

  await expectRateLimitedProblem(await drainAnonBucket({ path: ME_PATH, clientIp }));
});

test("the MCP endpoint is charged on the same bucket", async () => {
  const clientIp = uniqueClientIp();

  const first = await callAnonymously({ path: MCP_PATH, clientIp, authorization: INVALID_BEARER });
  expect(first.status).toBe(401);

  await expectRateLimitedProblem(
    await drainAnonBucket({ path: MCP_PATH, clientIp, authorization: INVALID_BEARER }),
  );
});

test("a valid credential is not charged against the anonymous bucket", async () => {
  const clientIp = uniqueClientIp();
  const { userId, email, secret } = await seedApiKey();

  await expectRateLimitedProblem(
    await drainAnonBucket({ path: ME_PATH, clientIp, authorization: INVALID_BEARER }),
  );

  // Same IP, exhausted anon bucket: a request that authenticates never touches it.
  const response = await callAnonymously({
    path: ME_PATH,
    clientIp,
    authorization: `Bearer ${secret}`,
  });

  expect(response.status).toBe(200);
  // A successful request states the per-credential bucket, not the anonymous one it never touched.
  expectQuotaHeaders(response, RATE_LIMITS.API_AUTHED);
  expect(await response.json()).toMatchObject({ id: userId, email });
});

test("a 401 outside the API and MCP paths does not consume the bucket", async () => {
  const clientIp = uniqueClientIp();
  innerFetchMock.mockImplementation(async () => new Response("nope", { status: 401 }));

  for (let attempt = 0; attempt < MAX_DRAIN_ATTEMPTS; attempt += 1) {
    const response = await callAnonymously({ path: "/some-page", clientIp });
    expect(response.status).toBe(401);
  }

  // The bucket is untouched, so the first API failure from this IP is still an ordinary 401.
  const apiResponse = await callAnonymously({
    path: ME_PATH,
    clientIp,
    authorization: INVALID_BEARER,
  });
  expect(apiResponse.status).toBe(401);
});
