import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsConfig, cmsNavigationKeys, collectionSlugs, type CollectionsUnion } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { BLOG_POSTS_PER_PAGE } from "@/constants";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import {
  BLOG_BASE_PATH,
  BLOG_COLLECTION_SLUG,
  CMS_TAGS_PAGE_PATH,
  getBlogAuthorPagePath,
  getBlogCollectionPagePath,
  getBlogPagePath,
  getBlogTagPagePath,
} from "@/lib/blog-routing";
import { CMS_INVALIDATION_SCOPES } from "@/lib/cms/cms-invalidation-scopes";
import {
  getCmsCollectionNavigationKey,
  getCmsNavigationConfig,
} from "@/lib/cms/cms-navigation-config";
import { DOCS_EDGE_HTML_PATHNAMES } from "@/lib/cms/cms-navigation-page-purge";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

import type { CmsEntryStatusRef } from "./cms-entry-page-purge";

const {
  getBlogListingPostCountsMock,
  getCmsNavigationPagePathsMock,
  purgeEdgeHtmlPagesMock,
  purgeMarkdownPageCacheMock,
} = vi.hoisted(() => ({
  getBlogListingPostCountsMock: vi.fn(async () => [] as { pathname: string; postCount: number }[]),
  getCmsNavigationPagePathsMock: vi.fn(async (__input: unknown) => [] as string[]),
  purgeEdgeHtmlPagesMock: vi.fn(async (__input: unknown) => ({ deletedCount: 0, zonePurge: "ok" })),
  purgeMarkdownPageCacheMock: vi.fn(async (__input: unknown) => undefined),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cms/cms-navigation-entry-paths", () => ({
  getCmsNavigationPagePaths: getCmsNavigationPagePathsMock,
}));

vi.mock("@/lib/cms/blog-listing-post-counts", () => ({
  getBlogListingPostCounts: getBlogListingPostCountsMock,
}));

// Both stores need a Worker runtime; here we only prove which targets reach which one.
vi.mock("@/lib/edge/edge-html-cache", () => ({
  purgeEdgeHtmlPages: purgeEdgeHtmlPagesMock,
}));

vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

const {
  cmsEntryListingPath,
  cmsEntryPagePath,
  purgeCmsPages,
  selectCmsPagePurgeReads,
  selectCmsPagePurgeTargets,
} = await import("./cms-entry-page-purge");

// The caller reads the entry rows, because a full clear also needs them for its tags.
const readAllEntryRefsMock = vi.fn(async (): Promise<CmsEntryStatusRef[]> => []);

/** The fork's own first collection that publishes a page, so a renamed catalog still runs this. */
const PAGE_COLLECTION = collectionSlugs.find(
  (collectionSlug): collectionSlug is CollectionsUnion =>
    "previewUrl" in cmsConfig.collections[collectionSlug]
    && !getCmsCollectionNavigationKey(collectionSlug),
);

/** The fork's first collection whose URLs come from a navigation tree. */
const NAVIGATION_COLLECTION = collectionSlugs.find(
  (collectionSlug) => Boolean(getCmsCollectionNavigationKey(collectionSlug)),
);

const NO_TARGETS = {
  allEntries: [],
  blogListings: [],
  entries: [],
  knownPagePathnames: [],
  navigationKeys: [],
  navigationPagePaths: [],
  scopes: [],
};

describe("selectCmsPagePurgeTargets", () => {
  // The subtree reaches the pagination, tag, and author pages zone-wide.
  test.skipIf(!PAGE_COLLECTION)("an entry names its page, and its listing as a subtree and a `.md` prefix", () => {
    const entry = { collection: PAGE_COLLECTION as CollectionsUnion, slug: "launch-notes" };
    const pagePath = cmsEntryPagePath(entry) as string;
    const listingPath = cmsEntryListingPath(pagePath);
    const targets = selectCmsPagePurgeTargets({ ...NO_TARGETS, entries: [entry] });

    expect(targets.pathnames).toContain(pagePath);
    expect(targets.subtreePathnames).toEqual([listingPath]);
    expect(targets.markdownPathnames).toEqual([listingPath]);
  });

  // Without an API token only the local delete runs, and it cannot match a prefix.
  test("a blog write names every numbered blog list page, so the local delete reaches them", () => {
    const tagPath = getBlogTagPagePath("release-notes");
    const authorPath = getBlogAuthorPagePath({ id: "usr_1", firstName: "Ada", lastName: "Lovelace" });
    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      entries: [{ collection: BLOG_COLLECTION_SLUG, slug: "launch-notes" }],
      blogListings: [
        { pathname: BLOG_BASE_PATH, postCount: BLOG_POSTS_PER_PAGE + 1 },
        { pathname: tagPath, postCount: BLOG_POSTS_PER_PAGE * 2 + 1 },
        { pathname: authorPath, postCount: 1 },
      ],
    });

    expect(targets.pathnames).toEqual(expect.arrayContaining([
      ...BLOG_LISTING_ROUTES.map(({ pathname }) => pathname),
      getBlogPagePath({ page: 2 }),
      tagPath,
      getBlogCollectionPagePath({ pathname: tagPath, page: 3 }),
      authorPath,
    ]));
    expect(targets.pathnames).not.toContain(getBlogCollectionPagePath({ pathname: authorPath, page: 2 }));
    expect(targets.subtreePathnames).toEqual([BLOG_BASE_PATH]);
  });

  // A page outside every purged prefix would cost a zone tag, so the request count stays bounded.
  test("a tag catalog write names only the tag pages, which sit under its subtree", () => {
    const tagPath = getBlogTagPagePath("release-notes");
    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
      blogListings: [
        { pathname: BLOG_BASE_PATH, postCount: BLOG_POSTS_PER_PAGE + 1 },
        { pathname: tagPath, postCount: 1 },
      ],
    });

    expect(targets).toEqual({
      pathnames: [CMS_TAGS_PAGE_PATH, tagPath],
      subtreePathnames: [CMS_TAGS_PAGE_PATH],
      markdownPathnames: [CMS_TAGS_PAGE_PATH],
    });
  });

  test("names the pages a write moved away from, such as an old tag slug", () => {
    const oldTagPath = getBlogTagPagePath("old-slug");
    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      knownPagePathnames: [oldTagPath],
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
    });

    expect(targets.pathnames).toContain(oldTagPath);
  });

  // Every page under the navigation bakes the sidebar, so one entry write changes all of them.
  test.skipIf(!NAVIGATION_COLLECTION)("a navigation entry names every page of its tree", () => {
    const collection = NAVIGATION_COLLECTION as CollectionsUnion;
    const navigationKey = getCmsCollectionNavigationKey(collection)!;
    const { basePath } = getCmsNavigationConfig(navigationKey);
    const navigationPagePaths = [`${basePath}/guides/setup`, `${basePath}/guides/deploy`];

    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      entries: [{ collection, slug: "setup" }],
      navigationPagePaths,
    });

    expect(targets.pathnames).toEqual(expect.arrayContaining(navigationPagePaths));
    expect(targets.subtreePathnames).toContain(basePath);
    expect(targets.markdownPathnames).toContain(basePath);
  });

  test("a navigation save names its base path, its tree, and a removed page", () => {
    const [navigationKey] = cmsNavigationKeys;
    const { basePath } = getCmsNavigationConfig(navigationKey);
    const removedPath = `${basePath}/removed`;
    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      knownPagePathnames: [removedPath],
      navigationKeys: [navigationKey],
      navigationPagePaths: [`${basePath}/kept`],
    });

    expect(targets.pathnames).toEqual(expect.arrayContaining([basePath, `${basePath}/kept`, removedPath]));
    expect(targets.subtreePathnames).toEqual([basePath]);
    expect(targets.markdownPathnames).toEqual([basePath]);
  });

  // The docs app routes render inside the docs layout, so the sidebar change reaches them too.
  test.skipIf(!cmsNavigationKeys.includes(DOCS_SLUG))("a docs navigation names the docs app routes", () => {
    const targets = selectCmsPagePurgeTargets({ ...NO_TARGETS, navigationKeys: [DOCS_SLUG] });

    expect(targets.pathnames).toEqual(expect.arrayContaining(DOCS_EDGE_HTML_PATHNAMES));
  });

  test("the site header scope purges every stored page by the root prefix, and no `.md` twin", () => {
    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      scopes: [CMS_INVALIDATION_SCOPES.SITE_HEADER],
    });

    expect(targets.subtreePathnames).toEqual(["/"]);
    expect(targets.pathnames).toEqual(expect.arrayContaining(
      STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname),
    ));
    expect(targets.markdownPathnames).toEqual([]);
  });

  // Without an API token only the local delete runs: it must name the docs and blog pages too.
  test("the site header scope names every known page under the root prefix", () => {
    const docsPagePath = "/docs/getting-started/introduction";
    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      scopes: [CMS_INVALIDATION_SCOPES.SITE_HEADER],
      blogListings: [{ pathname: BLOG_BASE_PATH, postCount: BLOG_POSTS_PER_PAGE + 1 }],
      navigationPagePaths: [docsPagePath],
    });

    expect(targets.pathnames).toEqual(expect.arrayContaining([
      docsPagePath,
      getBlogPagePath({ page: 2 }),
      ...(cmsNavigationKeys.includes(DOCS_SLUG) ? DOCS_EDGE_HTML_PATHNAMES : []),
    ]));
    expect(targets.subtreePathnames).toEqual(["/"]);
  });

  // The local delete cannot match the root prefix, so a root purge names each published entry page.
  test.skipIf(!PAGE_COLLECTION).each([
    CMS_INVALIDATION_SCOPES.SITE_HEADER,
    CMS_INVALIDATION_SCOPES.ALL_CMS,
  ])("a %s purge names the page of each published entry, and of no other entry", (scope) => {
    const collection = PAGE_COLLECTION as CollectionsUnion;
    const allEntries = Object.values(CMS_ENTRY_STATUS).map((status) => ({
      collection,
      slug: `${status}-entry`,
      status,
    }));
    const targets = selectCmsPagePurgeTargets({ ...NO_TARGETS, allEntries, scopes: [scope] });

    for (const entry of allEntries) {
      const pagePath = cmsEntryPagePath(entry) as string;

      if (entry.status === CMS_ENTRY_STATUS.PUBLISHED) {
        expect(targets.pathnames).toContain(pagePath);
      } else {
        expect(targets.pathnames).not.toContain(pagePath);
      }
    }
    expect(targets.subtreePathnames).toEqual(["/"]);
  });

  test("a full CMS clear purges every stored page and every `.md` twin, not one key per entry", () => {
    const targets = selectCmsPagePurgeTargets({
      ...NO_TARGETS,
      scopes: [CMS_INVALIDATION_SCOPES.ALL_CMS],
    });

    expect(targets.subtreePathnames).toEqual(["/"]);
    expect(targets.markdownPathnames).toEqual(["/"]);
  });
});

describe("selectCmsPagePurgeReads", () => {
  test("a blog write reads the blog list post counts", () => {
    expect(selectCmsPagePurgeReads({
      entries: [{ collection: BLOG_COLLECTION_SLUG, slug: "launch-notes" }],
      navigationKeys: [],
      scopes: [],
    }).blogListings).toBe(true);
  });

  test("a tag catalog write reads the blog list post counts", () => {
    expect(selectCmsPagePurgeReads({
      entries: [],
      navigationKeys: [],
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
    }).blogListings).toBe(true);
  });

  test.each([
    CMS_INVALIDATION_SCOPES.SITE_HEADER,
    CMS_INVALIDATION_SCOPES.ALL_CMS,
  ])("a %s purge reads every navigation tree, the blog list post counts, and every entry row", (scope) => {
    expect(selectCmsPagePurgeReads({ entries: [], navigationKeys: [], scopes: [scope] })).toEqual({
      navigationKeys: cmsNavigationKeys.toSorted(),
      blogListings: true,
      allEntries: true,
    });
  });

  test.skipIf(!NAVIGATION_COLLECTION)("a navigation entry reads the tree of its navigation, and no blog count", () => {
    const collection = NAVIGATION_COLLECTION as CollectionsUnion;

    expect(selectCmsPagePurgeReads({
      entries: [{ collection, slug: "setup" }],
      navigationKeys: [],
      scopes: [],
    })).toEqual({
      navigationKeys: [getCmsCollectionNavigationKey(collection)],
      blogListings: false,
      allEntries: false,
    });
  });
});

describe("purgeCmsPages", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // One call per kind, in sequence. A `.md` miss renders through the app, not the stored page.
  test("sends one stored-HTML purge, then one `.md` purge", async () => {
    let release = () => {};
    purgeEdgeHtmlPagesMock.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ deletedCount: 0, zonePurge: "ok" });
    }));

    const pending = purgeCmsPages({
      entries: [],
      navigationKeys: [cmsNavigationKeys[0]],
      readAllEntryRefs: readAllEntryRefsMock,
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
    });

    await vi.waitFor(() => expect(purgeEdgeHtmlPagesMock).toHaveBeenCalledOnce());
    expect(purgeMarkdownPageCacheMock).not.toHaveBeenCalled();

    release();
    await expect(pending).resolves.toBe("ok");
    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledOnce();
  });

  test("hands the read blog list pages to the stored-HTML purge", async () => {
    getBlogListingPostCountsMock.mockResolvedValueOnce([
      { pathname: BLOG_BASE_PATH, postCount: BLOG_POSTS_PER_PAGE + 1 },
    ]);

    await purgeCmsPages({
      entries: [{ collection: BLOG_COLLECTION_SLUG, slug: "launch-notes" }],
      navigationKeys: [],
      readAllEntryRefs: readAllEntryRefsMock,
      scopes: [],
    });

    expect(getBlogListingPostCountsMock).toHaveBeenCalledOnce();
    expect(readAllEntryRefsMock).not.toHaveBeenCalled();
    expect(purgeEdgeHtmlPagesMock.mock.calls[0]?.[0]).toMatchObject({
      pathnames: expect.arrayContaining([getBlogPagePath({ page: 2 })]),
    });
  });

  // A delete cascades the navigation row away, so its caller passes the path it read first.
  test.skipIf(!NAVIGATION_COLLECTION)("names the page paths a delete read before its rows went", async () => {
    await purgeCmsPages({
      entries: [{ collection: NAVIGATION_COLLECTION as CollectionsUnion, slug: "gone" }],
      knownPagePathnames: ["/docs/gone"],
      navigationKeys: [],
      readAllEntryRefs: readAllEntryRefsMock,
      scopes: [],
    });

    expect(purgeEdgeHtmlPagesMock.mock.calls[0]?.[0]).toMatchObject({
      pathnames: expect.arrayContaining(["/docs/gone"]),
    });
  });

  test.skipIf(!PAGE_COLLECTION)("a site header purge hands each published entry page to the stored-HTML purge", async () => {
    const published = { collection: PAGE_COLLECTION as CollectionsUnion, slug: "launch-notes" };
    readAllEntryRefsMock.mockResolvedValueOnce([{ ...published, status: CMS_ENTRY_STATUS.PUBLISHED }]);

    await purgeCmsPages({
      entries: [],
      navigationKeys: [],
      readAllEntryRefs: readAllEntryRefsMock,
      scopes: [CMS_INVALIDATION_SCOPES.SITE_HEADER],
    });

    expect(readAllEntryRefsMock).toHaveBeenCalledOnce();
    expect(purgeEdgeHtmlPagesMock.mock.calls[0]?.[0]).toMatchObject({
      pathnames: expect.arrayContaining([cmsEntryPagePath(published)]),
      subtreePathnames: ["/"],
    });
  });

  // The root prefix still reaches every page zone-wide, so a failed read must not stop the purge.
  test("a failed entry row read still purges the root subtree", async () => {
    readAllEntryRefsMock.mockRejectedValueOnce(new Error("D1 down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(purgeCmsPages({
        entries: [],
        navigationKeys: [],
        readAllEntryRefs: readAllEntryRefsMock,
        scopes: [CMS_INVALIDATION_SCOPES.SITE_HEADER],
      })).resolves.toBe("ok");
      expect(purgeEdgeHtmlPagesMock.mock.calls[0]?.[0]).toMatchObject({ subtreePathnames: ["/"] });
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });
});
