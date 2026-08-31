import "server-only";

import type { MiddlewareHandler } from "hono";
import { describeRoute, type DescribeRouteOptions, type ResponsesWithResolver } from "hono-openapi";

import { securityForAdminScope } from "@/api/admin/openapi-document";
import { COMMON_ERROR_RESPONSES } from "@/api/openapi";
import { createPolicyMarker } from "@/api/operation-policy";
import type { ApiEnv } from "@/api/types";
import { assertAdminPrincipal } from "@/lib/admin/admin-principal";
import type { AdminScope } from "@/lib/api/admin-scopes";

// The admin twin of `src/api/operation.ts`: one declaration per internal operation, emitting both
// the document metadata and the guard, so a documented scope and an enforced one cannot drift.
//
// Deliberately a separate helper rather than a mode on `apiOperation`. `apiOperation` takes an
// `ApiScope` and `adminOperation` takes an `AdminScope`, so the type system alone stops an admin
// scope reaching a public route or a public scope guarding an internal one — neither is expressible.
//
// There is no `audience` parameter: every admin operation is account-level, and `assertAdminPrincipal`
// asserts that itself. Nor is there an `x-mcp` opt-out — the internal MCP server is staff-only, so
// every internal operation is offered there.

interface AdminOperationPolicy {
  operationId: string;
  /** Required and non-nullable: there is no such thing as an unscoped internal operation. */
  scope: AdminScope;
}

// Its own marker, so an internal policy is never readable through the public reader.
const adminPolicyMarker = createPolicyMarker<AdminOperationPolicy>("__adminOperationPolicy");

type AdminOperationSpec = Omit<DescribeRouteOptions, "security" | "responses"> &
  AdminOperationPolicy & {
    /** Success responses only; the shared failure modes are documented for every operation. */
    responses: ResponsesWithResolver;
  };

function adminPolicyGuard(policy: AdminOperationPolicy): MiddlewareHandler<ApiEnv> {
  const guard: MiddlewareHandler<ApiEnv> = async (c, next) => {
    await assertAdminPrincipal({ scope: policy.scope });

    return next();
  };

  return adminPolicyMarker.carry({ guard, policy });
}

/**
 * Spread into an internal route registration ahead of its validators and handler, exactly as
 * `apiOperation` is: `.get("/users", ...adminOperation({ ... }), validator(...), handler)`.
 */
export function adminOperation({
  scope,
  responses,
  ...spec
}: AdminOperationSpec): [MiddlewareHandler<ApiEnv>, MiddlewareHandler<ApiEnv>] {
  return [
    describeRoute({
      ...spec,
      security: securityForAdminScope(scope),
      responses: { ...COMMON_ERROR_RESPONSES, ...responses },
    }),
    adminPolicyGuard({ operationId: spec.operationId, scope }),
  ];
}

/** The policy a mounted internal handler declares, for the route-table audits. */
export function readAdminOperationPolicy(handler: unknown): AdminOperationPolicy | undefined {
  return adminPolicyMarker.read(handler);
}
