import { afterEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

const {
  getDBMock,
  invalidateCmsSearchCacheMock,
  purgeMarkdownPageCacheMock,
  revalidateCacheTagMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  invalidateCmsSearchCacheMock: vi.fn(),
  purgeMarkdownPageCacheMock: vi.fn(async () => undefined),
  revalidateCacheTagMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/lib/cms/cms-search", () => ({
  invalidateCmsSearchCache: invalidateCmsSearchCacheMock,
  isCollectionSearchEnabled: (collectionSlug: string) => collectionSlug === "docs",
}));

// The KV sweep itself needs a Worker binding; its locale matrix is asserted in
// `cms-entry-revalidation.test.ts`, so here we only prove this call site reaches it.
vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

vi.mock("@/utils/cache", () => ({
  CACHE_TAGS: {
    SITEMAP: "sitemap",
    CMS_TAGS: "cms-tags",
    cmsCollection: (collectionSlug: string) => `cms-collection-${collectionSlug}`,
    cmsCollectionCount: (collectionSlug: string) => `cms-collection-count-${collectionSlug}`,
    cmsEntry: ({ collectionSlug, slug }: { collectionSlug: string; slug: string }) =>
      `cms-entry-${collectionSlug}-${slug}`,
    cmsNavigation: (navigationKey: string) => `cms-navigation-${navigationKey}`,
    cmsRedirect: (navigationKey: string) => `cms-redirect-${navigationKey}`,
  },
  revalidateCacheTag: revalidateCacheTagMock,
}));

const {
  invalidateAllCmsCaches,
  invalidateAllCmsCollectionCaches,
  invalidateCmsNavigationCachesForCollection,
} = await import("./cms-cache-invalidation");

/** The docs pages served by the `.md` page branch, so their KV copies hold the CMS sidebar. */
const DOCS_ROUTE_PAGE_PATHNAMES = INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname);

const COLLECTIONS_WITHOUT_NAVIGATION = collectionSlugs.filter(
  (collectionSlug) => !getCmsCollectionNavigationKey(collectionSlug),
);

describe("CMS cache invalidation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("clears all CMS collection caches by enumerating scoped tags", async () => {
    getDBMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn().mockResolvedValue([
          { collection: "blog", slug: "launch-notes" },
          { collection: "docs", slug: "getting-started" },
        ]),
      })),
    });

    await invalidateAllCmsCollectionCaches();

    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-blog");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-docs");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-count-blog");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-count-docs");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-entry-blog-launch-notes");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-entry-docs-getting-started");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-navigation-docs");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-redirect-docs");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("sitemap");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-tags");
    expect(revalidateCacheTagMock).not.toHaveBeenCalledWith("cms-entry");
    expect(revalidateCacheTagMock).not.toHaveBeenCalledWith("cms-collection");
    expect(revalidateCacheTagMock).not.toHaveBeenCalledWith("cms-navigation");
  });

  test("clears all CMS caches by clearing scoped collection and search caches", async () => {
    getDBMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn().mockResolvedValue([]),
      })),
    });

    await invalidateAllCmsCaches();

    expect(invalidateCmsSearchCacheMock).toHaveBeenCalledWith();
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-blog");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-docs");
  });

  test("a docs navigation change purges the page Markdown cache of the docs app routes", async () => {
    await invalidateCmsNavigationCachesForCollection({ collectionSlug: DOCS_SLUG });

    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledTimes(1);
    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledWith({
      pathnames: DOCS_ROUTE_PAGE_PATHNAMES,
    });
  });

  // Skipped in a fork where every collection owns a navigation: there is then nothing to over-purge.
  test.skipIf(COLLECTIONS_WITHOUT_NAVIGATION.length === 0)(
    "a collection that owns no navigation purges no page Markdown",
    async () => {
      for (const collectionSlug of COLLECTIONS_WITHOUT_NAVIGATION) {
        await invalidateCmsNavigationCachesForCollection({ collectionSlug });
      }

      expect(purgeMarkdownPageCacheMock).not.toHaveBeenCalled();
    },
  );
});
