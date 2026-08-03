import { describe, expect, test } from "vitest";

import { v } from "@/lib/validation";
import { FIELD_ERROR_CODES, toFieldError, type ValidationIssue } from "@/lib/api/field-errors";

// Driven through real Valibot rather than hand-built issue objects: the whole point of the mapper
// is that it survives Valibot's own reporting quirks (an absent key is an *object* issue, a bound
// carries its requirement, a picklist is a schema issue), so a fake issue would test nothing.
function fieldErrorsFor({
  schema,
  input,
  target = "json",
}: {
  schema: v.GenericSchema;
  input: unknown;
  target?: string;
}) {
  const result = v.safeParse(schema, input);

  return (result.issues ?? []).map((issue) =>
    toFieldError({ issue: issue as ValidationIssue, target }),
  );
}

describe("codes", () => {
  test("an absent key is required, not a type mismatch", () => {
    const errors = fieldErrorsFor({ schema: v.object({ name: v.string() }), input: {} });

    expect(errors).toEqual([{ in: "body", pointer: "/name", code: "required" }]);
  });

  test("a wrong-typed value reports the type it expected", () => {
    const errors = fieldErrorsFor({ schema: v.object({ name: v.string() }), input: { name: 2 } });

    expect(errors).toEqual([
      { in: "body", pointer: "/name", code: "invalid_type", params: { expected: "string" } },
    ]);
  });

  // Valibot renders container types capitalized; the published name is the JSON Schema one.
  test("container types report lowercased JSON Schema type names", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ tags: v.array(v.string()) }),
      input: { tags: "one" },
    });

    expect(errors[0]?.params).toEqual({ expected: "array" });
  });

  test("a bound reports the limit it violated", () => {
    const schema = v.object({ name: v.pipe(v.string(), v.minLength(2), v.maxLength(4)) });

    expect(fieldErrorsFor({ schema, input: { name: "a" } })).toEqual([
      { in: "body", pointer: "/name", code: "min_length", params: { min: 2 } },
    ]);
    expect(fieldErrorsFor({ schema, input: { name: "abcde" } })).toEqual([
      { in: "body", pointer: "/name", code: "max_length", params: { max: 4 } },
    ]);
  });

  test("a numeric range reports its bound", () => {
    const schema = v.object({ days: v.pipe(v.number(), v.minValue(1), v.maxValue(365)) });

    expect(fieldErrorsFor({ schema, input: { days: 0 } })[0]).toEqual({
      in: "body",
      pointer: "/days",
      code: "min_value",
      params: { min: 1 },
    });
    expect(fieldErrorsFor({ schema, input: { days: 999 } })[0]?.params).toEqual({ max: 365 });
  });

  test("a value outside an enumeration is invalid_value, not invalid_type", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ scope: v.picklist(["read", "write"]) }),
      input: { scope: "admin" },
    });

    expect(errors).toEqual([{ in: "body", pointer: "/scope", code: "invalid_value" }]);
  });

  test("a format rule names the format", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ email: v.pipe(v.string(), v.email()) }),
      input: { email: "nope" },
    });

    expect(errors).toEqual([
      { in: "body", pointer: "/email", code: "invalid_format", params: { format: "email" } },
    ]);
  });

  test("an integer refinement reads as a type to the caller", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ days: v.pipe(v.number(), v.integer()) }),
      input: { days: 1.5 },
    });

    expect(errors[0]).toEqual({
      in: "body",
      pointer: "/days",
      code: "invalid_type",
      params: { expected: "integer" },
    });
  });

  // A custom `check` carries no vocabulary a client could have been told about in advance.
  test("a custom check degrades to the generic refusal", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ name: v.pipe(v.string(), v.check((value) => value !== "taken")) }),
      input: { name: "taken" },
    });

    expect(errors[0]?.code).toBe("invalid_value");
  });

  test("every emitted code is in the published vocabulary", () => {
    const schemas: { schema: v.GenericSchema; input: unknown }[] = [
      { schema: v.object({ a: v.string() }), input: {} },
      { schema: v.object({ a: v.string() }), input: { a: 1 } },
      { schema: v.object({ a: v.pipe(v.string(), v.minLength(2)) }), input: { a: "x" } },
      { schema: v.object({ a: v.pipe(v.string(), v.maxLength(1)) }), input: { a: "xx" } },
      { schema: v.object({ a: v.pipe(v.number(), v.minValue(2)) }), input: { a: 1 } },
      { schema: v.object({ a: v.pipe(v.number(), v.maxValue(1)) }), input: { a: 2 } },
      { schema: v.object({ a: v.picklist(["x"]) }), input: { a: "y" } },
      { schema: v.object({ a: v.pipe(v.string(), v.email()) }), input: { a: "y" } },
    ];

    const codes = schemas.flatMap((each) => fieldErrorsFor(each)).map((error) => error.code);

    expect(codes.length).toBe(schemas.length);
    for (const code of codes) {
      expect(FIELD_ERROR_CODES).toContain(code);
    }
  });
});

describe("location", () => {
  test("a nested value is addressed by JSON Pointer", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ owner: v.object({ email: v.string() }) }),
      input: { owner: { email: 1 } },
    });

    expect(errors[0]?.pointer).toBe("/owner/email");
  });

  test("an array element is addressed by its index", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ scopes: v.array(v.picklist(["read"])) }),
      input: { scopes: ["read", "write"] },
    });

    expect(errors[0]?.pointer).toBe("/scopes/1");
  });

  test("a rejected payload with no path addresses the whole document", () => {
    const errors = fieldErrorsFor({ schema: v.object({ a: v.string() }), input: "not an object" });

    expect(errors[0]).toEqual({
      in: "body",
      pointer: "",
      code: "invalid_type",
      params: { expected: "object" },
    });
  });

  // RFC 6901 reserves `~` and `/` inside a reference token.
  test("reserved characters in a key are escaped", () => {
    const errors = fieldErrorsFor({
      schema: v.object({ "a/b~c": v.string() }),
      input: { "a/b~c": 1 },
    });

    expect(errors[0]?.pointer).toBe("/a~1b~0c");
  });

  test("the validator target becomes the OpenAPI parameter location", () => {
    const schema = v.object({ teamId: v.string() });

    expect(fieldErrorsFor({ schema, input: {}, target: "param" })[0]?.in).toBe("path");
    expect(fieldErrorsFor({ schema, input: {}, target: "query" })[0]?.in).toBe("query");
    expect(fieldErrorsFor({ schema, input: {}, target: "header" })[0]?.in).toBe("header");
  });
});
