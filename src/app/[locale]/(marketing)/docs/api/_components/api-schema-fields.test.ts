import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { ParameterView, SchemaFieldView } from "@/lib/api/reference-model";

import { ApiParameterFields, ApiSchemaFields } from "./api-schema-fields";

const LABELS = {
  required: "Required",
  optional: "Optional",
  nullable: "nullable",
};

// Hand-written fixtures, never real endpoints: a fork renames operations and fields freely.
function field(overrides: Partial<SchemaFieldView> & { key: string; label: string }): SchemaFieldView {
  return {
    depth: 0,
    typeLabel: "string",
    required: true,
    nullable: false,
    description: null,
    constraints: [],
    enumValues: [],
    ...overrides,
  };
}

function parameter(overrides: Partial<ParameterView> & { name: string; location: string }): ParameterView {
  return {
    required: true,
    typeLabel: "string",
    description: null,
    constraints: [],
    ...overrides,
  };
}

function childKeys(tree: ReactElement): (string | null)[] {
  const { children } = tree.props as { children: ReactElement[] };
  return children.map((child) => child.key);
}

describe("ApiSchemaFields", () => {
  test("renders the label, not the React identity key", () => {
    const fields = [
      field({ key: "identity-only", label: "owner.name", depth: 1 }),
      field({ key: "scopes", label: "scopes[]", typeLabel: "string[]" }),
    ];

    const html = renderToStaticMarkup(ApiSchemaFields({ fields, variant: "request", labels: LABELS }));

    // The dotted path is the token a caller copies, so nesting must survive into the row.
    expect(html).toContain("owner.name");
    expect(html).toContain("scopes[]");
    expect(html).not.toContain("identity-only");
  });

  test("renders each enum value as its own chip with no comma text node", () => {
    const values = ["alpha", "beta", "gamma"];
    const fields = [field({ key: "mode", label: "mode", enumValues: values })];

    const html = renderToStaticMarkup(ApiSchemaFields({ fields, variant: "request", labels: LABELS }));

    for (const value of values) {
      expect(html).toContain(`>${value}<`);
    }
    // A comma inside the flex row becomes its own flex item, so chips render as `[alpha] , [beta]`.
    expect(html).not.toMatch(/alpha<\/span>\s*,/);
  });
});

describe("ApiParameterFields", () => {
  const parameters = [
    parameter({ name: "teamId", location: "path" }),
    parameter({ name: "limit", location: "query", required: false, typeLabel: "integer" }),
  ];

  test("renders the bare parameter name, never the location-name identity", () => {
    const html = renderToStaticMarkup(ApiParameterFields({ parameters, labels: LABELS }));

    expect(html).toContain(">teamId<");
    expect(html).toContain(">limit<");
    expect(html).not.toContain("path-teamId");
    expect(html).not.toContain("query-limit");
    // The location stays, as a constraint chip rather than glued onto the name.
    expect(html).toContain("in: path");
    expect(html).toContain("in: query");
  });

  test("keeps one React key per row, unique across locations", () => {
    const samePerLocation = [
      parameter({ name: "id", location: "path" }),
      parameter({ name: "id", location: "query" }),
    ];

    const keys = childKeys(ApiParameterFields({ parameters: samePerLocation, labels: LABELS }));

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});
