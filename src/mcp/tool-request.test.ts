// The wire contract between one flat tool-argument object and the REST request it dispatches to.

import { describe, expect, test } from "vitest";

import type { McpToolDescriptor } from "@/mcp/derive-tools";
import { buildToolRequest, toToolResult } from "@/mcp/tool-request";

const ORIGIN = "https://example.test";
// Restated rather than imported: `@/lib/api/errors` is server-only, and this suite runs in node.
const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";

function descriptor(overrides: Partial<McpToolDescriptor> = {}): McpToolDescriptor {
  return {
    name: "updateWidget",
    title: "Update",
    description: "Update a widget.",
    operationId: "updateWidget",
    method: "PATCH",
    path: "/api/v1/widgets/{widgetId}",
    scope: "widgets:write",
    audience: "account",
    pathParams: ["widgetId"],
    queryParams: ["dryRun"],
    bodyParams: ["name"],
    wrapsBody: false,
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

describe("buildToolRequest", () => {
  test("arguments are split back into path, query, and body", async () => {
    const request = buildToolRequest({
      descriptor: descriptor(),
      args: { widgetId: "w_1", dryRun: true, name: "Renamed" },
      origin: ORIGIN,
    });

    expect(request.method).toBe("PATCH");
    expect(request.url).toBe(`${ORIGIN}/api/v1/widgets/w_1?dryRun=true`);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.json()).toEqual({ name: "Renamed" });
  });

  // A path segment is data, not structure: an id containing a slash must not invent a new route.
  test("path parameters are encoded", () => {
    const request = buildToolRequest({
      descriptor: descriptor(),
      args: { widgetId: "a/b?c" },
      origin: ORIGIN,
    });

    expect(new URL(request.url).pathname).toBe("/api/v1/widgets/a%2Fb%3Fc");
  });

  test("omitted optional arguments are left out entirely", async () => {
    const request = buildToolRequest({
      descriptor: descriptor({ bodyParams: ["name", "note"] }),
      args: { widgetId: "w_1", name: "Only" },
      origin: ORIGIN,
    });

    expect(new URL(request.url).search).toBe("");
    expect(await request.json()).toEqual({ name: "Only" });
  });

  test("an operation without a body sends none", () => {
    const request = buildToolRequest({
      descriptor: descriptor({ method: "GET", bodyParams: [], queryParams: [] }),
      args: { widgetId: "w_1" },
      origin: ORIGIN,
    });

    expect(request.headers.get("content-type")).toBeNull();
    expect(request.body).toBeNull();
  });

  test("a wrapped body is sent as the whole document", async () => {
    const request = buildToolRequest({
      descriptor: descriptor({ wrapsBody: true, bodyParams: [], queryParams: [], method: "POST" }),
      args: { widgetId: "w_1", body: ["a", "b"] },
      origin: ORIGIN,
    });

    expect(await request.json()).toEqual(["a", "b"]);
  });
});

describe("toToolResult", () => {
  test("an object response is returned as text and as structured content", async () => {
    const result = await toToolResult({
      descriptor: descriptor({ outputSchema: { type: "object", properties: {} } }),
      response: Response.json({ id: "w_1", name: "Widget" }),
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: "w_1", name: "Widget" });
    expect(result.content[0].text).toContain("w_1");
  });

  // Structured content is validated against the advertised schema, so it is attached only where
  // the operation actually declares one.
  test("a response with no declared output schema stays text-only", async () => {
    const result = await toToolResult({
      descriptor: descriptor(),
      response: Response.json([{ id: "w_1" }]),
    });

    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain("w_1");
  });

  test("a problem document becomes a tool error carrying the stable code", async () => {
    const problem = {
      code: "FORBIDDEN",
      detail: "Missing scope.",
      errors: [{ field: "name", code: "Validation.required" }],
    };
    const result = await toToolResult({
      descriptor: descriptor(),
      response: new Response(JSON.stringify(problem), {
        status: 403,
        headers: { "content-type": PROBLEM_JSON_CONTENT_TYPE },
      }),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      `${problem.code} (HTTP 403): ${problem.detail}: Invalid fields: ${JSON.stringify(problem.errors)}`,
    );
  });

  // Throttling is only actionable if the agent learns when to come back; without it a model retries blind.
  test("a throttled problem states the retry delay as a sentence", async () => {
    const problem = { code: "RATE_LIMITED", detail: "Rate limit exceeded.", retryAfter: 37 };
    const result = await toToolResult({
      descriptor: descriptor(),
      response: new Response(JSON.stringify(problem), {
        status: 429,
        headers: { "content-type": PROBLEM_JSON_CONTENT_TYPE },
      }),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      `${problem.code} (HTTP 429): ${problem.detail} Retry after ${problem.retryAfter} seconds.`,
    );
  });

  test("a one-second retry delay is singular", async () => {
    const problem = { code: "RATE_LIMITED", detail: "Rate limit exceeded.", retryAfter: 1 };
    const result = await toToolResult({
      descriptor: descriptor(),
      response: new Response(JSON.stringify(problem), {
        status: 429,
        headers: { "content-type": PROBLEM_JSON_CONTENT_TYPE },
      }),
    });

    expect(result.content[0].text).toBe(`${problem.code} (HTTP 429): ${problem.detail} Retry after 1 second.`);
  });

  // No delay in the document means none is known; inventing one would be worse than staying silent.
  test("a throttled problem without a retry delay claims none", async () => {
    const problem = { code: "RATE_LIMITED", detail: "Rate limit exceeded." };
    const result = await toToolResult({
      descriptor: descriptor(),
      response: new Response(JSON.stringify(problem), {
        status: 429,
        headers: { "content-type": PROBLEM_JSON_CONTENT_TYPE },
      }),
    });

    expect(result.content[0].text).toBe(`${problem.code} (HTTP 429): ${problem.detail}`);
    expect(result.content[0].text).not.toContain("Retry after");
  });

  test("an error carrying no retry delay keeps the code-and-detail shape", async () => {
    const problem = { code: "FORBIDDEN", detail: "Missing scope." };
    const result = await toToolResult({
      descriptor: descriptor(),
      response: new Response(JSON.stringify(problem), {
        status: 403,
        headers: { "content-type": PROBLEM_JSON_CONTENT_TYPE },
      }),
    });

    expect(result.content[0].text).toBe(`${problem.code} (HTTP 403): ${problem.detail}`);
  });

  test("a non-JSON failure still produces a readable error", async () => {
    const result = await toToolResult({
      descriptor: descriptor(),
      response: new Response("upstream exploded", { status: 502 }),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("502");
  });
});
