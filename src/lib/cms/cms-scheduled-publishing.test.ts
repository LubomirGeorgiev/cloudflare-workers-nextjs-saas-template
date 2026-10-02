import { afterEach, describe, expect, test, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";

const {
  getDBMock,
  invalidateEntryAndCollectionMock,
  syncCmsEntrySearchMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  invalidateEntryAndCollectionMock: vi.fn(),
  syncCmsEntrySearchMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

// The timer calls into `entry/publishing`, which also carries the queue side of a publish schedule.
// Its own test asserts that; here the Worker bindings only have to stay out of the way.
vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/scheduler/scheduler", () => ({
  deleteScheduledJobs: vi.fn(),
  scheduleJob: vi.fn(),
}));

vi.mock("@/lib/cms/cms-cache-invalidation", () => ({
  getKnownCmsCollectionSlug: (collectionSlug: string) => collectionSlug,
  invalidateEntryAndCollection: invalidateEntryAndCollectionMock,
}));

vi.mock("@/lib/cms/cms-search", () => ({
  syncCmsEntrySearch: syncCmsEntrySearchMock,
}));

const { publishScheduledCmsEntryIfDue } = await import("@/lib/cms/cms-scheduled-publishing");

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
      warm: true,
    });
  });
});
