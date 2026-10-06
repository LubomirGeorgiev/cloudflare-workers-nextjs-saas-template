import { describe, expect, test, vi } from "vitest";

import { BLOG_POSTS_PER_PAGE } from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn() }));

const {
  getBlogCollectionMetadataPage,
  getLocalesWithBlogPage,
  isBlogPageOutOfRange,
  resolveBlogCollectionPage,
  sliceBlogPage,
} = await import("./blog-pagination");

describe("resolveBlogCollectionPage", () => {
  test("reads page one from a missing param", () => {
    expect(resolveBlogCollectionPage({ pageParam: undefined })).toEqual({ type: "page", page: 1 });
  });

  test("reads a canonical numbered page", () => {
    expect(resolveBlogCollectionPage({ pageParam: "2" })).toEqual({ type: "page", page: 2 });
  });

  test("redirects an explicit page one to the bare path", () => {
    expect(resolveBlogCollectionPage({ pageParam: "1" })).toEqual({ type: "redirect", page: 1 });
  });

  test("redirects a non-canonical spelling of a page number", () => {
    expect(resolveBlogCollectionPage({ pageParam: "02" })).toEqual({ type: "redirect", page: 2 });
  });

  test("rejects a param that names no page", () => {
    expect(resolveBlogCollectionPage({ pageParam: "abc" })).toEqual({ type: "not-found" });
    expect(resolveBlogCollectionPage({ pageParam: "0" })).toEqual({ type: "not-found" });
  });
});

describe("getBlogCollectionMetadataPage", () => {
  test("reads the page a redirect points at, and page one for a 404, without a throw", () => {
    expect(getBlogCollectionMetadataPage({ pageParam: "2" })).toBe(2);
    expect(getBlogCollectionMetadataPage({ pageParam: "02" })).toBe(2);
    expect(getBlogCollectionMetadataPage({ pageParam: "abc" })).toBe(1);
  });
});

describe("isBlogPageOutOfRange", () => {
  test("renders page one even with no posts", () => {
    expect(isBlogPageOutOfRange({ page: 1, totalCount: 0 })).toBe(false);
  });

  test("keeps a numbered page that still holds posts", () => {
    expect(isBlogPageOutOfRange({ page: 2, totalCount: BLOG_POSTS_PER_PAGE + 1 })).toBe(false);
  });

  test("rejects a numbered page past the last one", () => {
    expect(isBlogPageOutOfRange({ page: 2, totalCount: BLOG_POSTS_PER_PAGE })).toBe(true);
    expect(isBlogPageOutOfRange({ page: 2, totalCount: 0 })).toBe(true);
  });
});

describe("getLocalesWithBlogPage", () => {
  test("gives page one to every served locale, whatever its post count", () => {
    expect(getLocalesWithBlogPage({ pageCounts: {}, page: 1 })).toEqual([...ENABLED_LOCALES]);
  });

  test("keeps only the locales whose page count reaches a numbered page", () => {
    const pageCounts = Object.fromEntries(
      ENABLED_LOCALES.map((locale) => [locale, locale === DEFAULT_LOCALE ? 2 : 1]),
    );

    expect(getLocalesWithBlogPage({ pageCounts, page: 2 })).toEqual([DEFAULT_LOCALE]);
    expect(getLocalesWithBlogPage({ pageCounts, page: 3 })).toEqual([]);
  });
});

describe("sliceBlogPage", () => {
  const items = Array.from({ length: BLOG_POSTS_PER_PAGE + 2 }, (_, index) => index);

  test("returns a full first page and the remainder on the next one", () => {
    expect(sliceBlogPage({ items, page: 1 })).toHaveLength(BLOG_POSTS_PER_PAGE);
    expect(sliceBlogPage({ items, page: 2 })).toEqual([BLOG_POSTS_PER_PAGE, BLOG_POSTS_PER_PAGE + 1]);
  });
});
