import { afterEach, describe, expect, test, vi } from "vitest";

const {
  getDBMock,
  invalidateCmsSearchCacheMock,
  revalidateCacheTagMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  invalidateCmsSearchCacheMock: vi.fn(),
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
} = await import("./cms-cache-invalidation");

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
});
