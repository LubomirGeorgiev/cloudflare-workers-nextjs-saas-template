import { describe, expect, test } from "vitest";

import {
  DOCS_ROUTES,
  DOCS_ROUTE_SECTIONS,
  INDEXED_DOCS_ROUTES,
  type DocsPageRoute,
} from "./docs-routes";

// A fork edits this list, so every expectation comes from the data itself: no route count, no
// pathname, no branded copy. The point is the split, not which routes the template ships.

// Compile-time guard: both indexing fields must stay required on a page route. If either turns
// optional again, this alias resolves to `never` and tsc fails before any test runs.
type IndexingFields = Pick<DocsPageRoute, "metaNamespace" | "sitemapPriority">;
type IndexingFieldsAreRequired = IndexingFields extends Required<IndexingFields> ? true : never;
const indexingFieldsAreRequired: IndexingFieldsAreRequired = true;

const pageRoutes = DOCS_ROUTES.filter((route) => route.isLocalized);
const machineRoutes = DOCS_ROUTES.filter((route) => !route.isLocalized);

function idsOf(routes: readonly { id: string }[]): string[] {
  return routes.map((route) => route.id).sort();
}

describe("DOCS_ROUTES", () => {
  test("ships at least one route, so the assertions below are not vacuous", () => {
    expect(DOCS_ROUTES.length).toBeGreaterThan(0);
  });

  test("gives every route a unique id and pathname", () => {
    expect(new Set(DOCS_ROUTES.map((route) => route.id)).size).toBe(DOCS_ROUTES.length);
    expect(new Set(DOCS_ROUTES.map((route) => route.pathname)).size).toBe(DOCS_ROUTES.length);
  });

  test("renders every route in the sidebar sections exactly once", () => {
    const rendered = DOCS_ROUTE_SECTIONS.flatMap((section) => section.groups.flat());

    expect(idsOf(rendered)).toEqual(idsOf(DOCS_ROUTES));
  });
});

describe("INDEXED_DOCS_ROUTES", () => {
  test("keeps every page route, so none drops out of the public surfaces", () => {
    expect(idsOf(INDEXED_DOCS_ROUTES)).toEqual(idsOf(pageRoutes));
  });

  test("splits the routes totally: page routes plus machine endpoints", () => {
    expect(INDEXED_DOCS_ROUTES.length + machineRoutes.length).toBe(DOCS_ROUTES.length);
    expect(INDEXED_DOCS_ROUTES.every((route) => route.isLocalized)).toBe(true);
  });

  test("keeps both indexing fields required on a page route", () => {
    expect(indexingFieldsAreRequired).toBe(true);
  });

  test("carries the indexing fields the sitemap and llms.txt read", () => {
    for (const route of INDEXED_DOCS_ROUTES) {
      expect(typeof route.metaNamespace).toBe("string");
      expect(route.metaNamespace.length).toBeGreaterThan(0);
      expect(route.sitemapPriority).toBeGreaterThan(0);
      expect(route.sitemapPriority).toBeLessThanOrEqual(1);
    }
  });

  test("leaves the machine endpoints out of the indexing fields", () => {
    for (const route of machineRoutes) {
      expect(route.metaNamespace).toBeUndefined();
      expect(route.sitemapPriority).toBeUndefined();
    }
  });
});
