import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";

const {
  getDBMock,
  purgeCmsPagesMock,
  purgeMarkdownPageCacheMock,
  revalidateCacheTagMock,
  syncCmsEntrySearchMock,
  syncCmsPublishScheduleMock,
  syncEntryMediaRelationshipsMock,
  warmCmsEntryPagesMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  purgeCmsPagesMock: vi.fn(async () => undefined),
  purgeMarkdownPageCacheMock: vi.fn(async () => undefined),
  revalidateCacheTagMock: vi.fn(),
  syncCmsEntrySearchMock: vi.fn(async () => undefined),
  syncCmsPublishScheduleMock: vi.fn(async () => undefined),
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
  getCmsSearchCacheTags: () => [],
  isCollectionSearchEnabled: () => false,
  syncCmsEntrySearch: syncCmsEntrySearchMock,
}));

// The KV sweep needs a Worker binding, and the Cache API needs a Worker runtime; both key matrices
// are asserted elsewhere, so here we only prove the revert reaches the stored-HTML purge.
vi.mock("@/lib/markdown-pages/purge-page-cache", () => ({
  purgeMarkdownPageCache: purgeMarkdownPageCacheMock,
}));

vi.mock("@/lib/cms/cms-entry-page-purge", () => ({
  purgeCmsPages: purgeCmsPagesMock,
}));

// The schedule writer needs the queue binding; `publishing.test.ts` covers it.
vi.mock("@/lib/cms/entry/publishing", () => ({
  syncCmsPublishSchedule: syncCmsPublishScheduleMock,
}));

vi.mock("@/lib/cms/warm-cms-pages", () => ({
  warmCmsEntryPages: warmCmsEntryPagesMock,
}));

// The delayed purge needs the queue binding; `cms-cache-invalidation.test.ts` asserts it.
vi.mock("@/lib/scheduler/enqueue", () => ({
  enqueueCmsRepurge: async () => undefined,
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

const { resolveRevertedPublishState, revertCmsEntryToVersion } = await import("./versions");

const COLLECTION = collectionSlugs[0];
const ENTRY_ID = "entry_1";
const VERSION_ID = "version_2";
const CURRENT_SLUG = "old-slug";
const REVERTED_SLUG = "new-slug";

const SIBLING_ID = "entry_1_es";

function stubRevert({
  status,
  versionSlug = REVERTED_SLUG,
  versionPublishedAt = null,
  conflictingRows = [],
}: {
  status: string;
  versionSlug?: string;
  versionPublishedAt?: Date | null;
  conflictingRows?: { id: string }[];
}) {
  const version = {
    id: VERSION_ID,
    entryId: ENTRY_ID,
    versionNumber: 2,
    title: "Reverted title",
    content: {},
    fields: null,
    slug: versionSlug,
    seoDescription: null,
    status,
    publishedAt: versionPublishedAt,
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

  const updatedEntry = { ...currentEntry, slug: versionSlug, status };
  const siblingEntry = { ...updatedEntry, id: SIBLING_ID, title: "Sibling title" };
  const setMock = vi.fn((__values: Record<string, unknown>) => ({
    where: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([updatedEntry]),
    })),
  }));
  const batchMock = vi.fn(async (queries: unknown[]) => [[updatedEntry], ...queries.slice(1).map(() => ({}))]);

  getDBMock.mockReturnValue({
    query: {
      cmsEntryVersionTable: { findFirst: vi.fn().mockResolvedValue(version) },
      cmsEntryTable: {
        findFirst: vi.fn().mockResolvedValue(currentEntry),
        findMany: vi.fn().mockResolvedValue([updatedEntry, siblingEntry]),
      },
    },
    // Serves the slug conflict check and the history prune (which adds `orderBy`).
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(conflictingRows),
          orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    update: vi.fn(() => ({ set: setMock })),
    batch: batchMock,
  });

  return { batchMock, setMock, updatedEntry };
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

    expect(purgeCmsPagesMock).toHaveBeenCalledTimes(1);
    expect(purgeCmsPagesMock).toHaveBeenCalledWith(expect.objectContaining({
      entries: [
        { collection: COLLECTION, slug: REVERTED_SLUG },
        { collection: COLLECTION, slug: CURRENT_SLUG },
      ],
    }));
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

  // The index stores the slug, so a sibling left on the old slug would link to a dead page.
  test("a slug change re-indexes every locale row of the entry", async () => {
    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(syncCmsEntrySearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: SIBLING_ID, slug: REVERTED_SLUG }),
    );
  });

  // Before the fix, only the restored row moved, so its locale siblings split off on the old slug.
  test("a slug change moves the row and its locale siblings in one batch", async () => {
    const { batchMock, setMock } = stubRevert({ status: CMS_ENTRY_STATUS.PUBLISHED });

    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0]?.[0]).toHaveLength(2);
    expect(setMock).toHaveBeenCalledWith({ slug: REVERTED_SLUG });
  });

  test("a revert that keeps the slug sends no group rename", async () => {
    const { batchMock, setMock } = stubRevert({
      status: CMS_ENTRY_STATUS.PUBLISHED,
      versionSlug: CURRENT_SLUG,
    });

    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(batchMock).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  test("refuses a slug that another entry holds, before any write", async () => {
    const { batchMock } = stubRevert({
      status: CMS_ENTRY_STATUS.PUBLISHED,
      conflictingRows: [{ id: "entry_other" }],
    });

    await expect(
      revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID }),
    ).rejects.toThrow(REVERTED_SLUG);
    expect(batchMock).not.toHaveBeenCalled();
  });

  // Before the fix, a restored `scheduled` status had no publish job, so it never went live.
  test("syncs the publish schedule with the restored row", async () => {
    const { updatedEntry } = stubRevert({
      status: CMS_ENTRY_STATUS.SCHEDULED,
      versionPublishedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const restored = await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(syncCmsPublishScheduleMock).toHaveBeenCalledWith(updatedEntry);
    expect(restored.scheduleCleared).toBe(false);
  });

  // A version row from before history kept dates: a guessed date could publish at once.
  test("a scheduled version with no date restores a draft and says so", async () => {
    const { setMock } = stubRevert({ status: CMS_ENTRY_STATUS.SCHEDULED });

    const restored = await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: CMS_ENTRY_STATUS.DRAFT }));
    expect(restored.scheduleCleared).toBe(true);
  });

  test("syncs search before the cache invalidation", async () => {
    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(syncCmsEntrySearchMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeCmsPagesMock.mock.invocationCallOrder[0],
    );
  });

  // A revert to a draft snapshot unpublishes the page, so a warm would fetch a 404.
  test("a revert to a draft version purges but never warms", async () => {
    stubRevert({ status: CMS_ENTRY_STATUS.DRAFT });

    await revertCmsEntryToVersion({ entryId: ENTRY_ID, versionId: VERSION_ID });

    expect(purgeCmsPagesMock).toHaveBeenCalledTimes(1);
    expect(warmCmsEntryPagesMock).not.toHaveBeenCalled();
  });
});

describe("resolveRevertedPublishState", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const pastDate = new Date("2026-01-01T00:00:00Z");
  const futureDate = new Date("2026-02-01T00:00:00Z");

  // Before the fix, the current past date stayed, so the restored schedule published at once.
  test("a scheduled restore takes the version date over the current one", () => {
    expect(resolveRevertedPublishState({
      status: CMS_ENTRY_STATUS.SCHEDULED,
      versionPublishedAt: futureDate,
      currentPublishedAt: pastDate,
      now,
    })).toEqual({ status: CMS_ENTRY_STATUS.SCHEDULED, publishedAt: futureDate, scheduleCleared: false });
  });

  // The current date or `now` would publish at once, so the admin sets the schedule again.
  test("a scheduled restore with no version date becomes a draft and flags it", () => {
    for (const currentPublishedAt of [pastDate, futureDate, null]) {
      expect(resolveRevertedPublishState({
        status: CMS_ENTRY_STATUS.SCHEDULED,
        versionPublishedAt: null,
        currentPublishedAt,
        now,
      })).toEqual({ status: CMS_ENTRY_STATUS.DRAFT, publishedAt: currentPublishedAt, scheduleCleared: true });
    }
  });

  test("a published restore keeps a past date, and gets now when it has none", () => {
    expect(resolveRevertedPublishState({
      status: CMS_ENTRY_STATUS.PUBLISHED,
      versionPublishedAt: null,
      currentPublishedAt: pastDate,
      now,
    })).toEqual({ status: CMS_ENTRY_STATUS.PUBLISHED, publishedAt: pastDate, scheduleCleared: false });
    expect(resolveRevertedPublishState({
      status: CMS_ENTRY_STATUS.PUBLISHED,
      versionPublishedAt: null,
      currentPublishedAt: null,
      now,
    })).toEqual({ status: CMS_ENTRY_STATUS.PUBLISHED, publishedAt: now, scheduleCleared: false });
  });

  // The current row can be scheduled for later; a live page must not show that future date.
  test("a published restore never takes a future date", () => {
    expect(resolveRevertedPublishState({
      status: CMS_ENTRY_STATUS.PUBLISHED,
      versionPublishedAt: null,
      currentPublishedAt: futureDate,
      now,
    }).publishedAt).toEqual(now);
  });

  test("a draft or archived restore keeps whatever date there is, or none", () => {
    for (const status of [CMS_ENTRY_STATUS.DRAFT, CMS_ENTRY_STATUS.ARCHIVED]) {
      expect(resolveRevertedPublishState({
        status,
        versionPublishedAt: null,
        currentPublishedAt: pastDate,
        now,
      })).toEqual({ status, publishedAt: pastDate, scheduleCleared: false });
      expect(resolveRevertedPublishState({
        status,
        versionPublishedAt: null,
        currentPublishedAt: null,
        now,
      })).toEqual({ status, publishedAt: null, scheduleCleared: false });
    }
  });
});
