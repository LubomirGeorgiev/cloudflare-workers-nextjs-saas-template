import { afterEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { CACHE_TAGS } from "@/constants/cache-tags";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { CMS_TAGS_PAGE_PATH } from "@/lib/blog-routing";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

const {
  getDBMock,
  purgeCmsEntryEdgeHtmlPagesMock,
  purgeCmsEntryMarkdownPagesMock,
  purgeMarkdownPageCacheMock,
  purgeWorkersCacheAfterWriteMock,
  revalidateCacheTagMock,
  spans,
  warmCmsEntryPagesMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  purgeCmsEntryEdgeHtmlPagesMock: vi.fn(async () => undefined),
  purgeCmsEntryMarkdownPagesMock: vi.fn(async (__input: unknown) => undefined),
  purgeMarkdownPageCacheMock: vi.fn(async (__input: unknown) => undefined),
  purgeWorkersCacheAfterWriteMock: vi.fn(async (__input: { tags: readonly string[] }) => undefined),
  revalidateCacheTagMock: vi.fn(async (__tag: string): Promise<void> => undefined),
  spans: [] as Array<{ name: string; attributes: Record<string, unknown> }>,
  warmCmsEntryPagesMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/trace", () => ({
  withSpan: ({ name, run }: { name: string; run: (span: unknown) => Promise<unknown> }) => {
    const record = { name, attributes: {} as Record<string, unknown> };
    const span = {
      isTraced: true,
      setAttributes: (values: Record<string, unknown>) => {
        Object.assign(record.attributes, values);
        return span;
      },
    };

    spans.push(record);
    return run(span);
  },
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/lib/cms/cms-search", async () => {
  const { CACHE_TAGS: tags } = await import("@/constants/cache-tags");

  return {
    getCmsSearchCacheTags: (collectionSlug?: string) =>
      [collectionSlug ?? "docs"].map((slug) => tags.cmsSearchCollection(slug)),
    isCollectionSearchEnabled: (collectionSlug: string) => collectionSlug === "docs",
  };
});

// The purge helper's own branches are asserted in `workers-cache-purge.test.ts`; here we only prove
// each path sends one purge, after the KV tags and before the warm.
vi.mock("@/lib/edge/purge-workers-cache-after-write", () => ({
  purgeWorkersCacheAfterWrite: purgeWorkersCacheAfterWriteMock,
}));

// The KV sweep itself needs a Worker binding; its locale matrix is asserted in
// `cms-entry-markdown-page-purge.test.ts`, so here we only prove this call site reaches it.
vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

// The Cache API and KV need a Worker runtime; the key matrices are asserted in
// `tests/integration/worker-edge.test.ts` and `cms-entry-markdown-page-purge.test.ts`.
vi.mock("@/lib/cms/cms-entry-page-purge", () => ({
  purgeCmsEntryEdgeHtmlPages: purgeCmsEntryEdgeHtmlPagesMock,
  purgeCmsEntryMarkdownPages: purgeCmsEntryMarkdownPagesMock,
}));

// The warmer's own URL matrix is asserted in `warm-cms-pages.test.ts`; here we only prove the
// publish path reaches it, and only after the tags are gone.
vi.mock("@/lib/cms/warm-cms-pages", () => ({
  warmCmsEntryPages: warmCmsEntryPagesMock,
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
    cmsSearchCollection: (collectionSlug: string) => `cms-search-${collectionSlug}`,
  },
  revalidateCacheTag: revalidateCacheTagMock,
}));

const {
  invalidateAllCmsCaches,
  invalidateCmsEntries,
  invalidateCmsTagGroupCaches,
  invalidateEntryAndCollection,
} = await import("./cms-cache-invalidation");

function mockAllEntryRefs(entries: Array<{ collection: string; slug: string }>): void {
  getDBMock.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn().mockResolvedValue(entries),
    })),
  });
}

// Holds every KV tag drop open until the returned function runs.
function holdKvTagDrops(): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  revalidateCacheTagMock.mockImplementation(() => held);
  return release;
}

function purgedTags(): string[] {
  return purgeWorkersCacheAfterWriteMock.mock.calls.flatMap(([{ tags }]) => [...tags]);
}

/** The docs pages served by the `.md` page branch, so their KV copies hold the CMS sidebar. */
const DOCS_ROUTE_PAGE_PATHNAMES = INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname);

const DOCS_NAVIGATION_KEY = getCmsCollectionNavigationKey(DOCS_SLUG);

const COLLECTIONS_WITHOUT_NAVIGATION = collectionSlugs.filter(
  (collectionSlug) => !getCmsCollectionNavigationKey(collectionSlug),
);

describe("CMS cache invalidation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    revalidateCacheTagMock.mockImplementation(async () => undefined);
    spans.length = 0;
  });

  test("clears all CMS collection caches by enumerating scoped tags", async () => {
    mockAllEntryRefs([
      { collection: "blog", slug: "launch-notes" },
      { collection: "docs", slug: "getting-started" },
    ]);

    await invalidateAllCmsCaches();

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
    mockAllEntryRefs([]);

    await invalidateAllCmsCaches();

    expect(revalidateCacheTagMock).toHaveBeenCalledWith(CACHE_TAGS.cmsSearchCollection(DOCS_SLUG));
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-blog");
    expect(revalidateCacheTagMock).toHaveBeenCalledWith("cms-collection-docs");
  });

  test.skipIf(!DOCS_NAVIGATION_KEY)("a docs entry write purges the page Markdown cache of the docs app routes", async () => {
    await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "getting-started" });

    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledTimes(1);
    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledWith({
      pathnames: DOCS_ROUTE_PAGE_PATHNAMES,
    });
  });

  // The warm fetches the page through the edge, so a stored copy that outlives the purge is what
  // the warm would read back and re-store.
  test("an entry publish drops the tags and the stored page before it warms", async () => {
    const collectionSlug = collectionSlugs[0];
    const entries = [{ collection: collectionSlug, slug: "launch-notes" }];

    warmCmsEntryPagesMock.mockImplementationOnce(() => {
      expect(revalidateCacheTagMock).toHaveBeenCalledWith(
        `cms-entry-${collectionSlug}-launch-notes`,
      );
      expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledWith({ entries });
    });

    await invalidateEntryAndCollection({ collectionSlug, slug: "launch-notes", warm: true });

    expect(warmCmsEntryPagesMock).toHaveBeenCalledWith({ entries });
  });

  // A rename leaves the old slug's page stored and its tag live, but only the new slug resolves.
  test("`alsoPurgeSlugs` purges and invalidates every slug and warms only the entry slug", async () => {
    const collectionSlug = collectionSlugs[0];

    await invalidateEntryAndCollection({
      collectionSlug,
      slug: "new-slug",
      alsoPurgeSlugs: ["old-slug"],
      warm: true,
    });

    expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledTimes(1);
    expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledWith({
      entries: [
        { collection: collectionSlug, slug: "new-slug" },
        { collection: collectionSlug, slug: "old-slug" },
      ],
    });
    expect(revalidateCacheTagMock).toHaveBeenCalledWith(`cms-entry-${collectionSlug}-old-slug`);
    expect(revalidateCacheTagMock).toHaveBeenCalledWith(`cms-entry-${collectionSlug}-new-slug`);
    expect(warmCmsEntryPagesMock).toHaveBeenCalledWith({
      entries: [{ collection: collectionSlug, slug: "new-slug" }],
    });
  });

  // A delete or a draft save drops the same tags, but warming there would fetch a 404.
  test("an invalidation without `warm` never reaches the warmer", async () => {
    await invalidateEntryAndCollection({ collectionSlug: collectionSlugs[0], slug: "launch-notes" });

    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
  });

  // Skipped in a fork where every collection owns a navigation: there is then nothing to over-purge.
  test.skipIf(COLLECTIONS_WITHOUT_NAVIGATION.length === 0)(
    "a collection that owns no navigation purges no page Markdown",
    async () => {
      for (const collectionSlug of COLLECTIONS_WITHOUT_NAVIGATION) {
        await invalidateEntryAndCollection({ collectionSlug, slug: "launch-notes" });
      }

      expect(purgeMarkdownPageCacheMock).not.toHaveBeenCalled();
    },
  );

  test("an entry invalidation records its collection, slug count, and warm flag, but no slug", async () => {
    const collectionSlug = collectionSlugs[0];

    await invalidateEntryAndCollection({
      collectionSlug,
      slug: "new-slug",
      alsoPurgeSlugs: ["old-slug", "new-slug"],
      warm: true,
    });

    expect(spans).toEqual([{
      name: "app.cms.invalidate",
      attributes: {
        "app.cms.collection": collectionSlug,
        "app.cms.slug_count": 2,
        "app.cms.warm": true,
      },
    }]);
  });

  test("a failed invalidation still rejects through the span", async () => {
    const failure = new Error("cache tag purge failed");
    purgeCmsEntryEdgeHtmlPagesMock.mockRejectedValueOnce(failure);

    await expect(
      invalidateEntryAndCollection({ collectionSlug: collectionSlugs[0], slug: "launch-notes", warm: true }),
    ).rejects.toBe(failure);
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
    expect(spans[0]?.attributes["app.cms.warm"]).toBe(true);
  });
  // The edge refetches on a miss, so it must read the new KV data; the warm must miss the edge.
  test("an entry publish drops the KV tags, then purges Workers Caching, then warms", async () => {
    const collectionSlug = DOCS_SLUG;
    const entryTag = CACHE_TAGS.cmsEntry({ collectionSlug, slug: "launch-notes" });

    purgeWorkersCacheAfterWriteMock.mockImplementationOnce(async ({ tags }) => {
      for (const tag of tags) {
        expect(revalidateCacheTagMock).toHaveBeenCalledWith(tag);
      }
      expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
    });

    await invalidateEntryAndCollection({ collectionSlug, slug: "launch-notes", warm: true });

    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
    expect(purgedTags()).toEqual(expect.arrayContaining([
      entryTag,
      CACHE_TAGS.cmsCollection(collectionSlug),
      CACHE_TAGS.cmsCollectionCount(collectionSlug),
      CACHE_TAGS.SITEMAP,
      CACHE_TAGS.CMS_TAGS,
      CACHE_TAGS.cmsSearchCollection(collectionSlug),
    ]));
    expect(warmCmsEntryPagesMock).toHaveBeenCalledTimes(1);
    expect(purgeWorkersCacheAfterWriteMock.mock.invocationCallOrder[0]).toBeLessThan(
      warmCmsEntryPagesMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // One tag list: a tag added to the KV drop must reach the edge purge too.
  test("an entry write purges Workers Caching by exactly the tags it dropped from KV", async () => {
    await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "launch-notes" });

    expect(new Set(purgedTags())).toEqual(
      new Set(revalidateCacheTagMock.mock.calls.map(([tag]) => tag)),
    );
  });

  test.skipIf(!DOCS_NAVIGATION_KEY)(
    "an entry publish purges the navigation tags of a collection that owns a navigation",
    async () => {
      const navigationKey = DOCS_NAVIGATION_KEY ?? "";

      await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "launch-notes" });

      expect(purgedTags()).toEqual(expect.arrayContaining([
        CACHE_TAGS.cmsNavigation(navigationKey),
        CACHE_TAGS.cmsRedirect(navigationKey),
      ]));
    },
  );

  test("a tag group write purges Workers Caching once, by the tags it dropped from KV", async () => {
    const entryRefs = [{ collection: collectionSlugs[0], slug: "launch-notes" }];

    purgeWorkersCacheAfterWriteMock.mockImplementationOnce(async ({ tags }) => {
      for (const tag of tags) {
        expect(revalidateCacheTagMock).toHaveBeenCalledWith(tag);
      }
    });

    await invalidateCmsTagGroupCaches({ entryRefs });

    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
    expect(new Set(purgedTags())).toEqual(new Set([
      CACHE_TAGS.CMS_TAGS,
      CACHE_TAGS.SITEMAP,
      CACHE_TAGS.cmsEntry({ collectionSlug: collectionSlugs[0], slug: "launch-notes" }),
      CACHE_TAGS.cmsCollection(collectionSlugs[0]),
    ]));
  });

  // The edge purge drops the listing `.md` twins too, so their KV copies must go first.
  test("a tag group write drops the `.md` twins of the tag pages and listings before the edge purge", async () => {
    const entryRefs = [{ collection: collectionSlugs[0], slug: "launch-notes" }];

    purgeWorkersCacheAfterWriteMock.mockImplementationOnce(async () => {
      expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledWith({
        entries: entryRefs,
        alsoPathnames: [CMS_TAGS_PAGE_PATH],
      });
    });

    await invalidateCmsTagGroupCaches({ entryRefs });

    expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledTimes(1);
    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
  });

  // A `.md` miss renders from the KV tags, so a twin deleted before the drop would refill stale.
  test("a tag group write waits for the KV tag drop before it deletes the `.md` twins", async () => {
    const release = holdKvTagDrops();
    const pending = invalidateCmsTagGroupCaches({
      entryRefs: [{ collection: collectionSlugs[0], slug: "launch-notes" }],
    });

    await vi.waitFor(() => expect(revalidateCacheTagMock).toHaveBeenCalled());
    expect(purgeCmsEntryMarkdownPagesMock).not.toHaveBeenCalled();
    expect(purgeWorkersCacheAfterWriteMock).not.toHaveBeenCalled();

    release();
    await pending;

    expect(purgeCmsEntryMarkdownPagesMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeWorkersCacheAfterWriteMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // An edge miss on a `.md` twin reads its KV copy, so the KV copy must be gone before the edge
  // purge, and the warm must come after both.
  test("an entry publish drops KV and the `.md` twins, then purges Workers Caching, then warms", async () => {
    const collectionSlug = collectionSlugs[0];
    const entries = [{ collection: collectionSlug, slug: "launch-notes" }];

    await invalidateEntryAndCollection({ collectionSlug, slug: "launch-notes", warm: true });

    const tagOrder = revalidateCacheTagMock.mock.invocationCallOrder;
    const htmlOrder = purgeCmsEntryEdgeHtmlPagesMock.mock.invocationCallOrder[0] ?? Infinity;
    const markdownOrder = purgeCmsEntryMarkdownPagesMock.mock.invocationCallOrder[0] ?? Infinity;
    const edgeOrder = purgeWorkersCacheAfterWriteMock.mock.invocationCallOrder[0] ?? Infinity;
    const warmOrder = warmCmsEntryPagesMock.mock.invocationCallOrder[0] ?? Infinity;

    expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledWith({ entries });
    expect(Math.max(...tagOrder)).toBeLessThan(htmlOrder);
    expect(htmlOrder).toBeLessThan(markdownOrder);
    expect(markdownOrder).toBeLessThan(edgeOrder);
    expect(edgeOrder).toBeLessThan(warmOrder);
  });

  test("a multi-entry write sends one Workers Caching purge with the tags of every entry", async () => {
    const [firstCollection, secondCollection = firstCollection] = collectionSlugs;
    const entries = [
      { collection: firstCollection, slug: "first" },
      { collection: secondCollection, slug: "second" },
      { collection: firstCollection, slug: "first" },
    ];

    await invalidateCmsEntries({ entries });

    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
    expect(purgedTags()).toEqual(expect.arrayContaining([
      CACHE_TAGS.cmsEntry({ collectionSlug: firstCollection, slug: "first" }),
      CACHE_TAGS.cmsEntry({ collectionSlug: secondCollection, slug: "second" }),
      CACHE_TAGS.cmsCollection(firstCollection),
      CACHE_TAGS.cmsCollection(secondCollection),
    ]));
    expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledTimes(1);
    expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledTimes(1);
    expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledWith({ entries: entries.slice(0, 2) });
    expect(spans[0]?.attributes["app.cms.slug_count"]).toBe(2);
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
  });

  test("an empty multi-entry write does nothing", async () => {
    await invalidateCmsEntries({ entries: [] });

    expect(spans).toEqual([]);
    expect(purgeWorkersCacheAfterWriteMock).not.toHaveBeenCalled();
  });

  test("a full CMS clear purges Workers Caching once, after the KV and search tags", async () => {
    mockAllEntryRefs([{ collection: DOCS_SLUG, slug: "getting-started" }]);
    purgeWorkersCacheAfterWriteMock.mockImplementationOnce(async ({ tags }) => {
      for (const tag of tags) {
        expect(revalidateCacheTagMock).toHaveBeenCalledWith(tag);
      }
    });

    await invalidateAllCmsCaches();

    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
    expect(purgedTags()).toEqual(expect.arrayContaining([
      CACHE_TAGS.cmsEntry({ collectionSlug: DOCS_SLUG, slug: "getting-started" }),
      CACHE_TAGS.SITEMAP,
      CACHE_TAGS.CMS_TAGS,
      CACHE_TAGS.cmsSearchCollection(DOCS_SLUG),
      ...collectionSlugs.map((collectionSlug) => CACHE_TAGS.cmsCollection(collectionSlug)),
    ]));
  });

  // An edge miss on a `.md` twin reads its KV copy, so a full clear must drop those copies after
  // the KV tags and before its edge purge.
  test("a full CMS clear drops the KV tags, then the `.md` twins, then purges Workers Caching", async () => {
    const entries = [{ collection: collectionSlugs[0], slug: "launch-notes" }];
    mockAllEntryRefs(entries);

    await invalidateAllCmsCaches();

    const tagOrder = revalidateCacheTagMock.mock.invocationCallOrder;
    const entryMarkdownOrder = purgeCmsEntryMarkdownPagesMock.mock.invocationCallOrder[0] ?? Infinity;
    const docsMarkdownOrder = purgeMarkdownPageCacheMock.mock.invocationCallOrder[0] ?? Infinity;
    const edgeOrder = purgeWorkersCacheAfterWriteMock.mock.invocationCallOrder[0] ?? Infinity;

    expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledWith({
      entries,
      alsoPathnames: [CMS_TAGS_PAGE_PATH],
    });
    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledWith({ pathnames: DOCS_ROUTE_PAGE_PATHNAMES });
    expect(Math.max(...tagOrder)).toBeLessThan(Math.min(entryMarkdownOrder, docsMarkdownOrder));
    expect(Math.max(entryMarkdownOrder, docsMarkdownOrder)).toBeLessThan(edgeOrder);
  });

  test("a failed page purge sends no Workers Caching purge", async () => {
    purgeCmsEntryEdgeHtmlPagesMock.mockRejectedValueOnce(new Error("stored page purge failed"));

    await expect(
      invalidateEntryAndCollection({ collectionSlug: collectionSlugs[0], slug: "launch-notes" }),
    ).rejects.toThrow();
    expect(purgeWorkersCacheAfterWriteMock).not.toHaveBeenCalled();
  });

  // A failed tag drop must not leave the other tags, the stored pages, or the edge stale.
  test("a failed KV tag drop still drops the other tags, purges the pages and the edge, then rejects", async () => {
    const collectionSlug = collectionSlugs[0];
    const entries = [{ collection: collectionSlug, slug: "launch-notes" }];
    const failedTag = CACHE_TAGS.cmsEntry({ collectionSlug, slug: "launch-notes" });
    const failure = new Error("KV tag drop failed");

    revalidateCacheTagMock.mockImplementation(async (tag) => {
      if (tag === failedTag) {
        throw failure;
      }
    });

    await expect(
      invalidateEntryAndCollection({ collectionSlug, slug: "launch-notes", warm: true }),
    ).rejects.toBe(failure);

    const droppedTags = revalidateCacheTagMock.mock.calls.map(([tag]) => tag);

    expect(droppedTags).toEqual(expect.arrayContaining([
      failedTag,
      CACHE_TAGS.cmsCollection(collectionSlug),
      CACHE_TAGS.SITEMAP,
      CACHE_TAGS.CMS_TAGS,
    ]));
    expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledWith({ entries });
    expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledWith({ entries });
    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
    expect(new Set(purgedTags())).toEqual(new Set(droppedTags));
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
  });
});
