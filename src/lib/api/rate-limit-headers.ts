import "server-only";

import type { RateLimitSnapshot } from "@/utils/with-rate-limit";

// draft-polli-ratelimit-headers-02: three non-negative integer fields describing the bucket the
// request was charged against. `RateLimit-Limit` may carry the quota policy it belongs to, which is
// what tells a client the window (`w=`) without having to be refused once to discover it.
const LIMIT_HEADER = "ratelimit-limit";
const REMAINING_HEADER = "ratelimit-remaining";
const RESET_HEADER = "ratelimit-reset";

export function rateLimitHeaders(quota: RateLimitSnapshot): Record<string, string> {
  return {
    [LIMIT_HEADER]: `${quota.limit}, ${quota.limit};w=${quota.windowInSeconds}`,
    [REMAINING_HEADER]: String(quota.remaining),
    [RESET_HEADER]: String(quota.resetSeconds),
  };
}

/**
 * Publish a quota on a response that already exists. A bucket already described on the response
 * wins: a 429 states the bucket that refused it, not whichever one was charged earlier.
 */
export function applyRateLimitHeaders({
  headers,
  quota,
}: {
  headers: Headers;
  quota: RateLimitSnapshot | null | undefined;
}): void {
  if (!quota || headers.has(LIMIT_HEADER)) {
    return;
  }

  for (const [name, value] of Object.entries(rateLimitHeaders(quota))) {
    headers.set(name, value);
  }
}
