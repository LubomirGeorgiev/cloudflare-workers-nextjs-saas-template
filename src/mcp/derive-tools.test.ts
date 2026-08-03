// Derivation is the whole MCP tool surface, so it is tested against a hand-written document rather
// than the app's own: what matters is the mapping rules, and a synthetic spec states each rule in
// isolation. The generated document is covered end to end by `tests/integration/mcp-server.test.ts`.

import type { OpenAPIV3_1 } from "openapi-types";
import { describe, expect, test } from "vitest";

import { audienceExtension, DEFAULT_OPERATION_AUDIENCE } from "@/lib/api/audience";
import { hiddenFromMcp } from "@/lib/api/openapi-extensions";
import {
  deriveMcpTools,
  mcpToolNameByOperationId,
  WRAPPED_BODY_ARGUMENT,
  type McpToolDescriptor,
} from "@/mcp/derive-tools";

const NO_OVERRIDES = {};

// openapi-types builds `PathsObject` out of its 3.0 operation types, which reject perfectly valid
// 3.1 fragments; the assertion is confined to this helper so the specs stay plain data.
function document(paths: Record<string, unknown>): { paths: OpenAPIV3_1.PathsObject } {
  return { paths } as { paths: OpenAPIV3_1.PathsObject };
}

function jsonBody(schema: Record<string, unknown>, required = true) {
  return { required, content: { "application/json": { schema } } };
}

function jsonResponse(schema: Record<string, unknown>) {
  return { 200: { description: "ok", content: { "application/json": { schema } } } };
}

function byName(tools: McpToolDescriptor[], name: string): McpToolDescriptor {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`No tool named ${name} in [${tools.map((t) => t.name).join(", ")}]`);
  }
  return tool;
}

const LIST_WIDGETS = {
  operationId: "listWidgets",
  summary: "List widgets",
  description: "Lists every widget the credential can see.",
  security: [{ apiKey: ["widgets:read"] }, { oauth2: ["widgets:read"] }],
};

describe("deriveMcpTools", () => {
  test("one tool per operation, named after its operationId", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": {
          get: LIST_WIDGETS,
          post: { ...LIST_WIDGETS, operationId: "createWidget", summary: "Create a widget" },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(tools.map((tool) => tool.name)).toEqual(["createWidget", "listWidgets"]);
    expect(byName(tools, "listWidgets")).toMatchObject({
      method: "GET",
      path: "/widgets",
      title: "List widgets",
      description: "Lists every widget the credential can see.",
    });
  });

  test("an operation with no operationId cannot become a tool", () => {
    const tools = deriveMcpTools({
      document: document({ "/widgets": { get: { summary: "Anonymous" } } }),
      overrides: NO_OVERRIDES,
    });

    expect(tools).toEqual([]);
  });

  // Scope filtering at registration time depends on this: the document declares one catalog scope
  // per operation, and it is read from the first security requirement.
  test("the operation's declared scope rides along, and its absence is explicit", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": { get: LIST_WIDGETS },
        "/public": { get: { operationId: "getPublic", summary: "Public", description: "Public." } },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(byName(tools, "listWidgets").scope).toBe("widgets:read");
    expect(byName(tools, "getPublic").scope).toBeNull();
  });

  // `tools/list` hides account-audience tools from a team credential, so an operation whose
  // declaration cannot be read must land on the restrictive end rather than on the permissive one.
  test("the operation's audience rides along, and an unreadable one fails closed", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": { get: { ...LIST_WIDGETS, ...audienceExtension("team") } },
        "/undeclared": { get: { operationId: "noAudience", summary: "None", description: "None." } },
        "/junk": { get: { operationId: "junkAudience", summary: "Junk", "x-audience": "banana" } },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(byName(tools, "listWidgets").audience).toBe("team");
    expect(byName(tools, "noAudience").audience).toBe(DEFAULT_OPERATION_AUDIENCE);
    expect(byName(tools, "junkAudience").audience).toBe(DEFAULT_OPERATION_AUDIENCE);
    expect(DEFAULT_OPERATION_AUDIENCE).toBe("account");
  });

  test("`x-mcp: false` keeps an operation out of the tool surface", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": { get: LIST_WIDGETS },
        "/internal": {
          get: { operationId: "internalOnly", summary: "Internal", ...hiddenFromMcp() },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(tools.map((tool) => tool.name)).toEqual(["listWidgets"]);
  });

  test("the override map can hide, rename, and sharpen a tool", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": {
          get: LIST_WIDGETS,
          post: { ...LIST_WIDGETS, operationId: "createWidget" },
        },
      }),
      overrides: {
        createWidget: { hidden: true },
        listWidgets: { name: "widgets_search", title: "Search", description: "Sharpened." },
      },
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "widgets_search",
      operationId: "listWidgets",
      title: "Search",
      description: "Sharpened.",
    });
  });

  test("path parameters, query parameters, and body fields become one argument object", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets/{widgetId}": {
          patch: {
            operationId: "updateWidget",
            summary: "Update",
            parameters: [
              { in: "path", name: "widgetId", required: true, schema: { type: "string" } },
              { in: "query", name: "dryRun", schema: { type: "boolean" } },
              { in: "header", name: "x-trace", schema: { type: "string" } },
            ],
            requestBody: jsonBody({
              type: "object",
              properties: { name: { type: "string" }, note: { type: "string" } },
              required: ["name"],
            }),
          },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    const tool = byName(tools, "updateWidget");

    expect(tool.pathParams).toEqual(["widgetId"]);
    expect(tool.queryParams).toEqual(["dryRun"]);
    expect(tool.bodyParams).toEqual(["name", "note"]);
    expect(Object.keys(tool.inputSchema.properties)).toEqual(["widgetId", "dryRun", "name", "note"]);
    // A path parameter is always required; an optional query parameter never is.
    expect(tool.inputSchema.required).toEqual(["widgetId", "name"]);
    // Headers are transport concerns, not tool arguments.
    expect(tool.inputSchema.properties).not.toHaveProperty("x-trace");
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  // An argument the operation does not accept should come back as an error the agent can act on,
  // not be quietly dropped on the way to the request.
  test("every tool's argument object is closed, whatever the operation carries", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": {
          get: LIST_WIDGETS,
          post: {
            operationId: "createWidget",
            summary: "Create",
            requestBody: jsonBody({
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            }),
          },
        },
        "/widgets/{widgetId}": {
          get: {
            operationId: "getWidget",
            summary: "Get",
            parameters: [{ in: "path", name: "widgetId", required: true, schema: { type: "string" } }],
          },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(tools).not.toHaveLength(0);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    // A parameterless operation is closed too, so it accepts no arguments at all.
    expect(byName(tools, "listWidgets").inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  // Nested schemas come from the published document; rewriting them would drift the tools away
  // from the spec the same fields are documented by.
  test("closing the argument object leaves nested body schemas untouched", () => {
    const nested = {
      type: "object",
      properties: { unit: { type: "string" } },
      required: ["unit"],
    };
    const tools = deriveMcpTools({
      document: document({
        "/widgets": {
          post: {
            operationId: "createWidget",
            summary: "Create",
            requestBody: jsonBody({
              type: "object",
              properties: { size: nested },
              required: ["size"],
            }),
          },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(byName(tools, "createWidget").inputSchema.properties.size).toEqual(nested);
  });

  test("converted field schemas are passed through verbatim", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": {
          post: {
            operationId: "createWidget",
            summary: "Create",
            requestBody: jsonBody({
              type: "object",
              properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
              required: ["name"],
            }),
          },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(byName(tools, "createWidget").inputSchema.properties.name).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 100,
    });
  });

  test("a non-object request body travels in a single wrapped argument", () => {
    const body = { type: "array", items: { type: "string" } };
    const tools = deriveMcpTools({
      document: document({
        "/widgets/bulk": {
          post: {
            operationId: "bulkCreate",
            summary: "Bulk create",
            requestBody: jsonBody(body),
          },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    const tool = byName(tools, "bulkCreate");

    expect(tool.wrapsBody).toBe(true);
    expect(tool.bodyParams).toEqual([]);
    expect(tool.inputSchema.required).toEqual([WRAPPED_BODY_ARGUMENT]);
    // The argument object is closed; the wrapped body itself is the document's schema verbatim.
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.properties[WRAPPED_BODY_ARGUMENT]).toEqual(body);
  });

  // `structuredContent` must be an object, and the SDK validates it against whatever we advertise,
  // so array and scalar responses deliberately get no output schema at all.
  test("only object-shaped success responses become an output schema", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": { get: { ...LIST_WIDGETS, responses: jsonResponse({ type: "array", items: {} }) } },
        "/widgets/{id}": {
          get: {
            operationId: "getWidget",
            summary: "Get",
            responses: jsonResponse({
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            }),
          },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(byName(tools, "listWidgets").outputSchema).toBeUndefined();
    expect(byName(tools, "getWidget").outputSchema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });

  // One flat argument object cannot address a parameter and a body field of the same name, and
  // silently dropping either half would send a request missing what the agent supplied.
  test("a body field colliding with a parameter fails derivation, naming both", () => {
    const derive = () =>
      deriveMcpTools({
        document: document({
          "/widgets/{name}": {
            patch: {
              operationId: "updateWidget",
              summary: "Update",
              parameters: [{ in: "path", name: "name", required: true, schema: { type: "string" } }],
              requestBody: jsonBody({
                type: "object",
                properties: { name: { type: "string" }, note: { type: "string" } },
              }),
            },
          },
        }),
        overrides: NO_OVERRIDES,
      });

    expect(derive).toThrow(/updateWidget/);
    expect(derive).toThrow(/"name"/);
  });

  test("a parameter claiming the wrapped-body argument name fails derivation", () => {
    const derive = () =>
      deriveMcpTools({
        document: document({
          "/widgets/bulk": {
            post: {
              operationId: "bulkCreate",
              summary: "Bulk create",
              parameters: [
                { in: "query", name: WRAPPED_BODY_ARGUMENT, schema: { type: "string" } },
              ],
              requestBody: jsonBody({ type: "array", items: { type: "string" } }),
            },
          },
        }),
        overrides: NO_OVERRIDES,
      });

    expect(derive).toThrow(/bulkCreate/);
    expect(derive).toThrow(new RegExp(`"${WRAPPED_BODY_ARGUMENT}"`));
  });

  test("a hidden operation is never derived, so a collision in one cannot break the surface", () => {
    const tools = deriveMcpTools({
      document: document({
        "/widgets": { get: LIST_WIDGETS },
        "/legacy/{name}": {
          post: {
            operationId: "legacyCollision",
            summary: "Legacy",
            ...hiddenFromMcp(),
            parameters: [{ in: "path", name: "name", required: true, schema: { type: "string" } }],
            requestBody: jsonBody({ type: "object", properties: { name: { type: "string" } } }),
          },
        },
      }),
      overrides: NO_OVERRIDES,
    });

    expect(tools.map((tool) => tool.name)).toEqual(["listWidgets"]);
  });
});

describe("mcpToolNameByOperationId", () => {
  test("maps operationIds to advertised tool names and memoizes on the document", () => {
    const spec = document({ "/widgets": { get: LIST_WIDGETS } });

    const names = mcpToolNameByOperationId(spec);

    expect(names.get("listWidgets")).toBe("listWidgets");
    // Rendering a page must not re-walk the document: the same document object reuses the map.
    expect(mcpToolNameByOperationId(spec)).toBe(names);
  });
});
