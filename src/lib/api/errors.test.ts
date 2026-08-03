import { beforeEach, describe, expect, test, vi } from "vitest";

import { API_ERRORS_DOCS_PATH, SITE_URL } from "@/constants";
import { ActionError } from "@/lib/action-error";
import type { ProblemDetails, ProblemResult } from "@/lib/api/errors";

vi.mock("server-only", () => ({}));

vi.mock("@/utils/get-IP", () => ({
  getIP: vi.fn(),
}));

vi.mock("@/utils/is-test-mode", () => ({
  isTestMode: () => false,
}));

vi.mock("@/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
}));

const { RateLimitError } = await import("@/utils/with-rate-limit");
const {
  PROBLEM_BY_CODE,
  PROBLEM_JSON_CONTENT_TYPE,
  actionErrorToProblem,
  toProblemResponse,
} = await import("@/lib/api/errors");

// Namespaces of the i18n catalogs: none of them may ever appear in a machine-facing payload.
const CATALOG_KEY_PATTERN = /^(Client|Validation|Emails|Blog)\./;

const RAY_ID = "8f1b2c3d4e5f6789-FRA";

function problemFor(code: string, request?: Request): ProblemDetails {
  return actionErrorToProblem({
    error: new ActionError(code, { key: "Client.Errors.unexpected" }),
    request,
  }).body;
}

describe("actionErrorToProblem status mapping", () => {
  test.each([
    ["INPUT_PARSE_ERROR", 400],
    ["BAD_REQUEST", 400],
    ["NOT_AUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["PRECONDITION_FAILED", 409],
  ])("maps %s to %i", (code, status) => {
    const problem = problemFor(code);

    expect(problem.status).toBe(status);
    expect(problem.code).toBe(code);
  });

  test("falls back to 500 for codes without a dedicated status", () => {
    expect(problemFor("INTERNAL_SERVER_ERROR").status).toBe(500);
    expect(problemFor("ERROR").status).toBe(500);
  });

  test("resolves a keyed error to prose rather than leaking its catalog key", () => {
    const problem = problemFor("NOT_FOUND");

    expect(problem.detail).toBe(PROBLEM_BY_CODE.NOT_FOUND.detail);
    expect(problem.detail).not.toMatch(CATALOG_KEY_PATTERN);
  });

  // RFC 9457 makes `detail` human-readable, and the MCP layer shows it verbatim to an agent.
  test("never emits a catalog key as detail for any mapped code", () => {
    for (const code of Object.keys(PROBLEM_BY_CODE)) {
      expect(problemFor(code).detail).not.toMatch(CATALOG_KEY_PATTERN);
    }
  });

  test("falls back to generic prose for a keyed error with an unmapped code", () => {
    expect(problemFor("ERROR").detail).not.toMatch(CATALOG_KEY_PATTERN);
  });

  // The per-code sentence is the same for every FORBIDDEN, so a caller that hits a plan limit
  // reads "not allowed to perform this operation" and goes hunting for a missing scope instead.
  test("a key with its own entry states the specific reason, not the per-code sentence", () => {
    const problem = actionErrorToProblem({
      error: new ActionError("FORBIDDEN", {
        key: "Client.Dashboard.Teams.seatLimitReached",
        params: { seats: 3 },
      }),
    }).body;

    expect(problem.code).toBe("FORBIDDEN");
    expect(problem.detail).not.toBe(PROBLEM_BY_CODE.FORBIDDEN.detail);
    expect(problem.detail).not.toMatch(CATALOG_KEY_PATTERN);
    // Interpolated from the error's own params: the number is what decides the next move.
    expect(problem.detail).toContain("3");
  });

  test("a key without an entry still falls back to the per-code sentence", () => {
    const problem = actionErrorToProblem({
      error: new ActionError("FORBIDDEN", { key: "Client.Errors.unexpected" }),
    }).body;

    expect(problem.detail).toBe(PROBLEM_BY_CODE.FORBIDDEN.detail);
  });

  test("passes through legacy inline ActionError messages unchanged", () => {
    const problem = actionErrorToProblem({
      error: new ActionError("PRECONDITION_FAILED", "Disposable email addresses are not allowed"),
    }).body;

    expect(problem.detail).toBe("Disposable email addresses are not allowed");
  });

  test("derives the problem type URI from the site constants", () => {
    const problem = problemFor("NOT_FOUND");

    expect(problem.type).toBe(`${SITE_URL}${API_ERRORS_DOCS_PATH}#NOT_FOUND`);
    expect(problem.title.length).toBeGreaterThan(0);
  });
});

describe("actionErrorToProblem rate limiting", () => {
  test("maps RateLimitError to 429 with retry-after in the header and body", () => {
    const problem: ProblemResult = actionErrorToProblem({ error: new RateLimitError(42) });

    expect(problem.status).toBe(429);
    expect(problem.body.code).toBe("RATE_LIMITED");
    expect(problem.body.retryAfter).toBe(42);
    expect(problem.headers["retry-after"]).toBe("42");
  });

  test("omits retry-after for every other error", () => {
    const problem = actionErrorToProblem({ error: new ActionError("NOT_FOUND", "gone") });

    expect(problem.headers["retry-after"]).toBeUndefined();
    expect(problem.body.retryAfter).toBeUndefined();
  });
});

describe("actionErrorToProblem unknown errors", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("never leaks internal failure details", () => {
    const problem = actionErrorToProblem({ error: new Error("D1_ERROR: near \"SELECT\"") });

    expect(problem.status).toBe(500);
    expect(problem.body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(problem.body.detail).not.toContain("D1_ERROR");
  });
});

describe("problem request correlation", () => {
  test("uses cf-ray as the request id when the edge provides one", () => {
    const request = new Request("https://example.com/api/v1/me", {
      headers: { "cf-ray": RAY_ID },
    });

    expect(problemFor("NOT_FOUND", request).requestId).toBe(RAY_ID);
  });

  test("omits the request id when there is no cf-ray header", () => {
    const request = new Request("https://example.com/api/v1/me");

    expect(problemFor("NOT_FOUND", request).requestId).toBeUndefined();
    expect(problemFor("NOT_FOUND").requestId).toBeUndefined();
  });
});

describe("toProblemResponse", () => {
  test("serializes the problem as application/problem+json", async () => {
    const problem = actionErrorToProblem({ error: new RateLimitError(7) });

    const response = toProblemResponse(problem);

    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    expect(response.headers.get("retry-after")).toBe("7");
    await expect(response.json()).resolves.toEqual(problem.body);
  });
});
