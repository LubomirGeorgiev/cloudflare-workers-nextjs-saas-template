import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { CmsIcon } from "@/components/cms-icon";

import { prefixIconIds } from "./icon-id-namespace";

const GRADIENT_ICON =
  '<svg viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><path fill="url(#g)"/><use href="#g"/></svg>';

describe("prefixIconIds", () => {
  test("prefixes each id and every local reference to it", () => {
    expect(prefixIconIds({ markup: GRADIENT_ICON, namespace: "x" })).toBe(
      '<svg viewBox="0 0 24 24"><defs><linearGradient id="x-g"/></defs><path fill="url(#x-g)"/><use href="#x-g"/></svg>',
    );
  });

  test("returns a document with no ids unchanged", () => {
    const markup = '<svg><path fill="currentColor" d="M0 0h1"/></svg>';

    expect(prefixIconIds({ markup, namespace: "x" })).toBe(markup);
  });
});

describe("CmsIcon", () => {
  // A hidden first copy would otherwise own the gradient that the visible copy points at.
  test("gives two copies of the same icon different ids", () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(CmsIcon, { icon: { markup: GRADIENT_ICON } }),
        createElement(CmsIcon, { icon: { markup: GRADIENT_ICON } }),
      ),
    );
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(html).toContain(`url(#${id})`);
    }
  });
});
