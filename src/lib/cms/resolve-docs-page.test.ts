import { describe, expect, test, vi } from "vitest";

// Type-only import: erased at runtime, so it does not pull in
// cms-navigation-repository.ts's top-level `getDB`/drizzle import (which would
// fail outside the Workers runtime this unit-test suite runs in).
import type { CmsNavigationTreeNode } from "./cms-navigation-repository";

vi.mock("server-only", () => ({}));

const { resolveDocsPage } = await import("./resolve-docs-page");

const DOCS_BASE_PATH = "/docs";

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
  slug,
  title,
}: {
  id: string;
  slug: string;
  title: string;
}): CmsNavigationTreeNode["entry"] {
  return {
    id,
    collection: "docs",
    slug,
    title,
    locale: "en",
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
    const esNode = makePageNode({
      id: "n1",
      resolvedPath: "/docs/foo",
      entry: makeEntryStub({ id: "e1", slug: "foo", title: "Foo (ES)" }),
    });

    const result = await resolveDocsPage({
      slugParts: ["foo"],
      locale: "es",
      defaultLocale: "en",
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async ({ locale }) => (locale === "es" ? [esNode] : []),
      getNavigationRedirectByPath: async () => null,
      getNavigationRootPath: async () => null,
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result.type).toBe("page");
    if (result.type === "page") {
      expect(result.isFallback).toBe(false);
      expect(result.node.entry?.title).toBe("Foo (ES)");
    }
  });

  test("falls back to the default-locale entry (isFallback=true) instead of redirecting when untranslated", async () => {
    const enNode = makePageNode({
      id: "n1",
      resolvedPath: "/docs/foo",
      entry: makeEntryStub({ id: "e1", slug: "foo", title: "Foo (EN)" }),
    });
    // The es-scoped tree prunes the untranslated node itself, but keeps an
    // unrelated translated sibling — an entirely empty tree is a different
    // code path (whole-navigation-missing), not "this one doc is untranslated".
    const esOtherNode = makePageNode({
      id: "other",
      resolvedPath: "/docs/other",
      entry: makeEntryStub({ id: "e2", slug: "other", title: "Other (ES)" }),
    });

    const result = await resolveDocsPage({
      slugParts: ["foo"],
      locale: "es",
      defaultLocale: "en",
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async ({ locale }) => (locale === "en" ? [enNode] : [esOtherNode]),
      getNavigationRedirectByPath: async () => null,
      getNavigationRootPath: async () => null,
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result.type).toBe("page");
    if (result.type === "page") {
      expect(result.isFallback).toBe(true);
      expect(result.node.entry?.title).toBe("Foo (EN)");
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
      locale: "es",
      defaultLocale: "en",
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
      locale: "es",
      defaultLocale: "en",
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
      locale: "es",
      defaultLocale: "en",
      docsBasePath: DOCS_BASE_PATH,
      getNavigationTree: async () => [],
      getNavigationRedirectByPath: async () => null,
      getNavigationRootPath: async () => "/docs/getting-started",
      getNodeByResolvedPath: findNodeByResolvedPath,
    });

    expect(result).toEqual({ type: "redirect", path: "/docs/getting-started", permanent: false });
  });
});
