import "server-only";

import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono-openapi";

import type { ApiEnv } from "@/api/types";
import { API_JSON_BODY_MAX_BYTES } from "@/constants";
import { ActionError } from "@/lib/action-error";
import { actionErrorToProblem, PROBLEM_BY_CODE, toProblemResponse } from "@/lib/api/errors";
import { toFieldError, type ValidationIssue } from "@/lib/api/field-errors";
import { applyRateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { teamIdParamSchema } from "@/schemas/api/common.schema";
import { readBoundedRequestBody } from "@/utils/bounded-request-body";

// Machine clients get stable codes, never localized prose, so the copy here is deliberately
// untranslated: `code` is the contract, `detail` is a hint for a human reading a log.
// Deliberately more specific than the generic NOT_FOUND prose: a bad path is not a missing record.
const UNKNOWN_ENDPOINT_DETAIL = "Unknown API endpoint.";
const MALFORMED_BODY_DETAIL = "The request body is not valid JSON.";
const OVERSIZED_BODY_DETAIL = `The request body must be at most ${API_JSON_BODY_MAX_BYTES} bytes.`;
const NOT_JSON_BODY_DETAIL =
  "The request has a body but no JSON content type. Send it with `Content-Type: application/json`.";
// The media types Hono's JSON validator parses. It reads any other body as `{}`, which a caller
// then sees as "field required" for a field that the body does contain.
const JSON_CONTENT_TYPE_PATTERN = /^application\/([a-z-.]+\+)?json(;|$)/i;

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
  const middleware = validator(target, schema, (result, c: Context<ApiEnv>) =>
    validationHook({ result, target, c }),
  );

  return target === "json" ? withBoundedJsonBody(middleware) : middleware;
}

/**
 * Hono's JSON validator buffers the whole body before it parses. This reads a clone first and stops
 * at the cap, so an oversized body never reaches that unbounded read. The validator then reads the
 * original, which the clone already proved to be within the cap.
 */
function withBoundedJsonBody<Handler extends MiddlewareHandler>(validatorMiddleware: Handler): Handler {
  const bounded: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const { exceededLimit, text } = await readBoundedRequestBody({
      request: c.req.raw,
      maxBytes: API_JSON_BODY_MAX_BYTES,
    });
    if (exceededLimit) {
      throw new ActionError("PAYLOAD_TOO_LARGE", OVERSIZED_BODY_DETAIL);
    }
    if (text === null) {
      throw new ActionError("INPUT_PARSE_ERROR", MALFORMED_BODY_DETAIL);
    }
    if (text.trim() !== "" && !JSON_CONTENT_TYPE_PATTERN.test(c.req.header("content-type") ?? "")) {
      throw new ActionError("INPUT_PARSE_ERROR", NOT_JSON_BODY_DETAIL);
    }

    return validatorMiddleware(c, next);
  };

  // The OpenAPI generator reads hono-openapi's metadata symbol off the handler, and the route
  // policy audit finds validators by name, so the wrapper must carry both.
  Object.defineProperty(bounded, "name", { value: validatorMiddleware.name, configurable: true });

  return Object.assign(bounded, validatorMiddleware);
}

/** `/teams/:teamId` is on most routes; this is that one validator, stated once. */
export function teamIdParam() {
  return apiValidator("param", teamIdParamSchema);
}
