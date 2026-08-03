// The docs UI renders exactly what this mapping produces, so the rules are tested against a
// hand-written document rather than the app's own: each rule is stated in isolation. The generated
// document is covered end to end by `tests/integration/api-openapi-spec.test.ts`.

import type { OpenAPIV3_1 } from "openapi-types";
import { describe, expect, test } from "vitest";

import { API_SCOPE_NAMES, describeApiScope } from "@/lib/api/scopes";
import {
  buildApiReferenceView,
  buildCurlSnippet,
  type OperationView,
} from "@/lib/api/reference-model";

const SCOPE = API_SCOPE_NAMES[0];

// openapi-types builds `PathsObject` out of its 3.0 operation types, which reject perfectly valid
// 3.1 fragments; the assertion is confined to this helper so the specs stay plain data.
function document({
  paths,
  tags = [],
}: {
  paths: Record<string, unknown>;
  tags?: OpenAPIV3_1.TagObject[];
}): OpenAPIV3_1.Document {
  return {
    openapi: "3.1.0",
    info: { title: "Widgets API", description: "Widgets.", version: "1.0.0" },
    // Origin only, like the generated document: the path keys carry the API base path themselves.
    servers: [{ url: "https://example.com" }],
    tags,
    paths,
  } as OpenAPIV3_1.Document;
}

function jsonBody(schema: Record<string, unknown>) {
  return { required: true, content: { "application/json": { schema } } };
}

function jsonResponse(schema: Record<string, unknown>) {
  return { description: "ok", content: { "application/json": { schema } } };
}

const LIST_WIDGETS = {
  operationId: "listWidgets",
  tags: ["Widgets"],
  summary: "List widgets",
  description: "Lists every widget the credential can see.",
  security: [{ apiKey: [SCOPE] }, { oauth2: [SCOPE] }],
  responses: {
    200: jsonResponse({
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, size: { type: "number" } },
        required: ["id"],
      },
    }),
  },
};

function only(
  paths: Record<string, unknown>,
  mcpToolNames?: Map<string, string>,
): OperationView {
  const view = buildApiReferenceView({
    document: document({ paths, tags: [{ name: "Widgets" }] }),
    mcpToolNames,
  });
  const operation = view.groups[0]?.operations[0];

  if (!operation) {
    throw new Error("no operation was derived");
  }

  return operation;
}

describe("buildApiReferenceView", () => {
  test("one operation per documented method, anchored by operationId", () => {
    const view = buildApiReferenceView({
      document: document({
        paths: {
          "/api/v1/widgets": {
            get: LIST_WIDGETS,
            post: { ...LIST_WIDGETS, operationId: "createWidget", summary: "Create a widget" },
          },
        },
      }),
    });

    expect(view.operationCount).toBe(2);
    expect(view.baseUrl).toBe("https://example.com");
    expect(view.groups[0].operations.map((operation) => operation.anchorId)).toEqual([
      "operation-listWidgets",
      "operation-createWidget",
    ]);
  });

  test("operations without an operationId are skipped, since the anchor would not be addressable", () => {
    const view = buildApiReferenceView({
      document: document({ paths: { "/api/v1/widgets": { get: { summary: "Undocumented" } } } }),
    });

    expect(view.operationCount).toBe(0);
  });

  test("groups follow the document's tag order, with untagged operations last", () => {
    const view = buildApiReferenceView({
      document: document({
        paths: {
          "/api/v1/loose": { get: { ...LIST_WIDGETS, operationId: "loose", tags: [] } },
          "/api/v1/widgets": { get: LIST_WIDGETS },
          "/api/v1/gadgets": { get: { ...LIST_WIDGETS, operationId: "listGadgets", tags: ["Gadgets"] } },
        },
        tags: [{ name: "Gadgets" }, { name: "Widgets" }],
      }),
    });

    expect(view.groups.map((group) => group.name)).toEqual(["Gadgets", "Widgets", ""]);
  });

  test("the declared scope carries its catalog description", () => {
    const operation = only({ "/api/v1/widgets": { get: LIST_WIDGETS } });

    expect(operation.scope).toBe(SCOPE);
    expect(operation.scopeDescription).toBe(describeApiScope(SCOPE));
  });

  // Which operations are tools, and what they are called, is the MCP package's decision: the view
  // model only labels the ones its caller names, and leaves the rest unlabelled.
  test("an operation the caller names no tool for gets no tool name", () => {
    const named = only({ "/api/v1/widgets": { get: LIST_WIDGETS } }, new Map([["listWidgets", "list_widgets"]]));
    const unnamed = only({ "/api/v1/widgets": { get: LIST_WIDGETS } });

    expect(named.mcpToolName).toBe("list_widgets");
    expect(unnamed.mcpToolName).toBeNull();
  });

  test("array responses expand the item's fields and example", () => {
    const operation = only({ "/api/v1/widgets": { get: LIST_WIDGETS } });
    const success = operation.successResponses[0];

    expect(success.status).toBe("200");
    expect(success.schema?.typeLabel).toBe("object[]");
    expect(success.schema?.fields.map((field) => [field.key, field.typeLabel, field.required])).toEqual([
      ["id", "string", true],
      ["size", "number", false],
    ]);
    expect(success.schema?.example).toEqual([{ id: "string", size: 0 }]);
  });

  test("nullable unions collapse to one field row rather than reading as a union", () => {
    const operation = only({
      "/api/v1/widgets": {
        get: {
          ...LIST_WIDGETS,
          responses: {
            200: jsonResponse({
              type: "object",
              properties: {
                label: { anyOf: [{ type: "string" }, { type: "null" }] },
                count: { type: ["integer", "null"] },
                either: { anyOf: [{ type: "string" }, { type: "number" }] },
              },
            }),
          },
        },
      },
    });

    const fields = operation.successResponses[0].schema?.fields ?? [];

    expect(fields.map((field) => [field.name, field.typeLabel, field.nullable])).toEqual([
      ["label", "string", true],
      ["count", "integer", true],
      ["either", "string | number", false],
    ]);
  });

  test("nested objects become indented rows and constraints become chips", () => {
    const operation = only({
      "/api/v1/widgets": {
        post: {
          ...LIST_WIDGETS,
          operationId: "createWidget",
          requestBody: jsonBody({
            type: "object",
            properties: {
              email: { type: "string", format: "email", maxLength: 255 },
              owner: {
                type: "object",
                properties: { name: { type: "string", minLength: 2 } },
                required: ["name"],
              },
              scopes: { type: "array", items: { type: "string", enum: ["a", "b"] } },
              flag: { type: "boolean", default: true },
            },
            required: ["email"],
          }),
          responses: { 201: jsonResponse({ type: "object", properties: { id: { type: "string" } } }) },
        },
      },
    });

    const body = operation.requestBody;

    expect(body?.fields.map((field) => [field.key, field.depth, field.typeLabel])).toEqual([
      ["email", 0, "string"],
      ["owner", 0, "object"],
      ["owner.name", 1, "string"],
      ["scopes", 0, "string[]"],
      ["flag", 0, "boolean"],
    ]);
    expect(body?.fields[0].constraints).toEqual(["format: email", "maxLength 255"]);
    expect(body?.fields[3].enumValues).toEqual(["a", "b"]);
    expect(body?.fields[4].constraints).toEqual(["default: true"]);
    expect(body?.example).toEqual({
      email: "user@example.com",
      owner: { name: "string" },
      scopes: ["a"],
      flag: true,
    });
  });

  test("responses split by status class, and the shared failure shape is kept once", () => {
    const operation = only({
      "/api/v1/widgets": {
        get: {
          ...LIST_WIDGETS,
          responses: {
            200: jsonResponse({ type: "object", properties: { id: { type: "string" } } }),
            404: {
              description: "gone",
              content: {
                "application/problem+json": {
                  schema: { type: "object", properties: { code: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    });

    expect(operation.successResponses.map((response) => response.status)).toEqual(["200"]);
    expect(operation.errorResponses.map((response) => response.status)).toEqual(["404"]);
    // Declared under problem+json, so a JSON-only reader would have dropped the schema entirely.
    expect(operation.errorExample).toEqual({ code: "string" });
  });

  test("path and query parameters keep their location and requiredness", () => {
    const operation = only({
      "/api/v1/widgets/{widgetId}": {
        get: {
          ...LIST_WIDGETS,
          parameters: [
            { in: "path", name: "widgetId", required: true, schema: { type: "string", minLength: 1 } },
            { in: "query", name: "teamId", schema: { type: "string" } },
          ],
        },
      },
    });

    expect(operation.parameters).toEqual([
      {
        name: "widgetId",
        location: "path",
        required: true,
        typeLabel: "string",
        description: null,
        constraints: ["minLength 1"],
      },
      {
        name: "teamId",
        location: "query",
        required: false,
        typeLabel: "string",
        description: null,
        constraints: [],
      },
    ]);
  });

  test("the search haystack covers everything the filter is expected to match", () => {
    const operation = only({
      "/api/v1/widgets/{widgetId}": {
        get: {
          ...LIST_WIDGETS,
          parameters: [{ in: "path", name: "widgetId", required: true, schema: { type: "string" } }],
        },
      },
    });

    for (const token of ["get", "/api/v1/widgets/{widgetid}", "listwidgets", "widgets", SCOPE, "widgetid"]) {
      expect(operation.searchText).toContain(token);
    }
  });
});

describe("buildCurlSnippet", () => {
  // The snippet joins `servers[0].url` and the path verbatim — the same resolution a spec-conformant
  // client performs — so a document that double-prefixed the base path would show it here.
  test("a GET reads as a plain curl call against the server url joined with the path", () => {
    const operation = only({ "/api/v1/widgets": { get: LIST_WIDGETS } });

    expect(operation.curl).toBe(
      'curl "https://example.com/api/v1/widgets" \\\n  -H "Authorization: Bearer $API_KEY"',
    );
  });

  test("a write states the method and sends the example body", () => {
    expect(
      buildCurlSnippet({
        method: "POST",
        url: "https://example.com/api/v1/widgets",
        bodyExample: { name: "string" },
      }),
    ).toBe(
      [
        'curl -X POST "https://example.com/api/v1/widgets" \\',
        '  -H "Authorization: Bearer $API_KEY" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '${JSON.stringify({ name: "string" }, null, 2)}'`,
      ].join("\n"),
    );
  });
});
