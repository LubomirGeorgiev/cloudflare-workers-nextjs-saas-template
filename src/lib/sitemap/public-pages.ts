import "server-only";

import { cmsConfig, type CmsNavigationKey, type CollectionsUnion } from "@/../cms.config";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { BLOG_BASE_PATH } from "@/lib/blog-routing";
import { getBlogPageCountsByPath } from "@/lib/cms/blog-list-artifacts";
import type { DefineCmsCollection } from "@/lib/cms/cms-models";
import { getCmsNavigations } from "@/lib/cms/cms-navigation-config";
import {
  flattenCmsNavigationTree,
  getCmsNavigationTree,
  type CmsNavigationTreeNode,
} from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { getCmsCollection } from "@/lib/cms/entry";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";
import { getValidDateOrNow } from "@/utils/cms-entry-dates";

/**
 * The one enumeration of the public pages this install serves: the static routes, the docs app
 * routes, the blog listings and facets, the published CMS entries, and the docs navigation pages.
 *
 * `src/app/build-sitemap.ts` turns these into sitemap rows and the admin edge-HTML purge turns them
 * into cache keys, so neither has to parse the other's output back into pathnames.
 */

type PublicPageChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

/** Names the CMS row a page renders. The sitemap resolves its hreflang alternates from this. */
interface PublicPageEntryRef {
  collectionSlug: CollectionsUnion;
  slug: string;
}

export interface PublicPage {
  /** Locale-free, leading-slash pathname. The caller adds the locale prefix it needs. */
  pathname: string;
  lastModified: Date;
  changeFrequency: PublicPageChangeFrequency;
  /** Sitemap priority. */
  priority: number;
  /**
   * Set when a CMS row backs the page, `null` for a route every locale renders. Required, so a
   * builder cannot forget its hreflang source. The locale lookup behind it is a sitemap concern.
   */
  entry: PublicPageEntryRef | null;
}

interface NavigationPageNode {
  resolvedPath: string;
  entry: NonNullable<CmsNavigationTreeNode["entry"]>;
}

// Pages per blog list path, keyed by the locale-agnostic base pathname.
type BlogPageCounts = Awaited<ReturnType<typeof getBlogPageCountsByPath>>;

const BLOG_FACET_CHANGE_FREQUENCY: PublicPageChangeFrequency = "weekly";
const BLOG_FACET_PRIORITY = 0.5;
const CMS_ENTRY_CHANGE_FREQUENCY: PublicPageChangeFrequency = "weekly";
const CMS_ENTRY_PRIORITY = 0.8;
const NAVIGATION_PAGE_CHANGE_FREQUENCY: PublicPageChangeFrequency = "weekly";
const NAVIGATION_PAGE_PRIORITY = 0.7;

function localizedRoutePage({
  pathname,
  changeFrequency,
  priority,
}: {
  pathname: string;
  changeFrequency: PublicPageChangeFrequency;
  priority: number;
}): PublicPage {
  return {
    pathname,
    lastModified: new Date(),
    changeFrequency,
    priority,
    entry: null,
  };
}

// The single dedupe pass for every source — the builders below emit raw lists and never dedupe.
// When the same pathname comes from more than one source the newest `lastModified` wins.
function dedupePublicPages(pages: PublicPage[]): PublicPage[] {
  const uniquePages = new Map<string, PublicPage>();

  pages.forEach((page) => {
    const current = uniquePages.get(page.pathname);

    if (!current || current.lastModified.getTime() < page.lastModified.getTime()) {
      uniquePages.set(page.pathname, page);
    }
  });

  return Array.from(uniquePages.values());
}

// Page one of every facet stays sourced from the default locale: an author or tag with
// no default-locale posts has no unprefixed URL to advertise.
function getBlogFacetPages(pageCounts: BlogPageCounts): PublicPage[] {
  const facetPaths = Object.keys(pageCounts).filter((basePath) => basePath !== BLOG_BASE_PATH);

  return facetPaths.map((basePath) =>
    localizedRoutePage({
      pathname: basePath,
      changeFrequency: BLOG_FACET_CHANGE_FREQUENCY,
      priority: BLOG_FACET_PRIORITY,
    })
  );
}

function getBlogPages(pageCounts: BlogPageCounts): PublicPage[] {
  const blogCollection = cmsConfig.collections.blog as DefineCmsCollection;
  const hasDefaultLocalePosts = (pageCounts[BLOG_BASE_PATH] ?? 0) > 0;

  if (blogCollection.includeInSitemap === false || !hasDefaultLocalePosts) {
    return [];
  }

  return [
    ...BLOG_LISTING_ROUTES.map(({ pathname, changeFrequency, priority }) =>
      localizedRoutePage({ pathname, changeFrequency, priority })
    ),
    ...getBlogFacetPages(pageCounts),
  ];
}

async function getCmsEntryPages(): Promise<PublicPage[]> {
  const sitemapCollections = (
    Object.entries(cmsConfig.collections) as Array<[CollectionsUnion, DefineCmsCollection]>
  ).filter(
    ([__collectionSlug, collection]) =>
      collection.includeInSitemap !== false && !collection.navigationKey
  );

  const collectionEntries = await Promise.all(
    sitemapCollections.map(([collectionSlug]) => getCmsCollection({ collectionSlug }))
  );

  return sitemapCollections.flatMap(([collectionSlug, collection], collectionIndex) => {
    const previewUrl = collection.previewUrl;

    if (!previewUrl) {
      return [];
    }

    return (collectionEntries[collectionIndex] ?? []).map((entry) => ({
      pathname: previewUrl(entry.slug),
      lastModified: getValidDateOrNow({ value: entry.updatedAt }),
      changeFrequency: CMS_ENTRY_CHANGE_FREQUENCY,
      priority: CMS_ENTRY_PRIORITY,
      entry: { collectionSlug, slug: entry.slug },
    }));
  });
}

function collectNavigationPageNodes(nodes: CmsNavigationTreeNode[]): NavigationPageNode[] {
  return flattenCmsNavigationTree(nodes).flatMap((node) =>
    node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && node.entry && node.resolvedPath
      ? [{ resolvedPath: node.resolvedPath, entry: node.entry }]
      : []
  );
}

async function getNavigationPages(navigationKey: CmsNavigationKey): Promise<PublicPage[]> {
  const pageNodes = collectNavigationPageNodes(await getCmsNavigationTree({ navigationKey }));

  return pageNodes.map(({ resolvedPath, entry }) => ({
    pathname: resolvedPath,
    lastModified: getValidDateOrNow({ value: entry.updatedAt }),
    changeFrequency: NAVIGATION_PAGE_CHANGE_FREQUENCY,
    priority: NAVIGATION_PAGE_PRIORITY,
    entry: { collectionSlug: entry.collection, slug: entry.slug },
  }));
}

// The agent-platform docs pages are app routes, not CMS documents, so they never appear in the
// navigation tree. They render inside the docs layout, which redirects away when that tree is
// empty — an install with no docs navigation must not advertise them.
function getAgentPlatformDocsPages(hasDocsNavigation: boolean): PublicPage[] {
  if (!hasDocsNavigation) {
    return [];
  }

  return INDEXED_DOCS_ROUTES.map(({ pathname, sitemapPriority }) =>
    localizedRoutePage({ pathname, changeFrequency: "weekly", priority: sitemapPriority })
  );
}

export async function collectPublicPages(): Promise<PublicPage[]> {
  const navigations = getCmsNavigations();

  const [blogPageCounts, cmsEntryPages, navigationPages] = await Promise.all([
    getBlogPageCountsByPath(DEFAULT_LOCALE),
    getCmsEntryPages(),
    Promise.all(navigations.map((navigation) => getNavigationPages(navigation.navigationKey))),
  ]);

  const docsNavigationIndex = navigations.findIndex(
    (navigation) => navigation.navigationKey === DOCS_SLUG
  );

  return dedupePublicPages([
    ...STATIC_PUBLIC_ROUTES.map(({ pathname, changeFrequency, priority }) =>
      localizedRoutePage({ pathname, changeFrequency, priority })
    ),
    ...getAgentPlatformDocsPages((navigationPages[docsNavigationIndex]?.length ?? 0) > 0),
    ...getBlogPages(blogPageCounts),
    ...cmsEntryPages,
    ...navigationPages.flat(),
  ]);
}
