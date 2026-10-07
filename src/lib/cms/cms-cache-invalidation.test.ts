import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsNavigationKeys, collectionSlugs } from "@/../cms.config";
import { CACHE_TAGS } from "@/constants/cache-tags";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import {
  CMS_ENTRY_CHANGES,
  CMS_INVALIDATION_SCOPES,
  PUBLISH_STATE_CHANGES,
  SITE_HEADER_CACHE_TAGS,
  SITE_HEADER_NAVIGATION_KEY,
} from "@/lib/cms/cms-invalidation-scopes";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

interface PurgeCmsPagesInput {
  entries: unknown[];
  knownPagePathnames?: string[];
  navigationKeys: string[];
  readAllEntryRefs: () => Promise<unknown[]>;
  scopes: string[];
}

const {
  enqueueCmsRepurgeMock,
  getDBMock,
  getFreshCmsNavigationLivePageCountMock,
  getFreshPublishedBlogPostCountMock,
  purgeCmsPagesMock,
  purgeWorkersCacheAfterWriteMock,
  revalidateCacheTagMock,
  spans,
  warmCmsEntryPagesMock,
} = vi.hoisted(() => ({
  enqueueCmsRepurgeMock: vi.fn(
    async (__input: {
      entries: unknown[];
      entryChange: string;
      knownPagePathnames: string[];
      navigationKeys: string[];
      scopes: string[];
      delaySeconds: number;
    }): Promise<void> => undefined,
  ),
  getDBMock: vi.fn(),
  // Many live docs pages and posts by default, so a write does not flip a header link.
  getFreshCmsNavigationLivePageCountMock: vi.fn(async (__input: { navigationKey: string }): Promise<number> => 100),
  getFreshPublishedBlogPostCountMock: vi.fn(async (): Promise<number> => 100),
  purgeCmsPagesMock: vi.fn(async (__input: PurgeCmsPagesInput): Promise<string> => "ok"),
  purgeWorkersCacheAfterWriteMock: vi.fn(
    async (__input: { tags: readonly string[] }): Promise<string | undefined> => "ok",
  ),
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
      setAttribute: (key: string, value: unknown) => {
        record.attributes[key] = value;
        return span;
      },
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

// The page targets are asserted in `cms-entry-page-purge.test.ts`; here we only prove what this
// pipeline hands the page step, and when.
vi.mock("@/lib/cms/cms-entry-page-purge", () => ({
  purgeCmsPages: purgeCmsPagesMock,
}));

// The D1 read is asserted in `tests/integration/cms-page-purge-reads.test.ts`.
vi.mock("@/lib/cms/cms-navigation-tree-query", () => ({
  getFreshCmsNavigationLivePageCount: getFreshCmsNavigationLivePageCountMock,
}));

vi.mock("@/lib/blog-visibility", () => ({
  getFreshPublishedBlogPostCount: getFreshPublishedBlogPostCountMock,
}));

// The warmer's own URL matrix is asserted in `warm-cms-pages.test.ts`; here we only prove the
// publish path reaches it, and only after the tags are gone.
vi.mock("@/lib/cms/warm-cms-pages", () => ({
  warmCmsEntryPages: warmCmsEntryPagesMock,
}));

// The queue message shape is asserted in `job-handlers.test.ts` and the integration write path.
vi.mock("@/lib/scheduler/enqueue", () => ({
  enqueueCmsRepurge: enqueueCmsRepurgeMock,
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
  invalidateCmsNavigationCaches,
  invalidateCmsTagGroupCaches,
  invalidateDeletedCmsEntry,
  invalidateEntryAndCollection,
  repurgeCmsCaches,
} = await import("./cms-cache-invalidation");
const { withCmsCachePurgeReport } = await import("./cms-cache-purge-report");
const { EDGE_HTML_ZONE_PURGE_OUTCOME } = await import("@/constants/edge-html-cache");
const {
  CMS_CACHE_PURGE_OK,
  CMS_PURGE_STATUS,
  WORKERS_CACHE_PURGE_OUTCOME,
} = await import("@/constants/cache-purge");

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

const DOCS_NAVIGATION_KEY = getCmsCollectionNavigationKey(DOCS_SLUG);

const BLOG_ENTRY = { collection: BLOG_COLLECTION_SLUG, slug: "launch-notes" };

const { PUBLISHED, UNPUBLISHED } = PUBLISH_STATE_CHANGES;

// Without the read callback: each pass builds its own, so two passes never share one.
function pageStepInput(call = 0): Omit<PurgeCmsPagesInput, "readAllEntryRefs"> | undefined {
  const input = purgeCmsPagesMock.mock.calls[call]?.[0];

  if (!input) {
    return undefined;
  }

  const { readAllEntryRefs: __read, ...rest } = input;
  return rest;
}

function repurgeInput() {
  return enqueueCmsRepurgeMock.mock.calls[0]?.[0];
}

describe("CMS cache invalidation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    revalidateCacheTagMock.mockImplementation(async () => undefined);
    getFreshPublishedBlogPostCountMock.mockImplementation(async () => 100);
    getFreshCmsNavigationLivePageCountMock.mockImplementation(async () => 100);
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

  // The page step gets the entry rows from `readAllEntryRefs`, so its input names no entry.
  test("a full CMS clear purges the pages by scope, and queues its delayed repeat", async () => {
    mockAllEntryRefs([{ collection: DOCS_SLUG, slug: "getting-started" }]);

    await invalidateAllCmsCaches();

    expect(pageStepInput()).toEqual({
      entries: [],
      knownPagePathnames: [],
      navigationKeys: [],
      scopes: [CMS_INVALIDATION_SCOPES.ALL_CMS],
    });
    expect(repurgeInput()).toMatchObject({
      entries: [],
      navigationKeys: [],
      scopes: [CMS_INVALIDATION_SCOPES.ALL_CMS],
    });
  });

  // The tags and the page step both need every entry row, and D1 gets one read for the two.
  test("a full CMS clear reads the entry rows once for its tags and its page step", async () => {
    const rows = [{ collection: BLOG_COLLECTION_SLUG, slug: "launch-notes", status: "published" }];
    mockAllEntryRefs(rows);
    purgeCmsPagesMock.mockImplementationOnce(async ({ readAllEntryRefs }) => {
      await expect(readAllEntryRefs()).resolves.toEqual(rows);
      return "ok";
    });

    await invalidateAllCmsCaches();

    expect(purgeCmsPagesMock).toHaveBeenCalledOnce();
    expect(getDBMock).toHaveBeenCalledOnce();
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
      expect(pageStepInput()?.entries).toEqual(entries);
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

    expect(purgeCmsPagesMock).toHaveBeenCalledTimes(1);
    expect(pageStepInput()?.entries).toEqual([
      { collection: collectionSlug, slug: "new-slug" },
      { collection: collectionSlug, slug: "old-slug" },
    ]);
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

  test("an entry invalidation records its collection, slug count, warm flag, pass, and scopes, but no slug", async () => {
    const collectionSlug = DOCS_SLUG;

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
        "app.cms.pass": "initial",
        "app.cms.scopes": "none",
        "app.cms.navigation": "none",
        "app.cms.edge_html.zone_purge": "ok",
        "app.cms.repurge.outcome": "scheduled",
      },
    }]);
  });

  // The editor must hear that other data centers keep the old page.
  test("a failed zone purge of the page step reaches the tracked write", async () => {
    purgeCmsPagesMock.mockResolvedValueOnce(EDGE_HTML_ZONE_PURGE_OUTCOME.FAILED);

    const failed = await withCmsCachePurgeReport(async () => ({
      returned: await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "launch-notes" }),
    }));
    const clean = await withCmsCachePurgeReport(async () => ({
      returned: await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "launch-notes" }),
    }));

    const zoneFailed = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };
    expect(failed).toEqual({ returned: zoneFailed, cachePurge: zoneFailed });
    expect(clean).toEqual({ returned: CMS_CACHE_PURGE_OK, cachePurge: CMS_CACHE_PURGE_OK });
  });

  // The pipeline used to drop this outcome, so only the media delete warned about it.
  test("a failed Workers Caching purge reaches the returned and the tracked outcome", async () => {
    purgeWorkersCacheAfterWriteMock.mockResolvedValueOnce(WORKERS_CACHE_PURGE_OUTCOME.FAILED);

    const tracked = await withCmsCachePurgeReport(async () => ({
      returned: await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "launch-notes" }),
    }));

    const workersCacheFailed = { ...CMS_CACHE_PURGE_OK, workersCache: CMS_PURGE_STATUS.FAILED };
    expect(tracked).toEqual({ returned: workersCacheFailed, cachePurge: workersCacheFailed });
  });

  // The queue consumer retries on this outcome, so the delayed pass must return it, not drop it.
  test("the delayed pass returns a failed purge instead of losing it", async () => {
    purgeCmsPagesMock.mockResolvedValueOnce(EDGE_HTML_ZONE_PURGE_OUTCOME.UNCONFIGURED);
    purgeWorkersCacheAfterWriteMock.mockResolvedValueOnce(WORKERS_CACHE_PURGE_OUTCOME.FAILED);

    await expect(repurgeCmsCaches({
      entries: [BLOG_ENTRY],
      entryChange: CMS_ENTRY_CHANGES.CONTENT,
      knownPagePathnames: [],
      navigationKeys: [],
      scopes: [],
    }))
      .resolves.toEqual({ zone: CMS_PURGE_STATUS.UNCONFIGURED, workersCache: CMS_PURGE_STATUS.FAILED });
  });

  // A render in another isolate can still read old KV data after the first purge, and store it.
  test("an entry write queues one delayed repeat of its purge, after the warm", async () => {
    const collectionSlug = collectionSlugs[0];

    await invalidateEntryAndCollection({
      collectionSlug,
      slug: "new-slug",
      alsoPurgeSlugs: ["old-slug"],
      warm: true,
    });

    expect(enqueueCmsRepurgeMock).toHaveBeenCalledOnce();
    expect(repurgeInput()).toMatchObject({
      entries: [
        { collection: collectionSlug, slug: "new-slug" },
        { collection: collectionSlug, slug: "old-slug" },
      ],
      navigationKeys: [],
    });
    expect(repurgeInput()?.delaySeconds).toBeGreaterThan(0);
    expect(warmCmsEntryPagesMock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueCmsRepurgeMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("a queue fault does not fail the write, and the span records it", async () => {
    enqueueCmsRepurgeMock.mockRejectedValueOnce(new Error("queue down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(invalidateEntryAndCollection({
        collectionSlug: collectionSlugs[0],
        slug: "launch-notes",
      })).resolves.toEqual(CMS_CACHE_PURGE_OK);
      expect(consoleError).toHaveBeenCalledOnce();
      expect(spans[0]?.attributes["app.cms.repurge.outcome"]).toBe("failed");
    } finally {
      consoleError.mockRestore();
    }
  });

  // The delayed pass must not warm (the warm is what stored the old copy) and must not loop.
  test("the delayed pass repeats the same purge, without a warm or another delayed pass", async () => {
    const entries = [BLOG_ENTRY];

    getFreshPublishedBlogPostCountMock.mockResolvedValueOnce(1);
    await invalidateCmsEntries({ entries, warmEntries: entries, publishStateChange: PUBLISHED });
    const firstPassTags = purgedTags();
    const firstPageStep = pageStepInput();
    const { delaySeconds: __delay, ...target } = repurgeInput() ?? { delaySeconds: 0 };
    vi.clearAllMocks();
    spans.length = 0;

    await repurgeCmsCaches(target as Parameters<typeof repurgeCmsCaches>[0]);

    expect(pageStepInput()).toEqual(firstPageStep);
    expect(purgedTags()).toEqual(firstPassTags);
    expect(getFreshPublishedBlogPostCountMock).not.toHaveBeenCalled();
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
    expect(enqueueCmsRepurgeMock).not.toHaveBeenCalled();
    expect(spans[0]?.attributes["app.cms.pass"]).toBe("delayed");
    expect(spans[0]?.attributes).not.toHaveProperty("app.cms.repurge.outcome");
  });

  test("a failed invalidation still rejects through the span", async () => {
    const failure = new Error("cache tag purge failed");
    purgeCmsPagesMock.mockRejectedValueOnce(failure);

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

  describe("the header blog link", () => {
    // The first publish or the last unpublish changes every page that renders the header.
    test("the last blog unpublish purges every header page and queues it again", async () => {
      getFreshPublishedBlogPostCountMock.mockResolvedValueOnce(0);

      await invalidateEntryAndCollection({
        collectionSlug: BLOG_ENTRY.collection,
        slug: BLOG_ENTRY.slug,
        publishStateChange: UNPUBLISHED,
      });

      expect(pageStepInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
      expect(purgedTags()).toEqual(expect.arrayContaining([...SITE_HEADER_CACHE_TAGS]));
      expect(repurgeInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
      expect(spans[0]?.attributes["app.cms.scopes"]).toBe(CMS_INVALIDATION_SCOPES.SITE_HEADER);
    });

    test("the first blog publish purges every header page", async () => {
      getFreshPublishedBlogPostCountMock.mockResolvedValueOnce(1);

      await invalidateEntryAndCollection({
        collectionSlug: BLOG_ENTRY.collection,
        slug: BLOG_ENTRY.slug,
        publishStateChange: PUBLISHED,
      });

      expect(pageStepInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
    });

    test("a blog publish with other published posts leaves the header pages alone", async () => {
      getFreshPublishedBlogPostCountMock.mockResolvedValueOnce(5);

      await invalidateEntryAndCollection({
        collectionSlug: BLOG_ENTRY.collection,
        slug: BLOG_ENTRY.slug,
        publishStateChange: PUBLISHED,
      });

      expect(pageStepInput()?.scopes).toEqual([]);
      expect(repurgeInput()?.scopes).toEqual([]);
    });

    test("a failed count purges the header pages, and logs", async () => {
      getFreshPublishedBlogPostCountMock.mockRejectedValueOnce(new Error("D1 down"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        await invalidateEntryAndCollection({
          collectionSlug: BLOG_ENTRY.collection,
          slug: BLOG_ENTRY.slug,
          publishStateChange: UNPUBLISHED,
        });

        expect(pageStepInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
        expect(consoleError).toHaveBeenCalledOnce();
      } finally {
        consoleError.mockRestore();
      }
    });

    // The only post of the blog: a count check would say "may flip", but the edit changes no status.
    test("a content edit of the only post never reads the count or purges the header pages", async () => {
      getFreshPublishedBlogPostCountMock.mockResolvedValue(1);

      await invalidateEntryAndCollection({ collectionSlug: BLOG_ENTRY.collection, slug: BLOG_ENTRY.slug, warm: true });

      expect(getFreshPublishedBlogPostCountMock).not.toHaveBeenCalled();
      expect(pageStepInput()?.scopes).toEqual([]);
      expect(repurgeInput()?.scopes).toEqual([]);
    });

    // The author write passes every published entry of the author, which is the whole blog here.
    test("an author write on a single-author blog leaves the header pages alone", async () => {
      const entries = [BLOG_ENTRY, { ...BLOG_ENTRY, slug: "second-post" }];
      getFreshPublishedBlogPostCountMock.mockResolvedValue(entries.length);

      await invalidateCmsEntries({ entries, knownPagePathnames: ["/blog/authors/old-name"] });

      expect(getFreshPublishedBlogPostCountMock).not.toHaveBeenCalled();
      expect(pageStepInput()?.scopes).toEqual([]);
      expect(repurgeInput()?.scopes).toEqual([]);
    });

    test("a publish state change with no blog entry never reads the count", async () => {
      await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "launch-notes", publishStateChange: PUBLISHED });

      expect(getFreshPublishedBlogPostCountMock).not.toHaveBeenCalled();
    });
  });

  describe("the header docs link", () => {
    // The last docs page went away, so the docs link goes away on every page.
    test("the delete of the last live docs page purges every header page", async () => {
      getFreshCmsNavigationLivePageCountMock.mockResolvedValueOnce(0);

      await invalidateDeletedCmsEntry({
        collectionSlug: DOCS_SLUG,
        slug: "a",
        pagePathnames: ["/docs/a"],
        publishStateChange: UNPUBLISHED,
      });

      expect(getFreshCmsNavigationLivePageCountMock).toHaveBeenCalledWith({ navigationKey: SITE_HEADER_NAVIGATION_KEY });
      expect(pageStepInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
      expect(purgedTags()).toEqual(expect.arrayContaining([...SITE_HEADER_CACHE_TAGS]));
      expect(repurgeInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
    });

    test("the first live docs page purges every header page", async () => {
      getFreshCmsNavigationLivePageCountMock.mockResolvedValueOnce(1);

      await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "a", publishStateChange: PUBLISHED });

      expect(pageStepInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
    });

    test("an unpublish with other live docs pages leaves the header pages alone", async () => {
      getFreshCmsNavigationLivePageCountMock.mockResolvedValueOnce(1);

      await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "a", publishStateChange: UNPUBLISHED });

      expect(getFreshCmsNavigationLivePageCountMock).toHaveBeenCalledOnce();
      expect(pageStepInput()?.scopes).toEqual([]);
    });

    test("a failed count purges the header pages", async () => {
      getFreshCmsNavigationLivePageCountMock.mockRejectedValueOnce(new Error("D1 down"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "a", publishStateChange: PUBLISHED });

        expect(pageStepInput()?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
        expect(consoleError).toHaveBeenCalledOnce();
      } finally {
        consoleError.mockRestore();
      }
    });

    // The docs navigation does not link the entry yet, so no page went live.
    test("a docs publish that leaves no live docs page leaves the header pages alone", async () => {
      getFreshCmsNavigationLivePageCountMock.mockResolvedValueOnce(0);

      await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "a", publishStateChange: PUBLISHED });

      expect(pageStepInput()?.scopes).toEqual([]);
    });

    test("a docs content edit never reads the count", async () => {
      getFreshCmsNavigationLivePageCountMock.mockResolvedValue(0);

      await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: "a", warm: true });

      expect(getFreshCmsNavigationLivePageCountMock).not.toHaveBeenCalled();
      expect(pageStepInput()?.scopes).toEqual([]);
    });

    test("a blog publish state change never reads the docs count", async () => {
      await invalidateEntryAndCollection({
        collectionSlug: BLOG_ENTRY.collection,
        slug: BLOG_ENTRY.slug,
        publishStateChange: PUBLISHED,
      });

      expect(getFreshCmsNavigationLivePageCountMock).not.toHaveBeenCalled();
    });

    // A reorder or a rename of the first page keeps the page set, and the header renders no path.
    test("a docs navigation save that keeps the page set leaves the header pages alone", async () => {
      await invalidateCmsNavigationCaches({
        navigationKey: SITE_HEADER_NAVIGATION_KEY,
        pageChange: { addedItems: 0, removedItems: 0 },
      });

      expect(getFreshCmsNavigationLivePageCountMock).not.toHaveBeenCalled();
      expect(pageStepInput()?.scopes).toEqual([]);
      expect(repurgeInput()?.scopes).toEqual([]);
    });

    test("a docs navigation save that adds the first or removes the last page purges every header page", async () => {
      getFreshCmsNavigationLivePageCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await invalidateCmsNavigationCaches({
        navigationKey: SITE_HEADER_NAVIGATION_KEY,
        pageChange: { addedItems: 1, removedItems: 0 },
      });
      await invalidateCmsNavigationCaches({
        navigationKey: SITE_HEADER_NAVIGATION_KEY,
        pageChange: { addedItems: 0, removedItems: 1 },
      });

      expect(pageStepInput(0)?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
      expect(pageStepInput(1)?.scopes).toEqual([CMS_INVALIDATION_SCOPES.SITE_HEADER]);
    });

    test("a docs navigation save that adds a page beside other live pages leaves the header pages alone", async () => {
      await invalidateCmsNavigationCaches({
        navigationKey: SITE_HEADER_NAVIGATION_KEY,
        pageChange: { addedItems: 1, removedItems: 0 },
      });

      expect(pageStepInput()?.scopes).toEqual([]);
    });
  });

  test("a docs entry delete hands the page step the paths it read before the delete", async () => {
    await invalidateDeletedCmsEntry({
      collectionSlug: DOCS_SLUG,
      slug: "gone",
      pagePathnames: ["/docs/gone"],
      publishStateChange: null,
    });

    expect(pageStepInput()).toMatchObject({
      entries: [{ collection: DOCS_SLUG, slug: "gone" }],
      knownPagePathnames: ["/docs/gone"],
    });
    // Without a zone purge, only a delete by name reaches a copy that a render stored meanwhile.
    expect(repurgeInput()?.knownPagePathnames).toEqual(["/docs/gone"]);
  });

  test("a tag group write drops the entry and tag catalog tags, and queues its delayed repeat", async () => {
    const entryRefs = [{ collection: collectionSlugs[0], slug: "launch-notes" }];

    purgeWorkersCacheAfterWriteMock.mockImplementationOnce(async ({ tags }) => {
      for (const tag of tags) {
        expect(revalidateCacheTagMock).toHaveBeenCalledWith(tag);
      }
    });

    await invalidateCmsTagGroupCaches({ entryRefs });

    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
    expect(purgedTags()).toEqual(expect.arrayContaining([
      CACHE_TAGS.CMS_TAGS,
      CACHE_TAGS.SITEMAP,
      CACHE_TAGS.cmsEntry({ collectionSlug: collectionSlugs[0], slug: "launch-notes" }),
      CACHE_TAGS.cmsCollection(collectionSlugs[0]),
    ]));
    expect(pageStepInput()).toMatchObject({
      entries: entryRefs,
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
    });
    expect(repurgeInput()).toMatchObject({
      entries: entryRefs,
      entryChange: CMS_ENTRY_CHANGES.TAGS,
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
    });
    // A tag write changes no publish status, so it never asks about the header.
    expect(getFreshPublishedBlogPostCountMock).not.toHaveBeenCalled();
  });

  // A tag edit moves no entry, so the counts, navigation, redirects, and search keep their data.
  test("a tag group write drops only the tags that render the tag", async () => {
    const entryRefs = collectionSlugs.map((collection) => ({ collection, slug: "launch-notes" }));

    await invalidateCmsTagGroupCaches({ entryRefs });

    expect(purgedTags().toSorted()).toEqual([
      CACHE_TAGS.CMS_TAGS,
      CACHE_TAGS.SITEMAP,
      ...entryRefs.flatMap(({ collection, slug }) => [
        CACHE_TAGS.cmsEntry({ collectionSlug: collection, slug }),
        CACHE_TAGS.cmsCollection(collection),
      ]),
    ].toSorted());
  });

  test("the delayed pass of a tag rename repeats its tags and names the old tag pages", async () => {
    const entryRefs = [{ collection: collectionSlugs[0], slug: "launch-notes" }];

    await invalidateCmsTagGroupCaches({ entryRefs, knownPagePathnames: ["/blog/tags/old-name"] });
    const firstPassTags = purgedTags();
    const firstPageStep = pageStepInput();
    const { delaySeconds: __delay, ...target } = repurgeInput() ?? { delaySeconds: 0 };
    vi.clearAllMocks();

    await repurgeCmsCaches(target as Parameters<typeof repurgeCmsCaches>[0]);

    expect(firstPageStep?.knownPagePathnames).toEqual(["/blog/tags/old-name"]);
    expect(pageStepInput()).toEqual(firstPageStep);
    expect(purgedTags()).toEqual(firstPassTags);
  });

  // A new tag has no entry yet, but `/blog/tags` lists it.
  test("a tag create with no entry still purges the tag catalog pages", async () => {
    await invalidateCmsTagGroupCaches({ entryRefs: [] });

    expect(purgedTags().toSorted()).toEqual([CACHE_TAGS.CMS_TAGS, CACHE_TAGS.SITEMAP].toSorted());
    expect(pageStepInput()).toMatchObject({
      entries: [],
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
    });
    expect(enqueueCmsRepurgeMock).toHaveBeenCalledOnce();
  });

  // A `.md` miss renders from the KV tags, so a twin deleted before the drop would refill stale.
  test("a tag group write waits for the KV tag drop before its page step", async () => {
    const release = holdKvTagDrops();
    const pending = invalidateCmsTagGroupCaches({
      entryRefs: [{ collection: collectionSlugs[0], slug: "launch-notes" }],
    });

    await vi.waitFor(() => expect(revalidateCacheTagMock).toHaveBeenCalled());
    expect(purgeCmsPagesMock).not.toHaveBeenCalled();
    expect(purgeWorkersCacheAfterWriteMock).not.toHaveBeenCalled();

    release();
    await pending;

    expect(purgeCmsPagesMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeWorkersCacheAfterWriteMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("a navigation save drops its tags, purges its pages, and queues its delayed repeat", async () => {
    const [navigationKey] = cmsNavigationKeys;
    const headerScopes = navigationKey === SITE_HEADER_NAVIGATION_KEY
      ? [CMS_INVALIDATION_SCOPES.SITE_HEADER]
      : [];
    getFreshCmsNavigationLivePageCountMock.mockResolvedValueOnce(0);

    await invalidateCmsNavigationCaches({ navigationKey, pageChange: { addedItems: 0, removedItems: 1 } });

    expect(purgedTags()).toEqual(expect.arrayContaining([
      CACHE_TAGS.cmsNavigation(navigationKey),
      CACHE_TAGS.cmsRedirect(navigationKey),
      CACHE_TAGS.SITEMAP,
    ]));
    expect(pageStepInput()).toMatchObject({ entries: [], navigationKeys: [navigationKey], scopes: headerScopes });
    expect(repurgeInput()).toMatchObject({ entries: [], navigationKeys: [navigationKey], scopes: headerScopes });
    expect(spans[0]?.attributes["app.cms.collection"]).toBe("none");
  });

  // An edge miss on a `.md` twin reads its KV copy, so the KV copy must be gone before the edge
  // purge, and the warm must come after both.
  test("an entry publish drops KV, then runs the page step, then purges Workers Caching, then warms", async () => {
    const collectionSlug = collectionSlugs[0];

    await invalidateEntryAndCollection({ collectionSlug, slug: "launch-notes", warm: true });

    const tagOrder = revalidateCacheTagMock.mock.invocationCallOrder;
    const pageOrder = purgeCmsPagesMock.mock.invocationCallOrder[0] ?? Infinity;
    const edgeOrder = purgeWorkersCacheAfterWriteMock.mock.invocationCallOrder[0] ?? Infinity;
    const warmOrder = warmCmsEntryPagesMock.mock.invocationCallOrder[0] ?? Infinity;

    expect(Math.max(...tagOrder)).toBeLessThan(pageOrder);
    expect(pageOrder).toBeLessThan(edgeOrder);
    expect(edgeOrder).toBeLessThan(warmOrder);
  });

  test("a multi-entry write sends one page step and one Workers Caching purge for every entry", async () => {
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
    expect(purgeCmsPagesMock).toHaveBeenCalledTimes(1);
    expect(pageStepInput()?.entries).toEqual(entries.slice(0, 2));
    expect(spans[0]?.attributes["app.cms.slug_count"]).toBe(2);
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
  });

  test("an empty multi-entry write does nothing", async () => {
    await invalidateCmsEntries({ entries: [] });

    expect(spans).toEqual([]);
    expect(purgeWorkersCacheAfterWriteMock).not.toHaveBeenCalled();
    expect(enqueueCmsRepurgeMock).not.toHaveBeenCalled();
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

  test("a failed page purge sends no Workers Caching purge", async () => {
    purgeCmsPagesMock.mockRejectedValueOnce(new Error("stored page purge failed"));

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
    expect(pageStepInput()?.entries).toEqual(entries);
    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
    expect(new Set(purgedTags())).toEqual(new Set(droppedTags));
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
  });
});
