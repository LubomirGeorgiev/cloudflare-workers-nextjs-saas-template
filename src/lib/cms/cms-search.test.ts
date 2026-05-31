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
});
