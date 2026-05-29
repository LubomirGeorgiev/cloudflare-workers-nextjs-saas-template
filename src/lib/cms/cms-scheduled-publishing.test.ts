import { afterEach, describe, expect, test, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

const {
  deleteScheduledJobsMock,
  getCloudflareContextMock,
  getDBMock,
  invalidateEntryAndCollectionMock,
  scheduleJobMock,
  syncCmsEntrySearchMock,
} = vi.hoisted(() => ({
  deleteScheduledJobsMock: vi.fn(),
  getCloudflareContextMock: vi.fn(),
  getDBMock: vi.fn(),
  invalidateEntryAndCollectionMock: vi.fn(),
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

const {
  publishScheduledCmsEntryIfDue,
  syncCmsPublishSchedule,
} = await import("@/lib/cms/cms-scheduled-publishing");

function createUpdateChain(returnedEntries: unknown[]) {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => returnedEntries),
      })),
    })),
  };
}

describe("CMS scheduled publishing", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("schedules CMS publish jobs with a stable dedupe key", async () => {
    const queue = { send: vi.fn() };
    const publishedAt = new Date("2026-05-29T10:00:00.000Z");
    getCloudflareContextMock.mockResolvedValue({
      env: { SCHEDULER_QUEUE: queue },
    });

    await syncCmsPublishSchedule({
      id: "entry-1",
      status: CMS_ENTRY_STATUS.SCHEDULED,
      publishedAt,
    });

    expect(scheduleJobMock).toHaveBeenCalledWith({
      queue,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-entry:entry-1",
      payload: { entryId: "entry-1" },
      runAt: publishedAt,
    });
    expect(deleteScheduledJobsMock).not.toHaveBeenCalled();
  });

  test("deletes CMS publish jobs when the entry is not scheduled", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: { SCHEDULER_QUEUE: { send: vi.fn() } },
    });

    await syncCmsPublishSchedule({
      id: "entry-1",
      status: CMS_ENTRY_STATUS.DRAFT,
      publishedAt: new Date("2026-05-29T10:00:00.000Z"),
    });

    expect(deleteScheduledJobsMock).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-entry:entry-1",
    });
    expect(scheduleJobMock).not.toHaveBeenCalled();
  });

  test("returns null without side effects when a scheduled entry is not due", async () => {
    const updateChain = createUpdateChain([]);
    getDBMock.mockReturnValue({
      update: vi.fn(() => updateChain),
    });

    await expect(publishScheduledCmsEntryIfDue({
      entryId: "entry-1",
      now: new Date("2026-05-29T10:00:00.000Z"),
    })).resolves.toBeNull();

    expect(syncCmsEntrySearchMock).not.toHaveBeenCalled();
    expect(invalidateEntryAndCollectionMock).not.toHaveBeenCalled();
  });

  test("syncs search and invalidates caches after publishing a due entry", async () => {
    const updatedEntry = {
      id: "entry-1",
      collection: "blog",
      slug: "hello-world",
      title: "Hello world",
      seoDescription: "A short description",
      content: { type: "doc", content: [] },
    };
    const updateChain = createUpdateChain([updatedEntry]);
    getDBMock.mockReturnValue({
      update: vi.fn(() => updateChain),
    });

    await expect(publishScheduledCmsEntryIfDue({
      entryId: "entry-1",
      now: new Date("2026-05-29T10:00:00.000Z"),
    })).resolves.toBe(updatedEntry);

    expect(updateChain.set).toHaveBeenCalledWith({ status: CMS_ENTRY_STATUS.PUBLISHED });
    expect(syncCmsEntrySearchMock).toHaveBeenCalledWith({
      entryId: "entry-1",
      collection: "blog",
      slug: "hello-world",
      title: "Hello world",
      seoDescription: "A short description",
      content: { type: "doc", content: [] },
    });
    expect(invalidateEntryAndCollectionMock).toHaveBeenCalledWith({
      collectionSlug: "blog",
      slug: "hello-world",
    });
  });
});
