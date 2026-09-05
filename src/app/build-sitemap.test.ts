import { beforeEach, describe, expect, test, vi } from "vitest";

import { BLOG_LISTING_ROUTES } from "@/constants/public-routes";
import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { BLOG_BASE_PATH, getBlogCollectionPagePath } from "@/lib/blog-routing";

const {
  getBlogPageCountsByPath,
  getCmsCollection,
  getCmsNavigations,
  getCmsNavigationTree,
  getEntryLocalesForSlugs,
  setCacheScope,
} = vi.hoisted(() => ({
  getBlogPageCountsByPath: vi.fn(),
  getCmsCollection: vi.fn(),
  getCmsNavigations: vi.fn(),
  getCmsNavigationTree: vi.fn(),
  getEntryLocalesForSlugs: vi.fn(),
  setCacheScope: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/cms/entry", () => ({ getCmsCollection, getEntryLocalesForSlugs }));
vi.mock("@/lib/cms/blog-list-artifacts", () => ({ getBlogPageCountsByPath }));
vi.mock("@/lib/cms/cms-navigation-config", () => ({ getCmsNavigations }));
vi.mock("@/lib/cms/cms-navigation-repository", () => ({
  getCmsNavigationTree,
  flattenCmsNavigationTree: (nodes: unknown[]) => nodes,
}));
vi.mock("@/utils/cache", async () => ({
  ...await import("@/constants/cache-tags"), setCacheScope,
}));

const { buildSitemap } = await import("./build-sitemap");
const { absoluteLocalizedUrl } = await import("@/utils/i18n-urls");

const TAG_PATH = "/blog/tags/topic";
const AUTHOR_PATH = "/blog/authors/author-1";
// Every facet runs more than one page, so a numbered row would appear if one were emitted.
const PAGE_COUNTS: Record<string, number> = {
  [BLOG_BASE_PATH]: 3,
  [TAG_PATH]: 2,
  [AUTHOR_PATH]: 2,
};
const FACET_PATHS = [BLOG_BASE_PATH, TAG_PATH, AUTHOR_PATH];

function urlFor({ pathname, locale }: { pathname: string; locale: Locale }): string {
  return absoluteLocalizedUrl({ pathname, locale });
}

async function buildSitemapUrls(): Promise<string[]> {
  return (await buildSitemap()).map((entry) => entry.url);
}

beforeEach(() => {
  vi.clearAllMocks();
  getCmsCollection.mockResolvedValue([]);
  getEntryLocalesForSlugs.mockResolvedValue(new Map());
  getCmsNavigations.mockReturnValue([]);
  getCmsNavigationTree.mockResolvedValue([]);
  getBlogPageCountsByPath.mockResolvedValue(PAGE_COUNTS);
});

describe("blog sitemap rows", () => {
  test("reads page counts once, for the default locale only", async () => {
    await buildSitemap();

    expect(getBlogPageCountsByPath).toHaveBeenCalledTimes(1);
    expect(getBlogPageCountsByPath).toHaveBeenCalledWith(DEFAULT_LOCALE);
  });

  test("keeps page one of every listing route and facet", async () => {
    const urls = await buildSitemapUrls();

    BLOG_LISTING_ROUTES.forEach(({ pathname }) => {
      expect(urls).toContain(urlFor({ pathname, locale: DEFAULT_LOCALE }));
    });
    expect(urls).toContain(urlFor({ pathname: TAG_PATH, locale: DEFAULT_LOCALE }));
    expect(urls).toContain(urlFor({ pathname: AUTHOR_PATH, locale: DEFAULT_LOCALE }));
  });

  test("never advertises a numbered page of any list or facet", async () => {
    const urls = await buildSitemapUrls();

    FACET_PATHS.forEach((pathname) => {
      [2, 3].forEach((page) => {
        const numbered = getBlogCollectionPagePath({ pathname, page });
        ENABLED_LOCALES.forEach((locale) => {
          expect(urls).not.toContain(urlFor({ pathname: numbered, locale }));
        });
      });
    });
  });

  test("drops every blog row when the blog has no default-locale posts", async () => {
    getBlogPageCountsByPath.mockResolvedValue({});

    const urls = await buildSitemapUrls();

    expect(urls.some((url) => url.includes(BLOG_BASE_PATH))).toBe(false);
  });
});
