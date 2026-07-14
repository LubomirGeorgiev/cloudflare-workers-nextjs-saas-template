import { describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";

// Type-only import: erased at runtime, so it does not pull in
// cms-navigation-repository.ts's top-level `getDB`/drizzle import (which would
// fail outside the Workers runtime this unit-test suite runs in).
import type { CmsNavigationTreeNode } from "./cms-navigation-repository";

vi.mock("server-only", () => ({}));

const { resolveDocsPage } = await import("./resolve-docs-page");

const DOCS_BASE_PATH = "/docs";
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

function findNodeByResolvedPath({
  path,
  nodes,
}: {
  path: string;
  nodes: CmsNavigationTreeNode[];
}): CmsNavigationTreeNode | null {
  for (const node of nodes) {
    if (node.resolvedPath === path) {
      return node;
    }
    const match = findNodeByResolvedPath({ path, nodes: node.children });
    if (match) {
      return match;
    }
  }
  return null;
}

// Test double for `GetCmsCollectionResult`: only the fields `resolveDocsPage`
// and its `getNavigationNodeDisplayTitle`-adjacent tests actually read.
function makeEntryStub({
  id,
  locale = DEFAULT_LOCALE,
  slug,
  title,
}: {
  id: string;
  locale?: Locale;
  slug: string;
  title: string;
}): CmsNavigationTreeNode["entry"] {
  return {
    id,
    collection: "docs",
    slug,
    title,
    locale,
    content: {},
    seoDescription: null,
    status: "published",
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updateCounter: 0,
    createdBy: "usr_test",
    featuredImageId: null,
    // oxlint-disable-next-line typescript/no-explicit-any
  } as any;
}

function makePageNode({
  id,
  resolvedPath,
  entry,
}: {
  id: string;
  resolvedPath: string;
  entry: CmsNavigationTreeNode["entry"];
}): CmsNavigationTreeNode {
  return {
    id,
    navigationKey: "docs",
    parentId: null,
    nodeType: "page",
    title: entry?.title ?? id,
    titleTranslations: null,
    entryId: entry?.id ?? null,
    slugSegment: resolvedPath.split("/").pop()!,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    updateCounter: 0,
    resolvedPath,
    entry,
    children: [],
  } as CmsNavigationTreeNode;
}

describe("resolveDocsPage", () => {
  test("returns a 'page' result (not a redirect) when the active locale has a translated entry", async () => {
    const translatedNode = makePageNode({
      id: "n1",
      resolvedPath: "/docs/foo",
      entry: makeEntryStub({
        id: "e1",
        locale: NON_DEFAULT_LOCALE,
        slug: "foo",
        title: "Translated Foo",
      }),
    });

    const result = await resolveDocsPage({
      slugParts: ["foo"],
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async ({ locale }) =>
        locale === NON_DEFAULT_LOCALE ? [translatedNode] : [],
      getNavigationRedirectByPath: async () => null,
      getNavigationRootPath: async () => null,
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result.type).toBe("page");
    if (result.type === "page") {
      expect(result.isFallback).toBe(false);
      expect(result.node.entry?.title).toBe("Translated Foo");
    }
  });

  test("falls back to the default-locale entry (isFallback=true) instead of redirecting when untranslated", async () => {
    const defaultNode = makePageNode({
      id: "n1",
      resolvedPath: "/docs/foo",
      entry: makeEntryStub({ id: "e1", slug: "foo", title: "Default Foo" }),
    });
    // The non-default tree prunes the untranslated node itself, but keeps an
    // unrelated translated sibling — an entirely empty tree is a different
    // code path (whole-navigation-missing), not "this one doc is untranslated".
    const translatedOtherNode = makePageNode({
      id: "other",
      resolvedPath: "/docs/other",
      entry: makeEntryStub({
        id: "e2",
        locale: NON_DEFAULT_LOCALE,
        slug: "other",
        title: "Translated Other",
      }),
    });

    const result = await resolveDocsPage({
      slugParts: ["foo"],
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async ({ locale }) =>
        locale === DEFAULT_LOCALE ? [defaultNode] : [translatedOtherNode],
      getNavigationRedirectByPath: async () => null,
      getNavigationRootPath: async () => null,
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result.type).toBe("page");
    if (result.type === "page") {
      expect(result.isFallback).toBe(true);
      expect(result.node.entry?.title).toBe("Default Foo");
    }
  });

  test("returns not-found when neither the active nor default locale has the node and there's no CMS redirect", async () => {
    // A non-empty, unrelated tree in both locales — the "navigationTree.length === 0"
    // branch is a different case (see below); this test targets the "node not
    // found within an otherwise-populated tree" path.
    const otherNode = makePageNode({
      id: "other",
      resolvedPath: "/docs/other",
      entry: makeEntryStub({ id: "e2", slug: "other", title: "Other" }),
    });

    const result = await resolveDocsPage({
      slugParts: ["missing"],
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async () => [otherNode],
      getNavigationRedirectByPath: async () => null,
      getNavigationRootPath: async () => null,
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result.type).toBe("not-found");
  });

  test("a CMS-configured redirect still applies when the node is missing in every locale", async () => {
    const otherNode = makePageNode({
      id: "other",
      resolvedPath: "/docs/other",
      entry: makeEntryStub({ id: "e2", slug: "other", title: "Other" }),
    });

    const result = await resolveDocsPage({
      slugParts: ["old-page"],
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async () => [otherNode],
      getNavigationRedirectByPath: async () => ({ toPath: "/docs/new-page", statusCode: 301 }),
      getNavigationRootPath: async () => null,
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result).toEqual({ type: "redirect", path: "/docs/new-page", permanent: true });
  });

  test("docs root (no slug parts) still redirects to the first navigable page (within-locale, not a loop)", async () => {
    const result = await resolveDocsPage({
      slugParts: undefined,
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async () => [],
      getNavigationRedirectByPath: async () => null,
      getNavigationRootPath: async () => "/docs/getting-started",
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result).toEqual({ type: "redirect", path: "/docs/getting-started", permanent: false });
  });
});
