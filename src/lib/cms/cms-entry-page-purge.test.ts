import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsConfig, collectionSlugs, type CollectionsUnion } from "@/../cms.config";

const {
  getCmsNavigationEntryPathsMock,
  purgeEdgeHtmlPagesMock,
  purgeMarkdownPageCacheMock,
} = vi.hoisted(() => ({
  getCmsNavigationEntryPathsMock: vi.fn(async () => [] as string[]),
  purgeEdgeHtmlPagesMock: vi.fn(async () => undefined),
  purgeMarkdownPageCacheMock: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cms/cms-navigation-entry-paths", () => ({
  getCmsNavigationEntryPaths: getCmsNavigationEntryPathsMock,
}));

// Both stores need a Worker runtime; here we only prove which function reaches which one.
vi.mock("@/lib/edge/edge-html-cache", () => ({
  purgeEdgeHtmlPages: purgeEdgeHtmlPagesMock,
}));

vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

const {
  cmsEntryListingPath,
  cmsEntryPagePath,
  purgeCmsEntryEdgeHtmlPages,
  purgeCmsEntryMarkdownPages,
} = await import("./cms-entry-page-purge");

/** The fork's own first collection that publishes a page, so a renamed catalog still runs this. */
const PAGE_COLLECTION = collectionSlugs.find(
  (collectionSlug): collectionSlug is CollectionsUnion =>
    "previewUrl" in cmsConfig.collections[collectionSlug],
);

const ENTRIES = [{ collection: PAGE_COLLECTION as CollectionsUnion, slug: "launch-notes" }];

describe("CMS entry page purge", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Skipped in a fork where no collection publishes a page of its own.
  test.skipIf(!PAGE_COLLECTION)("the HTML purge names the entry page and its listing", async () => {
    await purgeCmsEntryEdgeHtmlPages({ entries: ENTRIES });

    const pagePath = cmsEntryPagePath(ENTRIES[0]) as string;
    expect(purgeEdgeHtmlPagesMock).toHaveBeenCalledWith({
      pathnames: [pagePath, cmsEntryListingPath(pagePath)],
    });
    expect(purgeMarkdownPageCacheMock).not.toHaveBeenCalled();
  });

  // The HTML store belongs to `invalidateEntryAndCollection`, which purges it before its warm; a
  // second purge from here would delete the page that warm just stored.
  test.skipIf(!PAGE_COLLECTION)("the Markdown purge never touches the HTML store", async () => {
    await purgeCmsEntryMarkdownPages({ entries: ENTRIES });

    const pagePath = cmsEntryPagePath(ENTRIES[0]) as string;
    expect(purgeMarkdownPageCacheMock).toHaveBeenCalledWith({
      pathnames: [cmsEntryListingPath(pagePath)],
    });
    expect(purgeEdgeHtmlPagesMock).not.toHaveBeenCalled();
  });
});
