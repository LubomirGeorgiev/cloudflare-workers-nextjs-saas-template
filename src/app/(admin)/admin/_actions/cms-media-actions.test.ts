import { afterEach, describe, expect, test, vi } from "vitest";

const {
  getDBMock,
  invalidateEntryAndCollectionMock,
  requireAdminMock,
  syncCmsEntrySearchMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  invalidateEntryAndCollectionMock: vi.fn(),
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
  getCloudflareContext: vi.fn(),
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
};

vi.mock("@/lib/safe-action", () => ({
  actionClient: actionClientMock,
}));

vi.mock("@/lib/cms/cms-cache-invalidation", () => ({
  invalidateEntryAndCollection: invalidateEntryAndCollectionMock,
}));

vi.mock("@/lib/cms/cms-search", () => ({
  syncCmsEntrySearch: syncCmsEntrySearchMock,
}));

const { updateCmsMediaAction } = await import("./cms-media-actions");

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

describe("CMS media actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("updateCmsMediaAction resyncs CMS search when embedded image alt text changes", async () => {
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
        .mockReturnValueOnce({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([
                {
                  id: "media_hero",
                  alt: "New searchable alt",
                },
              ]),
            })),
          })),
        })
        .mockReturnValueOnce({
          set: vi.fn(() => ({
            where: updateWhereMock,
          })),
        }),
    };
    getDBMock.mockReturnValue(db);
    requireAdminMock.mockResolvedValue({ userId: "usr_admin" });

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
    expect(invalidateEntryAndCollectionMock).toHaveBeenCalledWith({
      collectionSlug: "docs",
      slug: "intro",
    });
  });
});
