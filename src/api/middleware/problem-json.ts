import "server-only";

import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";

import type { ApiEnv } from "@/api/types";
import { ActionError } from "@/lib/action-error";
import { actionErrorToProblem, PROBLEM_BY_CODE, toProblemResponse } from "@/lib/api/errors";
import { toFieldError, type ValidationIssue } from "@/lib/api/field-errors";
import { applyRateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { teamIdParamSchema } from "@/schemas/api/common.schema";

// Machine clients get stable codes, never localized prose, so the copy here is deliberately
// untranslated: `code` is the contract, `detail` is a hint for a human reading a log.
// Deliberately more specific than the generic NOT_FOUND prose: a bad path is not a missing record.
const UNKNOWN_ENDPOINT_DETAIL = "Unknown API endpoint.";
const MALFORMED_BODY_DETAIL = "The request body is not valid JSON.";

/**
 * Hono throws `HTTPException` from `validator()` when a body declared as JSON cannot be parsed
 * (malformed, or empty) — before our validation hook ever runs. That is a caller mistake, so it
 * has to become the same 400 a rejected field does instead of falling through to the unmapped 500.
 */
function toMappedError(error: unknown): unknown {
  if (error instanceof HTTPException && error.status === 400) {
    return new ActionError("INPUT_PARSE_ERROR", MALFORMED_BODY_DETAIL);
  }

  return error;
}

// Single exit for everything the routes throw: ActionError from the service layer, RateLimitError
// from the limiters, and anything unexpected (mapped to a 500 that leaks nothing).
export const problemJsonErrorHandler: ErrorHandler<ApiEnv> = (error, c) => {
  const response = toProblemResponse(
    actionErrorToProblem({ error: toMappedError(error), request: c.req.raw }),
  );

  // A thrown handler unwinds past the rate-limit middleware, so the charged quota is published
  // here instead. A 429 already carries the bucket that refused it and is left alone.
  applyRateLimitHeaders({ headers: response.headers, quota: c.get("rateLimitQuota") });

  return response;
};

export const problemJsonNotFoundHandler: NotFoundHandler<ApiEnv> = (c) =>
  toProblemResponse(
    actionErrorToProblem({
      error: new ActionError("NOT_FOUND", UNKNOWN_ENDPOINT_DETAIL),
      request: c.req.raw,
    }),
  );

// Handed to every `validator()` so a rejected request answers with the same problem document as
// everything else, plus one located, coded entry per rejected value.
function validationHook({
  result,
  target,
  c,
}: {
  result: { success: boolean; error?: readonly ValidationIssue[] };
  target: string;
  c: Context<ApiEnv>;
}): Response | undefined {
  if (result.success) {
    return undefined;
  }

  const problem = actionErrorToProblem({
    error: new ActionError("INPUT_PARSE_ERROR", PROBLEM_BY_CODE.INPUT_PARSE_ERROR.detail),
    request: c.req.raw,
  });
  problem.body.errors = (result.error ?? []).map((issue) => toFieldError({ issue, target }));

  return toProblemResponse(problem);
}

type ValidatorTarget = Parameters<typeof validator>[0];
type ValidatorSchema = Parameters<typeof validator>[1];

/**
 * The only way routes should validate. Threading `validationHook` by hand made it a third argument
 * that must never differ — a route that forgot it would answer a bad request with Hono's plain-text
 * 400 instead of problem+json. Here it is a default nothing can omit.
 *
 * The target is taken from this call rather than from the hook's payload: it is what tells a
 * caller whether a rejected value came from the body, the query, or the path.
 */
export function apiValidator<Target extends ValidatorTarget, Schema extends ValidatorSchema>(
  target: Target,
  schema: Schema,
) {
  return validator(target, schema, (result, c: Context<ApiEnv>) =>
    validationHook({ result, target, c }),
  );
}

/** `/teams/:teamId` is on most routes; this is that one validator, stated once. */
export function teamIdParam() {
  return apiValidator("param", teamIdParamSchema);
}
