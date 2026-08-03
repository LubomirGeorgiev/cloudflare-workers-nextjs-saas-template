import "server-only";

import { API_ERRORS_DOCS_PATH, SITE_URL } from "@/constants";
import { ActionError } from "@/lib/action-error";
import { resolveKeyedProblemDetail } from "@/lib/api/error-details";
import type { ProblemFieldError } from "@/lib/api/field-errors";
import { rateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { RateLimitError, type RateLimitSnapshot } from "@/utils/with-rate-limit";

export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";

// Machine clients branch on `code`, never on prose: the `Validation.*`/`Client.*` i18n catalogs
// stay for humans, so nothing here is translated.
const FALLBACK_CODE = "INTERNAL_SERVER_ERROR";
const FALLBACK_STATUS = 500;
const FALLBACK_DETAIL = "An unexpected error occurred.";
const PROBLEM_TYPE_BASE = `${SITE_URL}${API_ERRORS_DOCS_PATH}`;

// The registry every other table and the `/docs/api/errors` page derive from: a code added here
// without a status, title, and detail row is a compile error, and the docs table gains its row.
export const PROBLEM_CODES = [
  "INPUT_PARSE_ERROR",
  "BAD_REQUEST",
  "NOT_AUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "RATE_LIMITED",
  "INTERNAL_SERVER_ERROR",
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

interface ProblemDefinition {
  status: number;
  title: string;
  /**
   * RFC 9457 wants `detail` human-readable, and the MCP layer puts it straight in front of an
   * agent, so a keyed ActionError resolves to prose here rather than leaking its catalog key.
   */
  detail: string;
}

// The whole catalog in one table: a new failure mode is one entry, and the `/docs/api/errors` page,
// the OpenAPI error responses, and the runtime mapper all read this rather than parallel copies.
export const PROBLEM_BY_CODE: Record<ProblemCode, ProblemDefinition> = {
  INPUT_PARSE_ERROR: {
    status: 400,
    title: "Invalid request",
    detail: "The request failed validation.",
  },
  BAD_REQUEST: {
    status: 400,
    title: "Invalid request",
    detail: "The request is not valid in this context.",
  },
  NOT_AUTHORIZED: {
    status: 401,
    title: "Authentication required",
    detail: "A valid bearer credential is required.",
  },
  FORBIDDEN: {
    status: 403,
    title: "Forbidden",
    detail: "This credential is not allowed to perform this operation.",
  },
  NOT_FOUND: {
    status: 404,
    title: "Not found",
    detail: "The requested resource was not found.",
  },
  CONFLICT: {
    status: 409,
    title: "Conflict",
    detail: "The request conflicts with the current state of the resource.",
  },
  PRECONDITION_FAILED: {
    status: 409,
    title: "Precondition failed",
    detail: "A precondition for this operation was not met.",
  },
  RATE_LIMITED: {
    status: 429,
    title: "Too many requests",
    detail: "Rate limit exceeded.",
  },
  INTERNAL_SERVER_ERROR: {
    status: FALLBACK_STATUS,
    title: "Internal server error",
    detail: FALLBACK_DETAIL,
  },
};

// An ActionError carries a free-form `code`, so every read of the table above goes through this:
// an unregistered code degrades to the 500 row rather than to `undefined`.
function problemForCode(code: string): ProblemDefinition {
  return (PROBLEM_CODES as readonly string[]).includes(code)
    ? PROBLEM_BY_CODE[code as ProblemCode]
    : PROBLEM_BY_CODE[FALLBACK_CODE];
}

/** RFC 9457 problem details; `code`, `requestId`, `retryAfter`, `errors` are our extensions. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId?: string;
  retryAfter?: number;
  errors?: ProblemFieldError[];
}

export interface ProblemResult {
  status: number;
  headers: Record<string, string>;
  body: ProblemDetails;
}

interface ActionErrorToProblemParams {
  error: unknown;
  request?: Request;
}

function buildProblem({
  code,
  detail,
  status,
  requestId,
  retryAfterSeconds,
  quota,
}: {
  code: string;
  detail: string;
  status: number;
  requestId?: string;
  retryAfterSeconds?: number;
  quota?: RateLimitSnapshot;
}): ProblemResult {
  const headers: Record<string, string> = { "content-type": PROBLEM_JSON_CONTENT_TYPE };

  if (retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(retryAfterSeconds);
  }

  if (quota) {
    Object.assign(headers, rateLimitHeaders(quota));
  }

  return {
    status,
    headers,
    body: {
      type: `${PROBLEM_TYPE_BASE}#${code}`,
      title: problemForCode(code).title,
      status,
      code,
      detail,
      ...(requestId ? { requestId } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfter: retryAfterSeconds }),
    },
  };
}

export function actionErrorToProblem({ error, request }: ActionErrorToProblemParams): ProblemResult {
  const requestId = request?.headers.get("cf-ray") ?? undefined;

  if (error instanceof RateLimitError) {
    return buildProblem({
      code: "RATE_LIMITED",
      detail: PROBLEM_BY_CODE.RATE_LIMITED.detail,
      status: PROBLEM_BY_CODE.RATE_LIMITED.status,
      requestId,
      retryAfterSeconds: error.retryAfterSeconds,
      quota: error.quota,
    });
  }

  if (error instanceof ActionError) {
    return buildProblem({
      code: error.code,
      // Inline messages are author-written prose and pass through. A keyed error carries a catalog
      // key, which must never reach this contractually human-readable field, so it resolves to the
      // reason's own untranslated prose — falling back to the per-code sentence when unlisted.
      detail: error.messageKey
        ? resolveKeyedProblemDetail({
            messageKey: error.messageKey,
            messageParams: error.messageParams,
          }) ?? problemForCode(error.code).detail
        : error.message,
      status: problemForCode(error.code).status,
      requestId,
    });
  }

  console.error("Unhandled API error:", error);

  return buildProblem({
    code: FALLBACK_CODE,
    detail: FALLBACK_DETAIL,
    status: FALLBACK_STATUS,
    requestId,
  });
}

export function toProblemResponse(problem: ProblemResult): Response {
  return new Response(JSON.stringify(problem.body), {
    status: problem.status,
    headers: problem.headers,
  });
}
