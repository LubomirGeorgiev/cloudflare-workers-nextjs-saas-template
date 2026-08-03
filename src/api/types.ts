import type { Hono } from "hono";

import type { ApiPrincipal } from "@/lib/api/principal";
import type { RateLimitSnapshot } from "@/utils/with-rate-limit";

// One Hono environment for the whole API: `Bindings` is the Worker env (D1/KV/queues),
// and the authenticated principal is published as a context variable by the auth middleware.
export interface ApiEnv {
  Bindings: Env;
  Variables: {
    principal: ApiPrincipal;
    /** The bucket this request was charged against, republished as `RateLimit-*` on the response. */
    rateLimitQuota?: RateLimitSnapshot;
  };
}

export type ApiApp = Hono<ApiEnv>;
