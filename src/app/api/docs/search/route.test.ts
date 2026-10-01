import { describe, expect, test, vi } from "vitest";

import { DOCS_SEARCH_CACHE_CONTROL } from "@/constants/cache-control";
import { CACHE_TAGS } from "@/constants/cache-tags";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

const { searchDocsMock } = vi.hoisted(() => ({ searchDocsMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/i18n/server", () => ({ getTranslations: vi.fn() }));
vi.mock("@/lib/cms/cms-search", () => ({ searchDocs: searchDocsMock }));
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { DOCS_SEARCH: {} },
  RateLimitError: class extends Error {},
  withRateLimit: (action: () => Promise<unknown>) => action(),
}));

const { GET } = await import("./route");

describe("GET /api/docs/search", () => {
  // The edge stores the answer, so a docs publish reaches it only through this tag.
  test("tags the stored answer with the docs search collection", async () => {
    searchDocsMock.mockResolvedValue([]);

    const response = await GET(new Request("https://example.com/api/docs/search?q=billing"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(DOCS_SEARCH_CACHE_CONTROL);
    expect(response.headers.get("cache-tag")).toBe(CACHE_TAGS.cmsSearchCollection(DOCS_SLUG));
  });
});
