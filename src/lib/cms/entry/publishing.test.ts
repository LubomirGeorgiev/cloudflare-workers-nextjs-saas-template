import { afterEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

const {
  deleteScheduledJobsMock,
  getCloudflareContextMock,
  getDBMock,
  invalidateEntryAndCollectionMock,
  purgeCmsEntryMarkdownPagesMock,
  scheduleJobMock,
  syncCmsEntrySearchMock,
} = vi.hoisted(() => ({
  deleteScheduledJobsMock: vi.fn(),
  getCloudflareContextMock: vi.fn(),
  getDBMock: vi.fn(),
  invalidateEntryAndCollectionMock: vi.fn(),
  purgeCmsEntryMarkdownPagesMock: vi.fn(),
  scheduleJobMock: vi.fn(),
  syncCmsEntrySearchMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/lib/scheduler/scheduler", () => ({
  deleteScheduledJobs: deleteScheduledJobsMock,
  scheduleJob: scheduleJobMock,
}));

vi.mock("@/lib/cms/cms-cache-invalidation", () => ({
  getKnownCmsCollectionSlug: (collectionSlug: string) => collectionSlug,
  invalidateEntryAndCollection: invalidateEntryAndCollectionMock,
}));

vi.mock("@/lib/cms/cms-search", () => ({
  syncCmsEntrySearch: syncCmsEntrySearchMock,
}));

// The KV sweep needs a Worker binding; `cms-entry-page-purge.test.ts` covers the paths it derives.
vi.mock("@/lib/cms/cms-entry-page-purge", () => ({
  purgeCmsEntryMarkdownPages: purgeCmsEntryMarkdownPagesMock,
}));

const {
  publishCmsEntryNow,
  syncCmsPublishSchedule,
} = await import("@/lib/cms/entry/publishing");

/** Any configured collection: the fork's own first one, so a renamed catalog still runs this. */
const COLLECTION = collectionSlugs[0];

const DRAFT_ENTRY = {
  id: "entry-1",
  collection: COLLECTION,
  slug: "hello-world",
  locale: "en",
  title: "Hello world",
  content: { type: "doc", content: [] },
  fields: { subtitle: "A subtitle" },
  seoDescription: "A short description",
  status: CMS_ENTRY_STATUS.DRAFT,
  publishedAt: null,
  featuredImageId: "cms_media_1",
  createdBy: "user-1",
};

const NOW = new Date("2026-05-29T10:00:00.000Z");

function mockDatabase({
  existingEntry,
  latestVersion,
}: {
  existingEntry: unknown;
  latestVersion?: { versionNumber: number };
}) {
  const setMock = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => (
        existingEntry ? [{ ...(existingEntry as object), status: CMS_ENTRY_STATUS.PUBLISHED }] : []
      )),
    })),
  }));
  const insertValuesMock = vi.fn();

  getDBMock.mockReturnValue({
    query: {
      cmsEntryTable: { findFirst: vi.fn(async () => existingEntry) },
      cmsEntryVersionTable: { findFirst: vi.fn(async () => latestVersion ?? undefined) },
    },
    update: vi.fn(() => ({ set: setMock })),
    insert: vi.fn(() => ({ values: insertValuesMock })),
  });

  return { insertValuesMock, setMock };
}

describe("CMS entry publishing", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("schedules a publish job with a stable dedupe key", async () => {
    const queue = { send: vi.fn() };
    getCloudflareContextMock.mockResolvedValue({ env: { SCHEDULER_QUEUE: queue } });

    await syncCmsPublishSchedule({
      id: "entry-1",
      status: CMS_ENTRY_STATUS.SCHEDULED,
      publishedAt: NOW,
    });

    expect(scheduleJobMock).toHaveBeenCalledWith({
      queue,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-entry:entry-1",
      payload: { entryId: "entry-1" },
      runAt: NOW,
    });
    expect(deleteScheduledJobsMock).not.toHaveBeenCalled();
  });

  test("deletes the publish job when the entry is not scheduled", async () => {
    getCloudflareContextMock.mockResolvedValue({ env: { SCHEDULER_QUEUE: { send: vi.fn() } } });

    await syncCmsPublishSchedule({
      id: "entry-1",
      status: CMS_ENTRY_STATUS.DRAFT,
      publishedAt: NOW,
    });

    expect(deleteScheduledJobsMock).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-entry:entry-1",
    });
    expect(scheduleJobMock).not.toHaveBeenCalled();
  });

  test("writes a version row for a publish that has history already", async () => {
    const { insertValuesMock } = mockDatabase({
      existingEntry: DRAFT_ENTRY,
      latestVersion: { versionNumber: 4 },
    });

    await publishCmsEntryNow({ entryId: DRAFT_ENTRY.id, now: NOW });

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith({
      entryId: DRAFT_ENTRY.id,
      versionNumber: 5,
      title: DRAFT_ENTRY.title,
      content: DRAFT_ENTRY.content,
      fields: DRAFT_ENTRY.fields,
      slug: DRAFT_ENTRY.slug,
      seoDescription: DRAFT_ENTRY.seoDescription,
      status: CMS_ENTRY_STATUS.PUBLISHED,
      featuredImageId: DRAFT_ENTRY.featuredImageId,
      createdBy: DRAFT_ENTRY.createdBy,
    });
  });

  test("seeds version 1 with the pre-publish state when the entry has no history", async () => {
    const { insertValuesMock } = mockDatabase({ existingEntry: DRAFT_ENTRY });

    await publishCmsEntryNow({ entryId: DRAFT_ENTRY.id, now: NOW });

    expect(insertValuesMock).toHaveBeenCalledTimes(2);
    expect(insertValuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      entryId: DRAFT_ENTRY.id,
      versionNumber: 1,
      status: DRAFT_ENTRY.status,
    }));
    expect(insertValuesMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      entryId: DRAFT_ENTRY.id,
      versionNumber: 2,
      status: CMS_ENTRY_STATUS.PUBLISHED,
    }));
  });

  test("writes no version row when the entry is already published", async () => {
    const { insertValuesMock } = mockDatabase({
      existingEntry: {
        ...DRAFT_ENTRY,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      latestVersion: { versionNumber: 4 },
    });

    await publishCmsEntryNow({ entryId: DRAFT_ENTRY.id, now: NOW });

    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  test("stamps publishedAt only when the entry has none", async () => {
    const { setMock } = mockDatabase({ existingEntry: DRAFT_ENTRY });

    await publishCmsEntryNow({ entryId: DRAFT_ENTRY.id, now: NOW });

    expect(setMock).toHaveBeenCalledWith({
      status: CMS_ENTRY_STATUS.PUBLISHED,
      publishedAt: NOW,
    });

    vi.clearAllMocks();
    const republished = mockDatabase({
      existingEntry: { ...DRAFT_ENTRY, publishedAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    await publishCmsEntryNow({ entryId: DRAFT_ENTRY.id, now: NOW });

    expect(republished.setMock).toHaveBeenCalledWith({ status: CMS_ENTRY_STATUS.PUBLISHED });
  });

  test("cancels the publish timer and runs the published-entry effects", async () => {
    mockDatabase({ existingEntry: DRAFT_ENTRY, latestVersion: { versionNumber: 1 } });

    await publishCmsEntryNow({ entryId: DRAFT_ENTRY.id, now: NOW });

    expect(deleteScheduledJobsMock).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-entry:entry-1",
    });
    expect(syncCmsEntrySearchMock).toHaveBeenCalledWith({
      entryId: DRAFT_ENTRY.id,
      collection: COLLECTION,
      slug: DRAFT_ENTRY.slug,
      title: DRAFT_ENTRY.title,
      seoDescription: DRAFT_ENTRY.seoDescription,
      content: DRAFT_ENTRY.content,
    });
    expect(invalidateEntryAndCollectionMock).toHaveBeenCalledWith({
      collectionSlug: COLLECTION,
      slug: DRAFT_ENTRY.slug,
    });
    expect(purgeCmsEntryMarkdownPagesMock).toHaveBeenCalledWith({
      entries: [{ collection: COLLECTION, slug: DRAFT_ENTRY.slug }],
    });
  });

  test("returns null without any write when the entry does not exist", async () => {
    const { insertValuesMock, setMock } = mockDatabase({ existingEntry: undefined });

    await expect(publishCmsEntryNow({ entryId: "missing", now: NOW })).resolves.toBeNull();

    expect(setMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(deleteScheduledJobsMock).not.toHaveBeenCalled();
    expect(syncCmsEntrySearchMock).not.toHaveBeenCalled();
  });
});
