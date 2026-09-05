import { describe, expect, test, vi } from "vitest";

import { alertBlockDomSpec } from "./alert-block";

// A stub icon: React must camel-case `stroke-width` and `fill-rule`, but keep
// `aria-hidden` and `data-*` as written.
vi.mock("@lucide/icons/build", () => ({
  buildLucideIconNode: () => [
    "svg",
    {
      key: "icon",
      xmlns: "http://www.w3.org/2000/svg",
      "stroke-width": "2",
      "fill-rule": "evenodd",
      "aria-hidden": "true",
      "data-icon": "info",
      viewBox: "0 0 24 24",
    },
    [["path", { key: "path", "clip-rule": "evenodd", d: "M0 0" }]],
  ],
}));

interface IconSpec {
  attrs: Record<string, unknown>;
  childAttrs: Record<string, unknown>;
}

function iconSpecOf(target: "html" | "react"): IconSpec {
  const spec = alertBlockDomSpec({
    attrs: { title: "Heads up", body: "Body", variant: "info" },
    editable: target === "react",
    target,
  }) as readonly unknown[];
  const icon = spec[2] as [string, Record<string, unknown>, [string, Record<string, unknown>]];
  return { attrs: icon[1], childAttrs: icon[2][1] };
}

describe("alertBlockDomSpec", () => {
  test("keeps the original attribute names for the HTML target", () => {
    const { attrs, childAttrs } = iconSpecOf("html");

    expect(attrs).toMatchObject({
      "stroke-width": "2",
      "fill-rule": "evenodd",
      "aria-hidden": "true",
      "data-icon": "info",
      viewBox: "0 0 24 24",
    });
    expect(childAttrs).toMatchObject({ "clip-rule": "evenodd" });
    expect(attrs).not.toHaveProperty("key");
    expect(attrs).not.toHaveProperty("xmlns");
  });

  test("camel-cases every hyphenated attribute except data-* and aria-* for the React target", () => {
    const { attrs, childAttrs } = iconSpecOf("react");

    expect(attrs).toMatchObject({
      strokeWidth: "2",
      fillRule: "evenodd",
      "aria-hidden": "true",
      "data-icon": "info",
      viewBox: "0 0 24 24",
    });
    expect(attrs).not.toHaveProperty("stroke-width");
    expect(attrs).not.toHaveProperty("fill-rule");
    expect(childAttrs).toMatchObject({ clipRule: "evenodd" });
  });

  test("renders the alert wrapper and its text slots", () => {
    const spec = alertBlockDomSpec({
      attrs: { title: "Heads up", body: "Body", variant: "info" },
      editable: false,
      target: "html",
    }) as readonly [string, Record<string, unknown>, ...unknown[]];

    expect(spec[0]).toBe("div");
    expect(spec[1]).toMatchObject({ "data-type": "alert-block", "data-variant": "info", role: "alert" });
    expect(spec).toHaveLength(5);
  });

  test("keeps empty title and body slots only when editable", () => {
    const params = { attrs: { title: "", body: "", variant: "info" }, target: "html" } as const;

    expect(alertBlockDomSpec({ ...params, editable: false })).toHaveLength(3);
    expect(alertBlockDomSpec({ ...params, editable: true })).toHaveLength(5);
  });
});
