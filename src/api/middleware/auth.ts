import "server-only";

import type { Context, MiddlewareHandler } from "hono";

import { enforceAnonRateLimit } from "@/api/middleware/rate-limit";
import type { ApiEnv } from "@/api/types";
import { OAUTH_PROTECTED_RESOURCE_PATH } from "@/constants";
import { ActionError } from "@/lib/action-error";
import { actionErrorToProblem, toProblemResponse } from "@/lib/api/errors";
import { getBearerPrincipal, runWithPrincipal } from "@/lib/api/principal";
import { rateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { principalFromBearerProps } from "@/lib/oauth/bearer-props";
import { looksLikeApiKey } from "@/utils/api-key-format";
import { getApiKeyPrincipal } from "@/utils/kv-api-key";
import type { RateLimitSnapshot } from "@/utils/with-rate-limit";

const BEARER_SCHEME = "Bearer ";
const MISSING_CREDENTIAL_DETAIL = "A bearer credential is required.";
const INVALID_CREDENTIAL_DETAIL = "The bearer credential is not valid.";

function readBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith(BEARER_SCHEME)) {
    return null;
  }

  return header.slice(BEARER_SCHEME.length).trim() || null;
}

function unauthorized({
  c,
  detail,
  tokenPresented,
  quota,
}: {
  c: Context<ApiEnv>;
  detail: string;
  tokenPresented: boolean;
  /** The anonymous bucket this attempt was charged against, so a client can see it draining. */
  quota: RateLimitSnapshot | null;
}): Response {
  const problem = actionErrorToProblem({
    error: new ActionError("NOT_AUTHORIZED", detail),
    request: c.req.raw,
  });

  if (quota) {
    Object.assign(problem.headers, rateLimitHeaders(quota));
  }

  // RFC 9728: the path-suffixed resource metadata URL is how an MCP or OAuth client discovers
  // the authorization server straight from a 401 and starts the connect dance unattended.
  const url = new URL(c.req.url);
  const resourceMetadata = `${url.origin}${OAUTH_PROTECTED_RESOURCE_PATH}${url.pathname}`;

  problem.headers["www-authenticate"] = tokenPresented
    ? `Bearer error="invalid_token", error_description="${INVALID_CREDENTIAL_DETAIL}", resource_metadata="${resourceMetadata}"`
    : `Bearer resource_metadata="${resourceMetadata}"`;

  return toProblemResponse(problem);
}

// The only door into the API. Everything downstream runs inside `runWithPrincipal`, which is what
// makes the existing `src/lib/**` service layer (requireVerifiedEmail, requireTeamPermission)
// authorize bearer callers without a single per-function change.
export const apiAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  // In-process dispatch (an MCP tool call) already established the principal before building the
  // request, so it is reused rather than resolved a second time from a credential we do not carry.
  const inherited = getBearerPrincipal();

  if (inherited) {
    c.set("principal", inherited);
    return next();
  }

  // In production the OAuth provider has already validated the credential and put its props on
  // `ctx`, and rejects a failed one before this middleware runs. The header path below only serves
  // direct in-process dispatch (tests, MCP) — which is why it charges the anon bucket itself.
  const fromProps = await principalFromBearerProps(c.executionCtx?.props);

  if (fromProps) {
    c.set("principal", fromProps);
    return runWithPrincipal(fromProps, () => next());
  }

  const token = readBearerToken(c.req.header("authorization"));

  if (!token) {
    const quota = await enforceAnonRateLimit(c);
    return unauthorized({ c, detail: MISSING_CREDENTIAL_DETAIL, tokenPresented: false, quota });
  }

  // Cheap prefix + checksum sniff: a garbage token never reaches D1 or KV.
  if (!looksLikeApiKey(token)) {
    const quota = await enforceAnonRateLimit(c);
    return unauthorized({ c, detail: INVALID_CREDENTIAL_DETAIL, tokenPresented: true, quota });
  }

  const principal = await getApiKeyPrincipal(token);

  if (!principal) {
    const quota = await enforceAnonRateLimit(c);
    return unauthorized({ c, detail: INVALID_CREDENTIAL_DETAIL, tokenPresented: true, quota });
  }

  c.set("principal", principal);

  return runWithPrincipal(principal, () => next());
};
