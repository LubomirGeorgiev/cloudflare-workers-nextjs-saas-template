import "server-only";

import { getCurrentSession } from "@/utils/auth";
import { withRateLimit, type RateLimitConfig } from "@/utils/with-rate-limit";

// Charges an authenticated surface to the caller instead of their IP. The IP key puts a whole
// office — or a whole IPv6 /64 — on one budget, so one person browsing settings locks out everyone
// else. Anonymous callers still fall back to the IP key, which is what bounds credential abuse.
//
// Lives outside `with-rate-limit.ts` on purpose: that module is imported by the API/MCP hot path,
// which must not pull in auth and its session/DB dependencies. See docs/worker-hot-path-and-bundle-size.md.
export async function withUserRateLimit<T>(
  action: () => Promise<T>,
  config: RateLimitConfig
): Promise<T> {
  const session = await getCurrentSession();

  return withRateLimit(action, { ...config, userIdentifier: session?.userId });
}
