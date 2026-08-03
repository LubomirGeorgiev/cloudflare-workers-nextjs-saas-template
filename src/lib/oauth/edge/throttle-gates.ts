import "server-only";

import {
  chargeAnonRateLimit,
  chargeRateLimit,
  rateLimitProblemOrNull,
} from "@/api/middleware/rate-limit";
import { applyRateLimitHeaders } from "@/lib/api/rate-limit-headers";
import {
  ISSUANCE_FAILURE_LOG,
  resolveIssuanceThrottlePlan,
} from "@/lib/oauth/edge/issuance-throttle";
import { __INTERNAL_TRUSTED_CLIENT_IP_HEADER } from "@/utils/trusted-client-ip";

// The two throttles that sit either side of the OAuth provider. Both are lazily imported by the
// entrypoint, so only a request that actually reaches OAuth or the API pays for the KV limiter.

const UNKNOWN_IP = "unknown-ip";

/** Charged before the provider runs; a returned response replaces it entirely. */
// fallow-ignore-next-line unused-export -- Reached through a lazy `import()` in worker-entrypoint.ts.
export async function getIssuanceThrottleResponse({
  request,
  pathname,
}: {
  request: Request;
  pathname: string;
}): Promise<Response | null> {
  if (request.method !== "POST") {
    return null;
  }

  const plan = await resolveIssuanceThrottlePlan({
    pathname,
    request,
    clientIp: request.headers.get(__INTERNAL_TRUSTED_CLIENT_IP_HEADER) || UNKNOWN_IP,
  });

  if (!plan) {
    return null;
  }

  try {
    for (const policy of plan.policies) {
      await chargeRateLimit(policy);
    }

    return null;
  } catch (error) {
    return rateLimitProblemOrNull({
      error,
      request,
      failureLog: ISSUANCE_FAILURE_LOG[plan.endpoint],
    });
  }
}

// The provider answers a bad or missing credential itself, without ever calling the wrapped
// handler, so this is the only place that sees an API/MCP authentication failure. Charging the
// anonymous bucket here is what actually bounds credential spraying.
//
// Returns the response to send: the 429 once the bucket is gone, otherwise the provider's own
// rejection with the bucket stated on it, so a client watches its attempts drain instead of
// discovering the ceiling by hitting it.
// fallow-ignore-next-line unused-export -- Reached through a lazy `import()` in worker-entrypoint.ts.
export async function getAnonThrottleResponse({
  request,
  response,
}: {
  request: Request;
  response: Response;
}): Promise<Response> {
  try {
    const quota = await chargeAnonRateLimit({
      clientIp: request.headers.get(__INTERNAL_TRUSTED_CLIENT_IP_HEADER),
    });

    if (!quota) {
      return response;
    }

    // Copied rather than mutated: a response the provider passed through from elsewhere can carry
    // immutable headers, and a throttle must never be able to fail the response it annotates.
    const stamped = new Response(response.body, response);
    applyRateLimitHeaders({ headers: stamped.headers, quota });

    return stamped;
  } catch (error) {
    return (
      rateLimitProblemOrNull({
        error,
        request,
        failureLog: "Anonymous API rate limiting failed",
      }) ?? response
    );
  }
}
