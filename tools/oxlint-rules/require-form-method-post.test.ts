import { describe, expect, it } from "vitest";
import { requireFormMethodPostRule } from "./require-form-method-post.js";

describe("requireFormMethodPostRule", () => {
  it.each([
    ["a string literal", [attribute({ name: "method", value: literal("post") })]],
    ["an upper-case literal", [attribute({ name: "method", value: literal("POST") })]],
    ["an expression container", [attribute({ name: "method", value: expression(literal("post")) })]],
    ["method=\"dialog\", which sends no request", [attribute({ name: "method", value: literal("dialog") })]],
    ["a function action and no method", [attribute({ name: "action", value: expression(identifier()) })]],
    ["a spread before the method", [spread(), attribute({ name: "method", value: literal("post") })]],
  ])("accepts a form with %s", (_label, attributes) => {
    expect(reportCount(jsxElement({ name: "form", attributes }))).toBe(0);
  });

  it.each([
    ["no method", []],
    ["method=\"get\"", [attribute({ name: "method", value: literal("get") })]],
    ["a dynamic method", [attribute({ name: "method", value: expression(identifier()) })]],
    ["only a spread", [spread()]],
    ["a spread after the method", [attribute({ name: "method", value: literal("post") }), spread()]],
    ["a string action and no method", [attribute({ name: "action", value: literal("/search") })]],
    ["a string action in an expression and no method", [attribute({ name: "action", value: expression(literal("/search")) })]],
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

function attribute({ name, value }: { name: string; value: unknown }) {
  return { type: "JSXAttribute", name: { type: "JSXIdentifier", name }, value };
}

function spread() {
  return { type: "JSXSpreadAttribute", argument: identifier() };
}

function expression(inner: unknown) {
  return { type: "JSXExpressionContainer", expression: inner };
}

function identifier() {
  return { type: "Identifier", name: "value" };
}

function literal(value: string) {
  return { type: "Literal", value };
}
