import "server-only";

import type { Context, Next } from "hono";

import type { ApiEnv } from "@/api/types";
import { ActionError } from "@/lib/action-error";
import type { ApiOperationAudience } from "@/lib/api/audience";
import { getBearerPrincipal, type ApiPrincipal } from "@/lib/api/principal";
import { recordSpanException, withSpan } from "@/utils/trace";

const OPERATION_SPAN_NAME = "app.api.operation";
const OPERATION_ATTRIBUTES = {
  surface: "app.api.surface",
  operationId: "app.api.operation_id",
  scope: "app.api.scope",
  audience: "app.api.audience",
  principalKind: "app.api.principal_kind",
  outcome: "app.api.outcome",
  statusCode: "http.response.status_code",
} as const;
const OUTCOME_OK = "ok";
const NO_SCOPE = "none";
const NO_PRINCIPAL = "none";
// A guard that throws something other than an ActionError ends in the problem mapper's 500.
const UNMAPPED_ERROR_STATUS = 500;
const PRINCIPAL_KIND_VALUES = {
  "api-key": "api_key",
  "oauth-grant": "oauth_grant",
} as const satisfies Record<ApiPrincipal["kind"], string>;

// Hono serves the API outside vinext, so no route span exists. This span wraps the guard and the
// rest of the chain, so its duration is the operation time. Shared by both operation surfaces.
export function traceApiOperation({
  c,
  next,
  operation,
  guard,
}: {
  c: Context<ApiEnv>;
  next: Next;
  operation: TracedOperation;
  guard: () => void | Promise<unknown>;
}): Promise<void> {
  return withSpan({
    name: OPERATION_SPAN_NAME,
    // A guard refusal is an answer the caller can act on. Any other guard throw is a fault.
    isExpected: (error) => error instanceof ActionError,
    run: async (span) => {
      if (span.isTraced) {
        const principal = getBearerPrincipal();

        span.setAttributes({
          [OPERATION_ATTRIBUTES.surface]: operation.surface,
          [OPERATION_ATTRIBUTES.operationId]: operation.operationId,
          [OPERATION_ATTRIBUTES.scope]: operation.scope ?? NO_SCOPE,
          [OPERATION_ATTRIBUTES.audience]: operation.audience,
          [OPERATION_ATTRIBUTES.principalKind]: principal
            ? PRINCIPAL_KIND_VALUES[principal.kind]
            : NO_PRINCIPAL,
        });
      }

      try {
        await guard();
      } catch (error) {
        span.setAttribute(
          OPERATION_ATTRIBUTES.outcome,
          decideOperationResult({ error, status: UNMAPPED_ERROR_STATUS }).outcome,
        );

        throw error;
      }

      await next();

      // Hono turns an error thrown further down the chain into `c.res` and keeps it on `c.error`,
      // so `next()` resolves and the span has to read the failure from the context.
      const { outcome, unexpected } = decideOperationResult({ error: c.error, status: c.res.status });

      if (unexpected) {
        recordSpanException({ span, error: c.error });
      }
      span.setAttributes({
        [OPERATION_ATTRIBUTES.outcome]: outcome,
        [OPERATION_ATTRIBUTES.statusCode]: c.res.status,
      });
    },
  });
}

// An ActionError code is stable and low-cardinality. Anything else becomes a status class.
// An ActionError below 500 is an answer the caller can act on, not a fault to record.
function decideOperationResult({
  error,
  status,
}: {
  error: unknown;
  status: number;
}): { outcome: string; unexpected: boolean } {
  if (error instanceof ActionError) {
    return { outcome: error.code, unexpected: status >= UNMAPPED_ERROR_STATUS };
  }
  if (!error && status < 400) {
    return { outcome: OUTCOME_OK, unexpected: false };
  }

  return { outcome: `${Math.floor(status / 100)}xx`, unexpected: Boolean(error) };
}

interface TracedOperation {
  surface: "public" | "admin";
  operationId: string;
  /** A scope name from a fixed catalog, or null for the one unscoped operation. */
  scope: string | null;
  audience: ApiOperationAudience;
}
