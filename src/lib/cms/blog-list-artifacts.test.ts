import { beforeEach, describe, expect, test, vi } from "vitest";
import { BLOG_POSTS_PER_PAGE } from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES, type Locale } from "@/i18n/config";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import type { CmsCollectionListItem } from "@/lib/cms/entry";
import { getAuthorRouteParam } from "@/utils/blog-author-url";

const { getEntries, getTags, setCacheScope } = vi.hoisted(() => ({
  getEntries: vi.fn(), getTags: vi.fn(), setCacheScope: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cms/entry", () => ({ getCmsCollection: getEntries }));
vi.mock("@/lib/cms/tags", () => ({ getCmsTags: getTags }));
vi.mock("@/utils/cache", async () => ({
  ...await import("@/constants/cache-tags"), setCacheScope,
}));

const { getBlogAuthors, getBlogFacetPage, getBlogPageCounts, getBlogPageCountsByPath } =
  await import("./blog-list-artifacts");
const { CACHE_TAGS } = await import("@/constants/cache-tags");
const LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) ?? DEFAULT_LOCALE;
const AUTHOR = { id: "author", firstName: "Ada", lastName: null, email: null, avatar: null };
const TAG = { id: "tag", slug: "topic" };

function post(index: number): CmsCollectionListItem {
  return { id: `post-${index}`, createdByUser: AUTHOR, tags: [{ tag: TAG }] } as CmsCollectionListItem;
}

beforeEach(() => {
  vi.clearAllMocks();
  getEntries.mockResolvedValue(Array.from({ length: BLOG_POSTS_PER_PAGE + 1 }, (_, index) => post(index)));
  getTags.mockResolvedValue([TAG]);
});

describe("cached blog lists", () => {
  test("counts authors while preserving the distinction between no posts and no authors", async () => {
    const result = await getBlogAuthors(LOCALE);
    expect(result.authors).toEqual([{ ...AUTHOR, postCount: BLOG_POSTS_PER_PAGE + 1 }]);
    getEntries.mockResolvedValue([{ id: "anonymous" }]);
    expect(await getBlogAuthors(LOCALE)).toEqual({ hasPosts: true, authors: [] });
    getEntries.mockResolvedValue([]);
    expect(await getBlogAuthors(LOCALE)).toEqual({ hasPosts: false, authors: [] });
  });

  test("returns every post of an author, unsliced, with the author as the subject", async () => {
    const result = await getBlogFacetPage({ locale: LOCALE, facet: { type: "author", authorId: AUTHOR.id } });
    expect(result?.subject).toEqual(AUTHOR);
    expect(result?.posts).toHaveLength(BLOG_POSTS_PER_PAGE + 1);
    expect(getEntries).toHaveBeenCalledTimes(1);
    expect(getEntries).toHaveBeenCalledWith(expect.objectContaining({ locale: LOCALE }));
    expect(setCacheScope).toHaveBeenCalledWith({ tags: [CACHE_TAGS.cmsCollection("blog")], ttl: "8 hours" });
  });

  test("returns null for an author with no posts", async () => {
    expect(await getBlogFacetPage({ locale: LOCALE, facet: { type: "author", authorId: "missing" } })).toBeNull();
  });

  test("filters tag posts and refreshes on tag or collection changes", async () => {
    getEntries.mockResolvedValue([{ ...post(-1), tags: [] }, ...Array.from({ length: BLOG_POSTS_PER_PAGE + 1 }, (_, index) => post(index))]);
    const result = await getBlogFacetPage({ locale: LOCALE, facet: { type: "tag", slug: TAG.slug } });
    expect(result?.subject).toEqual(TAG);
    expect(result?.posts.map((entry) => entry.id)).not.toContain("post--1");
    expect(result?.posts).toHaveLength(BLOG_POSTS_PER_PAGE + 1);
    expect(setCacheScope).toHaveBeenCalledWith({
      tags: [CACHE_TAGS.cmsCollection("blog"), CACHE_TAGS.CMS_TAGS], ttl: "8 hours",
    });
  });

  test("does not load posts for a missing tag", async () => {
    expect(await getBlogFacetPage({ locale: LOCALE, facet: { type: "tag", slug: "missing" } })).toBeNull();
    expect(getEntries).not.toHaveBeenCalled();
  });
});

describe("blog page counts", () => {
  const AUTHOR_PATH = `/blog/authors/${getAuthorRouteParam(AUTHOR)}`;
  const TAG_PATH = `/blog/tags/${TAG.slug}`;
  const NON_DEFAULT_LOCALES = ENABLED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

  beforeEach(() => {
    // Two pages in the default locale, one in every other: the case the sitemap
    // used to get wrong by publishing default-locale page numbers for all locales.
    getEntries.mockImplementation(({ locale }: { locale: Locale }) =>
      Promise.resolve(Array.from(
        { length: locale === DEFAULT_LOCALE ? BLOG_POSTS_PER_PAGE + 1 : 1 },
        (_, index) => post(index),
      )));
  });

  test("counts the main list and every facet from a single read per locale", async () => {
    expect(await getBlogPageCountsByPath(DEFAULT_LOCALE)).toEqual({
      [BLOG_BASE_PATH]: 2,
      [AUTHOR_PATH]: 2,
      [TAG_PATH]: 2,
    });
    expect(getEntries).toHaveBeenCalledTimes(1);
    expect(setCacheScope).toHaveBeenCalledWith({
      tags: [CACHE_TAGS.cmsCollection("blog"), CACHE_TAGS.CMS_TAGS], ttl: "8 hours",
    });
  });

  test("reports a page count for every served locale", async () => {
    const counts = await getBlogPageCounts({ pathname: TAG_PATH });

    expect(Object.keys(counts)).toEqual([...ENABLED_LOCALES]);
    expect(counts[DEFAULT_LOCALE]).toBe(2);
    NON_DEFAULT_LOCALES.forEach((locale) => expect(counts[locale]).toBe(1));
  });

  test("reports zero pages for a path a locale does not have", async () => {
    const counts = await getBlogPageCounts({ pathname: "/blog/tags/absent" });

    ENABLED_LOCALES.forEach((locale) => expect(counts[locale]).toBe(0));
  });
});
