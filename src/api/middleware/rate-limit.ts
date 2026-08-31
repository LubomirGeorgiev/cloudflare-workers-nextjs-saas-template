import "server-only";

import type { Context, MiddlewareHandler } from "hono";

import type { ApiEnv } from "@/api/types";
import { actionErrorToProblem, toProblemResponse } from "@/lib/api/errors";
import type { ApiPrincipal } from "@/lib/api/principal";
import { applyRateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { __INTERNAL_TRUSTED_CLIENT_IP_HEADER } from "@/utils/trusted-client-ip";
import {
  consumeRateLimit,
  RATE_LIMITS,
  RateLimitError,
  type RateLimitSnapshot,
} from "@/utils/with-rate-limit";

/** The buckets an unauthenticated edge caller can be charged against. */
export type ApiRateLimitName = keyof typeof RATE_LIMITS;

// The app's KV limiter (`rate-limit:` prefix on KV_STORE). Two buckets, because the two
// failure modes are different: a valid credential hammering the API, and an anonymous client
// spraying tokens at it. `consumeRateLimit` owns the prod/test-mode bypass and the 429 it throws.
const UNKNOWN_IP_KEY = "unknown-ip";

function getClientIpKey(c: Context<ApiEnv>): string | undefined {
  // Set by `withForwardedCfHeaders` in the entrypoint; the spoofable inbound headers are stripped
  // there, so this is the only client IP the API is allowed to trust.
  return c.req.header(__INTERNAL_TRUSTED_CLIENT_IP_HEADER);
}

// The one "charge a bucket, do no work" entry point, shared by this middleware and the Worker edge.
// Throws `RateLimitError` when exhausted; returns null where throttling is bypassed.
export async function chargeRateLimit({
  rateLimit,
  userIdentifier,
}: {
  rateLimit: ApiRateLimitName;
  userIdentifier: string;
}): Promise<RateLimitSnapshot | null> {
  return consumeRateLimit({ ...RATE_LIMITS[rateLimit], userIdentifier });
}

// Context-free on purpose: the OAuth provider answers a bad credential itself without ever calling
// the wrapped handler, so `worker-entrypoint.ts` charges this same bucket at the boundary.
export async function chargeAnonRateLimit({
  clientIp,
}: {
  clientIp: string | null | undefined;
}): Promise<RateLimitSnapshot | null> {
  return chargeRateLimit({
    rateLimit: "API_ANON",
    userIdentifier: clientIp || UNKNOWN_IP_KEY,
  });
}

/**
 * The soft-failure contract every edge limiter shares: only a confirmed exhausted bucket may
 * change the response. Rate limiting is defense in depth, so a KV or request-context failure logs
 * and returns null, leaving the caller's original answer intact rather than turning it into a 500.
 */
export function rateLimitProblemOrNull({
  error,
  request,
  failureLog,
}: {
  error: unknown;
  request: Request;
  failureLog: string;
}): Response | null {
  if (!(error instanceof RateLimitError)) {
    console.error(failureLog, error);
    return null;
  }

  // The same RFC 9457 mapper the Hono app uses, so an exhausted bucket looks identical whichever
  // side of the provider rejected the request.
  return toProblemResponse(actionErrorToProblem({ error, request }));
}

// Charged at the Worker boundary for API/MCP requests the provider rejects, and here for the
// direct in-process dispatch (tests, MCP) that never passes through the provider.
export async function enforceAnonRateLimit(
  c: Context<ApiEnv>
): Promise<RateLimitSnapshot | null> {
  return chargeAnonRateLimit({ clientIp: getClientIpKey(c) });
}

// Keyed by the credential, not the user: one leaked key cannot exhaust the owner's other keys.
// Exhaustive over the principal union, so a new credential kind cannot silently fall back to a
// user-wide bucket that a single compromised credential could drain.
function getCredentialRateLimitKey(principal: ApiPrincipal): string {
  switch (principal.kind) {
    case "api-key":
      return principal.keyId;
    case "oauth-grant":
      // A token the exchange callback never stamped has no per-grant identity to key on.
      return principal.grantId ?? principal.userId;
  }
}

export const authedRateLimit: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const quota = await consumeRateLimit({
    ...RATE_LIMITS.API_AUTHED,
    userIdentifier: getCredentialRateLimitKey(c.get("principal")),
  });

  // Also published on the context because a handler that throws never returns through this
  // middleware — the problem+json error handler answers that request and states the quota there.
  if (quota) {
    c.set("rateLimitQuota", quota);
  }

  await next();

  applyRateLimitHeaders({ headers: c.res.headers, quota });
};
