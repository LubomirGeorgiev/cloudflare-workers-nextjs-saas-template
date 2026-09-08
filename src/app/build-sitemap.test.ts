import { beforeEach, describe, expect, test, vi } from "vitest";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { I18N_ENABLED } from "@/constants";
import { BLOG_LISTING_ROUTES } from "@/constants/public-routes";
import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { BLOG_BASE_PATH, getBlogCollectionPagePath } from "@/lib/blog-routing";
import type { DefineCmsCollection } from "@/lib/cms/cms-models";

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

/** The first collection this install advertises through its own preview path. */
const SITEMAP_COLLECTION = (
  Object.entries(cmsConfig.collections) as Array<[CollectionsUnion, DefineCmsCollection]>
).find(
  ([, collection]) =>
    collection.includeInSitemap !== false && !collection.navigationKey && collection.previewUrl,
);

const ENTRY_SLUG = "launch-day";

// The page collector carries only `(collection, slug)`; the locale lookup that turns those into
// hreflang rows is a sitemap concern, so the admin edge-HTML purge never pays for it.
describe.skipIf(!SITEMAP_COLLECTION)("CMS entry alternates", () => {
  const [collectionSlug, collection] = SITEMAP_COLLECTION as NonNullable<typeof SITEMAP_COLLECTION>;
  const entryPath = collection.previewUrl?.(ENTRY_SLUG) as string;

  beforeEach(() => {
    getCmsCollection.mockImplementation(async (params: { collectionSlug: CollectionsUnion }) =>
      params.collectionSlug === collectionSlug
        ? [{ slug: ENTRY_SLUG, updatedAt: new Date() }]
        : [],
    );
  });

  test("resolves the locales of every entry slug in one lookup per collection", async () => {
    const urls = await buildSitemapUrls();

    expect(getEntryLocalesForSlugs).toHaveBeenCalledWith({ collectionSlug, slugs: [ENTRY_SLUG] });
    expect(urls).toContain(urlFor({ pathname: entryPath, locale: DEFAULT_LOCALE }));
  });

  // A fallback render serves default-locale content and is `noindex`, so it gets no hreflang row.
  test("advertises no alternate for a locale the entry has no row in", async () => {
    const rows = await buildSitemap();
    const entryRow = rows.find(
      (row) => row.url === urlFor({ pathname: entryPath, locale: DEFAULT_LOCALE }),
    );

    expect(entryRow?.alternates?.languages).toEqual({});
  });

  // Single-locale mode advertises no hreflang at all, so there is nothing to assert there.
  test.skipIf(!I18N_ENABLED)("advertises the locales the entry really has", async () => {
    getEntryLocalesForSlugs.mockResolvedValue(new Map([[ENTRY_SLUG, new Set(ENABLED_LOCALES)]]));

    const rows = await buildSitemap();
    const entryRow = rows.find(
      (row) => row.url === urlFor({ pathname: entryPath, locale: DEFAULT_LOCALE }),
    );

    ENABLED_LOCALES.forEach((locale) => {
      expect(entryRow?.alternates?.languages?.[locale]).toBe(urlFor({ pathname: entryPath, locale }));
    });
  });
});
