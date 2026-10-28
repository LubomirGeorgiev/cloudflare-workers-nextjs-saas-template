import { describe, expect, it } from "vitest";
import { requireFormMethodPostRule } from "./require-form-method-post.js";

describe("requireFormMethodPostRule", () => {
  it.each([
    ["a string literal", literal("post")],
    ["an upper-case literal", literal("POST")],
    ["an expression container", { type: "JSXExpressionContainer", expression: literal("post") }],
  ])("accepts a form with method=\"post\" as %s", (_label, value) => {
    expect(reportCount(jsxElement({ name: "form", attributes: [methodAttribute(value)] }))).toBe(0);
  });

  it.each([
    ["no method", []],
    ["method=\"get\"", [methodAttribute(literal("get"))]],
    ["a dynamic method", [methodAttribute({ type: "JSXExpressionContainer", expression: { type: "Identifier" } })]],
    ["only a spread", [{ type: "JSXSpreadAttribute" }]],
  ])("reports a form with %s", (_label, attributes) => {
    expect(reportCount(jsxElement({ name: "form", attributes }))).toBe(1);
  });

  it("ignores elements that are not a native form", () => {
    expect(reportCount(jsxElement({ name: "div", attributes: [] }))).toBe(0);
    expect(reportCount({ type: "JSXOpeningElement", name: { type: "JSXMemberExpression" }, attributes: [] })).toBe(0);
  });
});

function reportCount(node: unknown): number {
  let count = 0;
  const visitor = requireFormMethodPostRule.create({
    report: () => {
      count += 1;
    },
  });

  visitor.JSXOpeningElement(node);

  return count;
}

function jsxElement({ name, attributes }: { name: string; attributes: unknown[] }) {
  return { type: "JSXOpeningElement", name: { type: "JSXIdentifier", name }, attributes };
}

function methodAttribute(value: unknown) {
  return { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "method" }, value };
}

function literal(value: string) {
  return { type: "Literal", value };
}
