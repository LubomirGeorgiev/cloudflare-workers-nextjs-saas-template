import { afterEach, describe, expect, test, vi } from "vitest";

import { CACHE_TAGS } from "@/constants/cache-tags";
import type { WorkersCachePurgeOutcome } from "@/constants/cache-purge";

const {
  getCloudflareContextMock,
  getDBMock,
  invalidateCmsEntriesMock,
  purgeWorkersCacheAfterWriteMock,
  requireAdminMock,
  syncCmsEntrySearchMock,
} = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
  getDBMock: vi.fn(),
  invalidateCmsEntriesMock: vi.fn(),
  purgeWorkersCacheAfterWriteMock: vi.fn(async (): Promise<WorkersCachePurgeOutcome> => "ok"),
  requireAdminMock: vi.fn(),
  syncCmsEntrySearchMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/auth", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/utils/with-user-rate-limit", () => ({
  withUserRateLimit: vi.fn((callback: () => unknown) => callback()),
}));

vi.mock("@/lib/edge/purge-workers-cache-after-write", () => ({
  purgeWorkersCacheAfterWrite: purgeWorkersCacheAfterWriteMock,
}));

vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { SETTINGS: { limit: 1, window: "1 minute" } },
  withRateLimit: vi.fn((callback: () => unknown) => callback()),
}));

const actionClientMock = {
  action: (handler: (args: { parsedInput: unknown }) => unknown) => {
    return (input?: unknown) => handler({ parsedInput: input });
  },
  inputSchema() {
    return actionClientMock;
  },
  metadata() {
    return actionClientMock;
  },
};

vi.mock("@/lib/safe-action", () => ({
  actionClient: actionClientMock,
}));

vi.mock("@/lib/cms/cms-cache-invalidation", () => ({
  invalidateCmsEntries: invalidateCmsEntriesMock,
}));

vi.mock("@/lib/cms/cms-search", () => ({
  syncCmsEntrySearch: syncCmsEntrySearchMock,
}));

const { deleteCmsMediaAction, updateCmsMediaAction } = await import("./cms-media-actions");
const { reportCmsCachePurge } = await import("@/lib/cms/cms-cache-purge-report");
const { CMS_CACHE_PURGE_OK, CMS_PURGE_STATUS, WORKERS_CACHE_PURGE_OUTCOME } = await import(
  "@/constants/cache-purge"
);

const ZONE_PURGE_FAILED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };

const DELETED_BUCKET_KEY = "cms-images/docs/deleted.png";

function selectWhereResult(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(result),
    })),
  };
}

function selectJoinWhereResult(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(result),
      })),
    })),
  };
}

function mockMediaUpdateDb() {
  const content = {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "/api/cms-images/cms-images/docs/hero.png",
          alt: "Old alt",
        },
      },
    ],
  };
  const mediaSetMock = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: "media_hero" }]),
    })),
  }));
  const updateWhereMock = vi.fn().mockResolvedValue(undefined);
  const db = {
    select: vi
      .fn()
      .mockReturnValueOnce(selectWhereResult([
        {
          id: "media_hero",
          bucketKey: "cms-images/docs/hero.png",
        },
      ]))
      .mockReturnValueOnce(selectJoinWhereResult([
        {
          id: "entry_docs_intro",
          collection: "docs",
          slug: "intro",
          title: "Intro",
          seoDescription: "Intro SEO",
          content,
        },
      ])),
    update: vi
      .fn()
      .mockReturnValueOnce({ set: mediaSetMock })
      .mockReturnValueOnce({
        set: vi.fn(() => ({
          where: updateWhereMock,
        })),
      }),
  };
  getDBMock.mockReturnValue(db);
  requireAdminMock.mockResolvedValue({ userId: "usr_admin" });

  return { mediaSetMock, updateWhereMock };
}

function mockMediaDeleteDb() {
  const r2DeleteMock = vi.fn(async () => undefined);
  const rowDeleteWhereMock = vi.fn(async () => undefined);
  getDBMock.mockReturnValue({
    select: vi
      .fn()
      .mockReturnValueOnce(selectWhereResult([{ id: "media_deleted", bucketKey: DELETED_BUCKET_KEY }]))
      .mockReturnValueOnce(selectWhereResult([{ count: 0 }])),
    delete: vi.fn(() => ({ where: rowDeleteWhereMock })),
  });
  getCloudflareContextMock.mockResolvedValue({ env: { R2_BUCKET: { delete: r2DeleteMock } } });
  requireAdminMock.mockResolvedValue({ userId: "usr_admin" });

  return { r2DeleteMock, rowDeleteWhereMock };
}

describe("CMS media actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("updateCmsMediaAction resyncs CMS search when embedded image alt text changes", async () => {
    const { updateWhereMock } = mockMediaUpdateDb();

    await updateCmsMediaAction({
      mediaId: "media_hero",
      alt: "New searchable alt",
    });

    expect(updateWhereMock).toHaveBeenCalled();
    expect(syncCmsEntrySearchMock).toHaveBeenCalledWith({
      entryId: "entry_docs_intro",
      collection: "docs",
      slug: "intro",
      title: "Intro",
      seoDescription: "Intro SEO",
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "/api/cms-images/cms-images/docs/hero.png",
              alt: "New searchable alt",
              title: "New searchable alt",
            },
          },
        ],
      },
    });
    // One call per action, not per affected entry, so the action sends one Workers Caching purge.
    expect(invalidateCmsEntriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateCmsEntriesMock).toHaveBeenCalledWith({
      entries: [{ collection: "docs", slug: "intro" }],
    });
  });

  // The alt text is saved either way; the media page shows a warning toast from this field.
  test("updateCmsMediaAction reports a failed zone purge from the entry invalidation", async () => {
    mockMediaUpdateDb();
    invalidateCmsEntriesMock.mockImplementationOnce(async () => {
      reportCmsCachePurge(ZONE_PURGE_FAILED);
    });

    const result = await updateCmsMediaAction({ mediaId: "media_hero", alt: "New alt" });

    expect(result).toEqual(expect.objectContaining({ success: true, cachePurge: ZONE_PURGE_FAILED }));
  });

  test("updateCmsMediaAction reports no failure when the zone purge went through", async () => {
    mockMediaUpdateDb();
    invalidateCmsEntriesMock.mockImplementationOnce(async () => {
      reportCmsCachePurge(CMS_CACHE_PURGE_OK);
    });

    const result = await updateCmsMediaAction({ mediaId: "media_hero", alt: "New alt" });

    expect(result).toEqual(expect.objectContaining({ success: true, cachePurge: CMS_CACHE_PURGE_OK }));
  });

  // Workers Caching kept a deleted image until the next deploy, because no purge named it.
  test("deleteCmsMediaAction purges the edge copy of the image after both deletes", async () => {
    const { r2DeleteMock, rowDeleteWhereMock } = mockMediaDeleteDb();

    await deleteCmsMediaAction({ mediaId: "media_deleted" });

    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledWith({
      tags: [CACHE_TAGS.cmsMedia(DELETED_BUCKET_KEY)],
    });
    const purgeOrder = purgeWorkersCacheAfterWriteMock.mock.invocationCallOrder[0];
    expect(r2DeleteMock.mock.invocationCallOrder[0]).toBeLessThan(purgeOrder);
    expect(rowDeleteWhereMock.mock.invocationCallOrder[0]).toBeLessThan(purgeOrder);
  });

  // The image stays at the edge until its TTL ends, so the admin must not read plain success.
  // The field is the same one every CMS write reports.
  test("deleteCmsMediaAction still succeeds when the edge purge fails, and says so", async () => {
    const { r2DeleteMock } = mockMediaDeleteDb();
    purgeWorkersCacheAfterWriteMock.mockResolvedValueOnce(WORKERS_CACHE_PURGE_OUTCOME.FAILED);

    const result = await deleteCmsMediaAction({ mediaId: "media_deleted" });

    expect(r2DeleteMock).toHaveBeenCalledWith(DELETED_BUCKET_KEY);
    expect(result).toEqual({
      success: true,
      cachePurge: { ...CMS_CACHE_PURGE_OK, workersCache: CMS_PURGE_STATUS.FAILED },
    });
  });

  test("deleteCmsMediaAction reports no purge failure when the edge purge went through", async () => {
    mockMediaDeleteDb();
    purgeWorkersCacheAfterWriteMock.mockResolvedValueOnce(WORKERS_CACHE_PURGE_OUTCOME.OK);

    const result = await deleteCmsMediaAction({ mediaId: "media_deleted" });

    expect(result).toEqual({ success: true, cachePurge: CMS_CACHE_PURGE_OK });
  });

  // A row that names a deleted file is a broken image; a file with no row is an orphan the sweep removes.
  test("deleteCmsMediaAction deletes the row before the R2 object", async () => {
    const { r2DeleteMock, rowDeleteWhereMock } = mockMediaDeleteDb();

    await deleteCmsMediaAction({ mediaId: "media_deleted" });

    expect(rowDeleteWhereMock.mock.invocationCallOrder[0])
      .toBeLessThan(r2DeleteMock.mock.invocationCallOrder[0]);
  });

  test("deleteCmsMediaAction keeps the R2 object when the row delete fails", async () => {
    const { r2DeleteMock, rowDeleteWhereMock } = mockMediaDeleteDb();
    rowDeleteWhereMock.mockRejectedValueOnce(new Error("D1 unavailable"));

    await expect(deleteCmsMediaAction({ mediaId: "media_deleted" })).rejects.toThrow();

    expect(r2DeleteMock).not.toHaveBeenCalled();
    expect(purgeWorkersCacheAfterWriteMock).not.toHaveBeenCalled();
  });

  test("updateCmsMediaAction clears the alt text and the image node attrs on an empty save", async () => {
    const { mediaSetMock } = mockMediaUpdateDb();

    await updateCmsMediaAction({ mediaId: "media_hero", alt: "" });

    expect(mediaSetMock).toHaveBeenCalledWith({ alt: null });
    expect(syncCmsEntrySearchMock).toHaveBeenCalledWith(expect.objectContaining({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "/api/cms-images/cms-images/docs/hero.png", alt: null, title: null },
          },
        ],
      },
    }));
  });
});
