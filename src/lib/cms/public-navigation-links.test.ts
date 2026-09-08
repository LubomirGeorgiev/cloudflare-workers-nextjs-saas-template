import { beforeEach, describe, expect, test, vi } from "vitest";

import { CACHE_TAGS } from "@/constants/cache-tags";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

const { hasPublishedBlogPosts, rootPath, setCacheScope } = vi.hoisted(() => ({
  hasPublishedBlogPosts: vi.fn(),
  rootPath: vi.fn(),
  setCacheScope: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/cache", async () => ({ ...await import("@/constants/cache-tags"), setCacheScope }));
vi.mock("@/lib/blog-visibility", () => ({ hasPublishedBlogPosts }));
vi.mock("@/lib/cms/cms-navigation-repository", () => ({ getCmsNavigationRootPath: rootPath }));

const { getPublicNavigationLinks } = await import("./public-navigation-links");
const { clearNavigationMemos } = await import("@/lib/cms/navigation-memos");

beforeEach(() => {
  vi.clearAllMocks();
  // Each test starts on a cold isolate; otherwise the memo answers from the previous test.
  clearNavigationMemos();
  hasPublishedBlogPosts.mockResolvedValue(true);
  rootPath.mockResolvedValue("/docs/intro");
});

describe("public navigation links", () => {
  test("answers both header questions from one entry, tagged for either publish", async () => {
    await expect(getPublicNavigationLinks()).resolves.toEqual({
      hasBlogPosts: true,
      docsRootPath: "/docs/intro",
    });
    expect(setCacheScope).toHaveBeenCalledWith({
      tags: [CACHE_TAGS.cmsCollectionCount("blog"), CACHE_TAGS.cmsNavigation(DOCS_SLUG)],
      ttl: "8 hours",
    });
  });

  // The point of the memo: a warm isolate serves a public page with no KV get for these links.
  test("a warm isolate answers from memory, and the clear forces the next read to run", async () => {
    await getPublicNavigationLinks();
    await getPublicNavigationLinks();
    expect(setCacheScope).toHaveBeenCalledOnce();
    expect(hasPublishedBlogPosts).toHaveBeenCalledOnce();

    clearNavigationMemos();
    await getPublicNavigationLinks();
    expect(setCacheScope).toHaveBeenCalledTimes(2);
  });

  test("a failed read is not held, so the next request retries", async () => {
    hasPublishedBlogPosts.mockRejectedValueOnce(new Error("transient"));

    await expect(getPublicNavigationLinks()).rejects.toThrow("transient");
    await expect(getPublicNavigationLinks()).resolves.toMatchObject({ hasBlogPosts: true });
  });
});
