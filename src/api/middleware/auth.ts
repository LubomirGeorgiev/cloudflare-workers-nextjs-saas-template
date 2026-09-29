import "server-only";

import type { Context, MiddlewareHandler } from "hono";

import { enforceAnonRateLimit } from "@/api/middleware/rate-limit";
import type { ApiEnv } from "@/api/types";
import { OAUTH_PROTECTED_RESOURCE_PATH } from "@/constants";
import { ActionError } from "@/lib/action-error";
import { actionErrorToProblem, toProblemResponse } from "@/lib/api/errors";
import { getBearerPrincipal, runWithPrincipal, type ApiPrincipal } from "@/lib/api/principal";
import { rateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { principalFromBearerProps } from "@/lib/oauth/bearer-props";
import { looksLikeApiKey } from "@/utils/api-key-format";
import { getApiKeyPrincipal } from "@/utils/kv-api-key";
import { withSpan } from "@/utils/trace";
import type { RateLimitSnapshot } from "@/utils/with-rate-limit";

const AUTH_SPAN_NAME = "app.api.auth";
const AUTH_OUTCOME_ATTRIBUTE = "app.api.auth.outcome";
// Which door admitted the caller, or why none did.
const AUTH_OUTCOMES = {
  INHERITED: "inherited",
  PROPS: "props",
  HEADER: "header",
  MISSING: "missing",
  MALFORMED: "malformed",
  INVALID: "invalid",
} as const;

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
  // The span ends before `next()`, so it times the credential check and not the operation.
  const result = await withSpan({
    name: AUTH_SPAN_NAME,
    run: async (span) => {
      const resolved = await resolveApiAuth(c);
      span.setAttribute(AUTH_OUTCOME_ATTRIBUTE, resolved.outcome);

      return resolved;
    },
  });

  if ("response" in result) {
    return result.response;
  }

  c.set("principal", result.principal);

  // An inherited principal is already in scope; the other doors publish theirs here.
  return result.outcome === AUTH_OUTCOMES.INHERITED
    ? next()
    : runWithPrincipal(result.principal, () => next());
};

async function resolveApiAuth(c: Context<ApiEnv>): Promise<ApiAuthResult> {
  // In-process dispatch (an MCP tool call) already established the principal before building the
  // request, so it is reused rather than resolved a second time from a credential we do not carry.
  const inherited = getBearerPrincipal();

  if (inherited) {
    return { outcome: AUTH_OUTCOMES.INHERITED, principal: inherited };
  }

  // In production the OAuth provider has already validated the credential and put its props on
  // `ctx`, and rejects a failed one before this middleware runs. The header path below only serves
  // direct in-process dispatch (tests, MCP) — which is why it charges the anon bucket itself.
  const fromProps = await principalFromBearerProps(c.executionCtx?.props);

  if (fromProps) {
    return { outcome: AUTH_OUTCOMES.PROPS, principal: fromProps };
  }

  const token = readBearerToken(c.req.header("authorization"));

  if (!token) {
    const quota = await enforceAnonRateLimit(c);
    return {
      outcome: AUTH_OUTCOMES.MISSING,
      response: unauthorized({
        c,
        detail: MISSING_CREDENTIAL_DETAIL,
        tokenPresented: false,
        quota,
      }),
    };
  }

  // Cheap prefix + checksum sniff: a garbage token never reaches D1 or KV.
  if (!looksLikeApiKey(token)) {
    const quota = await enforceAnonRateLimit(c);
    return {
      outcome: AUTH_OUTCOMES.MALFORMED,
      response: unauthorized({ c, detail: INVALID_CREDENTIAL_DETAIL, tokenPresented: true, quota }),
    };
  }

  const principal = await getApiKeyPrincipal(token);

  if (!principal) {
    const quota = await enforceAnonRateLimit(c);
    return {
      outcome: AUTH_OUTCOMES.INVALID,
      response: unauthorized({ c, detail: INVALID_CREDENTIAL_DETAIL, tokenPresented: true, quota }),
    };
  }

  return { outcome: AUTH_OUTCOMES.HEADER, principal };
}

// Keyed on `outcome`, so only an admitting door can carry a principal, and only a refusal a response.
type ApiAuthResult =
  | { outcome: typeof AUTH_OUTCOMES.INHERITED; principal: ApiPrincipal }
  | { outcome: typeof AUTH_OUTCOMES.PROPS | typeof AUTH_OUTCOMES.HEADER; principal: ApiPrincipal }
  | {
      outcome: typeof AUTH_OUTCOMES.MISSING | typeof AUTH_OUTCOMES.MALFORMED | typeof AUTH_OUTCOMES.INVALID;
      response: Response;
    };
