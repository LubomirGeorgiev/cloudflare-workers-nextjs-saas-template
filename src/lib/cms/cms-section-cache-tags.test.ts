import { describe, expect, test } from "vitest";

import { CACHE_TAGS } from "@/constants/cache-tags";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";
import { BLOG_BASE_PATH, BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import { DOCS_BASE_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

import { markdownPageCacheTags } from "./cms-section-cache-tags";

const BLOG_TAGS = [CACHE_TAGS.cmsCollection(BLOG_COLLECTION_SLUG)];
const BLOG_TAG_PAGE_TAGS = [CACHE_TAGS.cmsCollection(BLOG_COLLECTION_SLUG), CACHE_TAGS.CMS_TAGS];
// The docs loader resolves a page through the navigation tree and its redirects.
const DOCS_TAGS = [CACHE_TAGS.cmsNavigation(DOCS_SLUG), CACHE_TAGS.cmsRedirect(DOCS_SLUG)];
const SERVED_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

describe("markdownPageCacheTags", () => {
  test.each(STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname))(
    "gives the static page %s no tag",
    (pathname) => {
      expect(markdownPageCacheTags(pathname)).toEqual([]);
    },
  );

  test.each([...INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname), DOCS_BASE_PATH])(
    "tags the docs page %s with the docs navigation and redirects",
    (pathname) => {
      expect(markdownPageCacheTags(pathname)).toEqual(DOCS_TAGS);
    },
  );

  test.each([BLOG_BASE_PATH, `${BLOG_BASE_PATH}/2`, `${BLOG_BASE_PATH}/authors`, `${BLOG_BASE_PATH}/authors/ada/2`])(
    "tags the blog listing page %s with the blog collection",
    (pathname) => {
      expect(markdownPageCacheTags(pathname)).toEqual(BLOG_TAGS);
    },
  );

  test.each([`${BLOG_BASE_PATH}/tags`, `${BLOG_BASE_PATH}/tags/react`, `${BLOG_BASE_PATH}/tags/react/3`])(
    "tags the blog tag page %s with the tag list and the blog collection",
    (pathname) => {
      expect(markdownPageCacheTags(pathname)).toEqual(BLOG_TAG_PAGE_TAGS);
    },
  );

  test("covers every blog listing route", () => {
    for (const { pathname } of BLOG_LISTING_ROUTES) {
      expect(markdownPageCacheTags(pathname)).toEqual(expect.arrayContaining(BLOG_TAGS));
    }
  });

  test("does not match a sibling path that only shares the prefix", () => {
    expect(markdownPageCacheTags(`${BLOG_BASE_PATH}roll`)).toEqual([]);
    expect(markdownPageCacheTags(`${DOCS_BASE_PATH}-archive`)).toEqual([]);
  });

  test.runIf(SERVED_LOCALE !== undefined)("reads through a served locale prefix", () => {
    const locale = SERVED_LOCALE!;

    expect(markdownPageCacheTags(localizedPagePathname({ locale, pathname: BLOG_BASE_PATH }))).toEqual(BLOG_TAGS);
    expect(markdownPageCacheTags(localizedPagePathname({ locale, pathname: DOCS_BASE_PATH }))).toEqual(DOCS_TAGS);
    expect(markdownPageCacheTags(localizedPagePathname({ locale, pathname: "/" }))).toEqual([]);
  });
});
