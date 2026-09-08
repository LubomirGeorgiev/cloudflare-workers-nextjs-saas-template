import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";

const {
  getDBMock,
  purgeCmsEntryEdgeHtmlPagesMock,
  purgeMarkdownPageCacheMock,
  revalidateCacheTagMock,
  syncCmsEntrySearchMock,
  syncEntryMediaRelationshipsMock,
  warmCmsEntryPagesMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  purgeCmsEntryEdgeHtmlPagesMock: vi.fn(async () => undefined),
  purgeMarkdownPageCacheMock: vi.fn(async () => undefined),
  revalidateCacheTagMock: vi.fn(),
  syncCmsEntrySearchMock: vi.fn(async () => undefined),
  syncEntryMediaRelationshipsMock: vi.fn(async () => undefined),
  warmCmsEntryPagesMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/lib/cms/media-tracking", () => ({
  syncEntryMediaRelationships: syncEntryMediaRelationshipsMock,
}));

vi.mock("@/lib/cms/cms-search", () => ({
  invalidateCmsSearchCache: vi.fn(async () => undefined),
  isCollectionSearchEnabled: () => false,
  syncCmsEntrySearch: syncCmsEntrySearchMock,
}));

// The KV sweep needs a Worker binding, and the Cache API needs a Worker runtime; both key matrices
// are asserted elsewhere, so here we only prove the revert reaches the stored-HTML purge.
vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

vi.mock("@/lib/cms/cms-entry-page-purge", () => ({
  purgeCmsEntryEdgeHtmlPages: purgeCmsEntryEdgeHtmlPagesMock,
}));

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
  },
  revalidateCacheTag: revalidateCacheTagMock,
}));

const { revertCmsEntryToVersion } = await import("./versions");

const COLLECTION = collectionSlugs[0];
const ENTRY_ID = "entry_1";
const VERSION_ID = "version_2";
const CURRENT_SLUG = "old-slug";
const REVERTED_SLUG = "new-slug";

function stubRevert({ status }: { status: string }): void {
  const version = {
    id: VERSION_ID,
    entryId: ENTRY_ID,
    versionNumber: 2,
    title: "Reverted title",
    content: {},
    fields: null,
    slug: REVERTED_SLUG,
    seoDescription: null,
    status,
    featuredImageId: null,
    createdBy: "user_1",
  };
  const currentEntry = {
    id: ENTRY_ID,
    collection: COLLECTION,
    slug: CURRENT_SLUG,
    title: "Current title",
    content: {},
    fields: null,
    seoDescription: null,
    status,
    featuredImageId: null,
    createdBy: "user_1",
  };

  getDBMock.mockReturnValue({
    query: {
      cmsEntryVersionTable: { findFirst: vi.fn().mockResolvedValue(version) },
      cmsEntryTable: { findFirst: vi.fn().mockResolvedValue(currentEntry) },
    },
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ ...currentEntry, slug: REVERTED_SLUG, status }]),
        })),
      })),
    })),
  });
}

describe("revertCmsEntryToVersion", () => {
  beforeEach(() => {
    stubRevert({ status: CMS_ENTRY_STATUS.PUBLISHED });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Before the shared pipeline, the revert built its own tag list and left the stored page behind,
  // so an anonymous visitor kept reading the reverted-away body until the edge TTL expired.
  test("purges the stored HTML of both the reverted and the previous slug", async () => {
    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledTimes(1);
    expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledWith({
      entries: [
        { collection: COLLECTION, slug: REVERTED_SLUG },
        { collection: COLLECTION, slug: CURRENT_SLUG },
      ],
    });
    expect(revalidateCacheTagMock).toHaveBeenCalledWith(
      `cms-entry-${COLLECTION}-${CURRENT_SLUG}`,
    );
    expect(revalidateCacheTagMock).toHaveBeenCalledWith(
      `cms-entry-${COLLECTION}-${REVERTED_SLUG}`,
    );
  });

  test("warms only the slug that still resolves", async () => {
    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(warmCmsEntryPagesMock).toHaveBeenCalledWith({
      entries: [{ collection: COLLECTION, slug: REVERTED_SLUG }],
    });
  });

  // The revert rewrites the searchable columns, so it owes the index the same sync `updateCmsEntry`
  // does; without it a search hit kept the reverted-away title until the next edit.
  test("re-indexes the reverted row for search", async () => {
    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(syncCmsEntrySearchMock).toHaveBeenCalledWith({
      entryId: ENTRY_ID,
      collection: COLLECTION,
      slug: REVERTED_SLUG,
      title: "Current title",
      seoDescription: null,
      content: {},
    });
  });

  test("syncs search before the cache invalidation", async () => {
    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(syncCmsEntrySearchMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeCmsEntryEdgeHtmlPagesMock.mock.invocationCallOrder[0],
    );
  });

  // A revert to a draft snapshot unpublishes the page, so a warm would fetch a 404.
  test("a revert to a draft version purges but never warms", async () => {
    stubRevert({ status: CMS_ENTRY_STATUS.DRAFT });

    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(purgeCmsEntryEdgeHtmlPagesMock).toHaveBeenCalledTimes(1);
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
  });
});
