import { afterEach, describe, expect, test, vi } from "vitest";

const { cacheLifeMock, cacheTagMock, revalidateTagMock } = vi.hoisted(() => ({
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  cacheLife: cacheLifeMock,
  cacheTag: cacheTagMock,
  revalidateTag: revalidateTagMock,
}));

const { CACHE_TAGS, revalidateCacheTag, setCacheScope } = await import("./cache");

describe("cache utilities", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("applies cache tags and life inside a cache scope", () => {
    setCacheScope({
      tags: ["stats-total-users", "cms-collection-docs"],
      ttl: "1 hour",
    });

    expect(cacheTagMock).toHaveBeenCalledWith("stats-total-users", "cms-collection-docs");
    expect(cacheLifeMock).toHaveBeenCalledWith({
      expire: 3600,
      revalidate: 3600,
    });
  });

  test("revalidates a cache tag with stale-while-revalidate semantics", () => {
    revalidateCacheTag("cms-collection-docs");

    expect(revalidateTagMock).toHaveBeenCalledWith("cms-collection-docs", "max");
  });

  test("uses Cloudflare KV data-adapter safe tag strings", () => {
    const tags = [
      CACHE_TAGS.CMS_COLLECTION,
      CACHE_TAGS.cmsCollection("docs"),
      CACHE_TAGS.cmsEntry({ collectionSlug: "docs", slug: "getting-started" }),
      CACHE_TAGS.githubStars({ owner: "cloudflare", repo: "vinext" }),
    ];

    expect(tags.every((tag) => tag.length > 0 && !tag.includes(":"))).toBe(true);
  });
});
