import "server-only";

import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "@/api/types";

// The marker carrier both operation declarations share. A guard stamps its own policy onto itself,
// and the route-table audits read it back off the mounted handler, so a route that skips the
// declaration is visible structurally rather than only at request time.
//
// Each surface creates its own marker: an internal policy must never be readable as a public one,
// and one string per surface is what keeps the two route tables separable.

interface PolicyMarker<Policy> {
  carry: (args: { guard: MiddlewareHandler<ApiEnv>; policy: Policy }) => MiddlewareHandler<ApiEnv>;
  read: (handler: unknown) => Policy | undefined;
}

export function createPolicyMarker<Policy>(marker: string): PolicyMarker<Policy> {
  return {
    carry: ({ guard, policy }) => Object.assign(guard, { [marker]: policy }),
    read: (handler) => {
      if (typeof handler !== "function" || !(marker in handler)) {
        return undefined;
      }

      return (handler as unknown as Record<string, Policy>)[marker];
    },
  };
}
