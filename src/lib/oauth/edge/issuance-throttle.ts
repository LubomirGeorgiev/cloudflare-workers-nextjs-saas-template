import "server-only";

import type { ApiRateLimitName } from "@/api/middleware/rate-limit";
import { oauthCoreOptions } from "@/lib/oauth/provider-config";

// Registration and token issuance are charged *before* the provider handles the request: a
// response-side check would still let an attacker allocate provider KV records before receiving the
// 429. Token forms are inspected only to derive a stable digest; raw credentials never enter
// limiter keys or logs, and RFC 7009 revocation requests bypass issuance throttling entirely.

type IssuanceEndpoint = "dcr" | "token";

interface IssuanceThrottlePlan {
  endpoint: IssuanceEndpoint;
  policies: Array<{ rateLimit: ApiRateLimitName; userIdentifier: string }>;
}

export const ISSUANCE_FAILURE_LOG: Record<IssuanceEndpoint, string> = {
  dcr: "OAuth DCR rate limiting failed",
  token: "OAuth token rate limiting failed",
};

// Derived from the provider's own configuration rather than restating the constants: when the DCR
// kill-switch is off `clientRegistrationEndpoint` is absent, the provider serves no registration
// endpoint at all, and the path is correctly left unthrottled by the same fact.
const THROTTLED_ISSUANCE_PATHS = new Map<string, IssuanceEndpoint>([
  ...(oauthCoreOptions.clientRegistrationEndpoint
    ? [[oauthCoreOptions.clientRegistrationEndpoint, "dcr"] as const]
    : []),
  [oauthCoreOptions.tokenEndpoint, "token"],
]);

async function inspectTokenIdentity(request: Request) {
  try {
    const { inspectOAuthTokenRateLimitIdentity } = await import("@/lib/oauth/token-rate-limit");

    return await inspectOAuthTokenRateLimitIdentity(request);
  } catch (error) {
    // Classification is part of the soft limiter, not OAuth correctness. If it fails, preserve
    // token issuance and revocation rather than letting an auxiliary control take auth down.
    console.error("OAuth token rate limit classification failed", error);
    return null;
  }
}

/** The buckets this request must clear before the provider sees it, or null for no throttling. */
export async function resolveIssuanceThrottlePlan({
  pathname,
  request,
  clientIp,
}: {
  pathname: string;
  request: Request;
  clientIp: string;
}): Promise<IssuanceThrottlePlan | null> {
  const endpoint = THROTTLED_ISSUANCE_PATHS.get(pathname);

  if (!endpoint) {
    return null;
  }

  if (endpoint === "dcr") {
    return { endpoint, policies: [{ rateLimit: "OAUTH_DCR", userIdentifier: clientIp }] };
  }

  const inspection = await inspectTokenIdentity(request);
  if (!inspection || inspection.isRevocationRequest) {
    return null;
  }

  return {
    endpoint,
    policies: [
      { rateLimit: "OAUTH_TOKEN_IP", userIdentifier: clientIp },
      ...(inspection.fingerprint
        ? [{ rateLimit: "OAUTH_TOKEN_IDENTITY" as const, userIdentifier: inspection.fingerprint }]
        : []),
    ],
  };
}
