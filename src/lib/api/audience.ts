import type { OpenAPIV3_1 } from "openapi-types";

// The audience vocabulary, shared the way the scope catalog is: declared once per operation in
// `src/api/operation.ts`, enforced by `src/api/middleware/audience.ts`, and carried into the
// generated document so every reader — the MCP tool derivation included — can see it.

/** Vendor extension the generated document carries an operation's declared audience in. */
export const AUDIENCE_EXTENSION_KEY = "x-audience";

export const API_OPERATION_AUDIENCES = ["account", "team", "any"] as const;

export type ApiOperationAudience = (typeof API_OPERATION_AUDIENCES)[number];

// Fail closed: an operation whose declaration we cannot read is treated as account-only, so a team
// credential is never advertised a tool whose policy is unknown. Hiding one costs discovery; the
// other direction advertises a tool that can only ever answer 403.
export const DEFAULT_OPERATION_AUDIENCE: ApiOperationAudience = "account";

function isApiOperationAudience(value: unknown): value is ApiOperationAudience {
  return API_OPERATION_AUDIENCES.includes(value as ApiOperationAudience);
}

/** Spread into a route's document metadata, the way `hiddenFromMcp()` is. */
export function audienceExtension(audience: ApiOperationAudience): Record<string, unknown> {
  return { [AUDIENCE_EXTENSION_KEY]: audience };
}

/** The audience an operation declares, or the fail-closed default when it declares none. */
export function audienceOfOperation(operation: OpenAPIV3_1.OperationObject): ApiOperationAudience {
  const declared = (operation as Record<string, unknown>)[AUDIENCE_EXTENSION_KEY];

  return isApiOperationAudience(declared) ? declared : DEFAULT_OPERATION_AUDIENCE;
}
