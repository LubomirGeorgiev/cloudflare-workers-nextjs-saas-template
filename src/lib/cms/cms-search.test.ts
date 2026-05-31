import { afterEach, describe, expect, test, vi } from "vitest";

const {
  getDBMock,
  getCloudflareContextMock,
  withKVCacheMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  getCloudflareContextMock: vi.fn(),
  withKVCacheMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/with-kv-cache", () => ({
  CACHE_KEYS: {
    CMS_SEARCH: "cms:search",
  },
  withKVCache: withKVCacheMock,
}));

const { searchDocs } = await import("@/lib/cms/cms-search");

describe("CMS search", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("returns cached search results without touching D1", async () => {
    const cachedResults = [
      {
        entryId: "entry-1",
        title: "Cached result",
        slug: "cached-result",
        seoDescription: "Loaded from KV",
        resolvedPath: "/docs/cached-result",
        snippet: "Loaded from KV",
      },
    ];
    const d1 = {
      prepare: vi.fn(),
    };

    getCloudflareContextMock.mockResolvedValue({
      env: {
        NEXT_TAG_CACHE_D1: d1,
      },
    });
    withKVCacheMock.mockResolvedValue(cachedResults);

    await expect(searchDocs({ query: "cached", limit: 8 })).resolves.toEqual(cachedResults);

    expect(withKVCacheMock).toHaveBeenCalledOnce();
    expect(d1.prepare).not.toHaveBeenCalled();
  });

  test("rebuilds an empty docs search index on cache miss", async () => {
    const statements: Array<{ sql: string; binds: unknown[] }> = [];
    const d1 = {
      batch: vi.fn().mockResolvedValue([]),
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...binds: unknown[]) => {
          statements.push({ sql, binds });

          return {
            first: vi.fn().mockResolvedValue({ count: 0 }),
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  entryId: "cms_ent_docs002",
                  title: "Authentication Setup",
                  slug: "authentication-setup",
                  seoDescription: "Configure Lucia auth.",
                  resolvedPath: "/docs/getting-started/authentication",
                  snippet: "Authentication Setup",
                },
              ],
            }),
            run: vi.fn().mockResolvedValue({ success: true }),
          };
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    };

    getCloudflareContextMock.mockResolvedValue({
      env: {
        NEXT_TAG_CACHE_D1: d1,
      },
    });
    getDBMock.mockReturnValue({
      query: {
        cmsEntryTable: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "cms_ent_docs002",
              collection: "docs",
              slug: "authentication-setup",
              title: "Authentication Setup",
              seoDescription: "Configure Lucia auth.",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Configure auth providers." }],
                  },
                ],
              },
            },
          ]),
        },
      },
    });
    withKVCacheMock.mockImplementation(async (loader: () => Promise<unknown>) => loader());

    await expect(searchDocs({ query: "authentication", limit: 3 })).resolves.toEqual([
      {
        entryId: "cms_ent_docs002",
        title: "Authentication Setup",
        slug: "authentication-setup",
        seoDescription: "Configure Lucia auth.",
        resolvedPath: "/docs/getting-started/authentication",
        snippet: "Authentication Setup",
      },
    ]);

    expect(d1.batch).toHaveBeenCalledOnce();
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: "SELECT count(*) as count FROM cms_entry_search WHERE collection = ?",
          binds: ["docs"],
        }),
      ])
    );
  });
});
