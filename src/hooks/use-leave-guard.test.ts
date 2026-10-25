import { describe, expect, test } from "vitest";

import { shouldGuardLinkClick } from "./use-leave-guard";

const CURRENT_HREF = "http://localhost/admin/cms/blog/entry-1?tab=seo";

function click(overrides: Partial<Parameters<typeof shouldGuardLinkClick>[0]> = {}) {
  return shouldGuardLinkClick({
    button: 0,
    hasModifierKey: false,
    defaultPrevented: false,
    target: null,
    hasDownload: false,
    href: "http://localhost/admin/cms/tags",
    currentHref: CURRENT_HREF,
    ...overrides,
  });
}

describe("shouldGuardLinkClick", () => {
  test("guards a plain click to another page on this origin", () => {
    expect(click()).toBe(true);
    expect(click({ target: "_self" })).toBe(true);
  });

  test("guards a change of query string on the same path", () => {
    expect(click({ href: "http://localhost/admin/cms/blog/entry-1?tab=content" })).toBe(true);
  });

  test("lets a click that keeps this page open go through", () => {
    expect(click({ button: 1 })).toBe(false);
    expect(click({ hasModifierKey: true })).toBe(false);
    expect(click({ target: "_blank" })).toBe(false);
    expect(click({ hasDownload: true })).toBe(false);
  });

  test("lets a click another handler already cancelled go through", () => {
    expect(click({ defaultPrevented: true })).toBe(false);
  });

  // `beforeunload` already asks before a full load of another origin.
  test("leaves another origin to beforeunload", () => {
    expect(click({ href: "https://example.com/" })).toBe(false);
  });

  test("lets a jump to a hash on this page go through", () => {
    expect(click({ href: `${CURRENT_HREF}#seo` })).toBe(false);
  });
});
