import "server-only";

import type { MiddlewareHandler } from "hono";
import { describeRoute, type DescribeRouteOptions, type ResponsesWithResolver } from "hono-openapi";

import { audienceGuard } from "@/api/middleware/audience";
import { securityForScope } from "@/api/openapi-document";
import { COMMON_ERROR_RESPONSES } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { audienceExtension, type ApiOperationAudience } from "@/lib/api/audience";
import { requireScope } from "@/lib/api/principal";
import type { ApiScope } from "@/lib/api/scopes";

// One declaration per operation: a route states its scope and audience once, and this emits both
// the OpenAPI `security` metadata and the guard enforcing them, so a documented scope and an
// enforced scope cannot drift apart.
//
// The guard is mounted ahead of every `validator()` and refuses in that order: a credential that
// may not call an operation at all must not learn its schema from a 400. It carries the policy on
// itself, so `apiApp.routes` can be audited structurally — a route that skips this fails a test.

const POLICY_MARKER = "__apiOperationPolicy";

interface ApiOperationPolicy {
  scope: ApiScope;
  audience: ApiOperationAudience;
}

type ApiOperationSpec = Omit<DescribeRouteOptions, "security" | "responses"> &
  ApiOperationPolicy & {
    operationId: string;
    /** Success responses only; the shared failure modes are documented for every operation. */
    responses: ResponsesWithResolver;
  };

function policyGuard(policy: ApiOperationPolicy): MiddlewareHandler<ApiEnv> {
  const assertAudience = audienceGuard(policy.audience);

  const guard: MiddlewareHandler<ApiEnv> = (c, next) => {
    requireScope(policy.scope);
    assertAudience(c);

    return next();
  };

  return Object.assign(guard, { [POLICY_MARKER]: policy });
}

/**
 * Spread into a route registration ahead of its validators and handler:
 * `.post("/teams", ...apiOperation({ ..., scope, audience, responses }), validator(...), handler)`.
 */
export function apiOperation({
  scope,
  audience,
  responses,
  ...spec
}: ApiOperationSpec): [MiddlewareHandler<ApiEnv>, MiddlewareHandler<ApiEnv>] {
  return [
    describeRoute({
      ...spec,
      // Documented as well as enforced: the MCP tool list reads it to hide operations a team
      // credential could never call, and no reader can rebuild it from the rest of the document.
      ...audienceExtension(audience),
      security: securityForScope(scope),
      responses: { ...COMMON_ERROR_RESPONSES, ...responses },
    }),
    policyGuard({ scope, audience }),
  ];
}

/** A middleware carrying the marker `policyGuard` stamps onto itself. */
interface PolicyCarrier {
  [POLICY_MARKER]: ApiOperationPolicy;
}

/** The policy a mounted handler declares, for the route-table audits. */
export function readOperationPolicy(handler: unknown): ApiOperationPolicy | undefined {
  if (typeof handler !== "function" || !(POLICY_MARKER in handler)) {
    return undefined;
  }

  return (handler as PolicyCarrier)[POLICY_MARKER];
}
