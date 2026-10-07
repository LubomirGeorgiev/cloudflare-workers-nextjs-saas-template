import "server-only";

import {
  cmsConfig,
  type CmsNavigationKey,
  cmsNavigationKeys,
  type CollectionsUnion,
} from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import {
  BLOG_COLLECTION_SLUG,
  CMS_TAGS_PAGE_PATH,
  getBlogListPagePaths,
} from "@/lib/blog-routing";
import { type BlogListingPostCount, getBlogListingPostCounts } from "@/lib/cms/blog-listing-post-counts";
import type { CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";
import {
  CMS_INVALIDATION_SCOPES,
  type CmsInvalidationScope,
} from "@/lib/cms/cms-invalidation-scopes";
import {
  getCmsCollectionNavigationKey,
  getCmsNavigationConfig,
} from "@/lib/cms/cms-navigation-config";
import { getCmsNavigationPagePaths } from "@/lib/cms/cms-navigation-entry-paths";
import { DOCS_EDGE_HTML_PATHNAMES } from "@/lib/cms/cms-navigation-page-purge";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import type { EdgeHtmlZonePurgeOutcome } from "@/constants/edge-html-cache";
import { purgeEdgeHtmlPages } from "@/lib/edge/edge-html-cache";
import { purgeMarkdownPageCache } from "@/lib/markdown-pages/purge-page-cache";
import type { CmsEntryStatus } from "@/types/cms";

// Every stored page and every `.md` twin sit under this prefix, and nothing else does.
const ROOT_PATHNAME = "/";

// Parent of the entry page, e.g. `/blog/launch` -> `/blog`. The listing, pagination, tag, and
// author pages that can show the entry all sit under it, so the HTML purge takes it as a subtree.
export function cmsEntryListingPath(entryPath: string): string {
  const lastSlash = entryPath.lastIndexOf("/");

  return lastSlash > 0 ? entryPath.slice(0, lastSlash) : entryPath;
}

/** The public page path of an entry, or `null` when the collection publishes no page for it. */
export function cmsEntryPagePath({
  collection,
  slug,
}: {
  collection: CollectionsUnion;
  slug: string;
}): string | null {
  const collectionConfig = cmsConfig.collections[collection];
  const previewUrlBuilder = "previewUrl" in collectionConfig
    ? collectionConfig.previewUrl
    : undefined;

  return previewUrlBuilder ? previewUrlBuilder(slug) : null;
}

interface CmsPagePurgeTargets {
  /** Stored HTML pages to delete by name. */
  pathnames: string[];
  /** Stored HTML subtrees, purged zone-wide by key prefix. */
  subtreePathnames: string[];
  /** KV `.md` twin prefixes. */
  markdownPathnames: string[];
}

/** One entry row with its status. Only a published row has a stored page to purge. */
export interface CmsEntryStatusRef extends CmsEntryRef {
  status: CmsEntryStatus;
}

/** What `purgeCmsPages` must read from D1 before `selectCmsPagePurgeTargets` can name the pages. */
interface CmsPagePurgeReads {
  navigationKeys: CmsNavigationKey[];
  blogListings: boolean;
  allEntries: boolean;
}

/**
 * The reads one CMS invalidation needs: the trees of each purged navigation, and the blog list post
 * counts for a blog subtree. Pure, so the selector and its reads cannot drift. A root purge reads
 * every tree, the blog counts, and every entry row, so the local delete reaches each known page.
 */
export function selectCmsPagePurgeReads({
  entries,
  navigationKeys,
  scopes,
}: {
  entries: CmsEntryRef[];
  navigationKeys: CmsNavigationKey[];
  scopes: CmsInvalidationScope[];
}): CmsPagePurgeReads {
  if (purgesEveryStoredPage(scopes)) {
    return {
      navigationKeys: cmsNavigationKeys.toSorted(),
      blogListings: true,
      allEntries: true,
    };
  }

  return {
    navigationKeys: selectPurgedNavigationKeys({ entries, navigationKeys }),
    blogListings: entries.some(({ collection }) => collection === BLOG_COLLECTION_SLUG)
      || scopes.includes(CMS_INVALIDATION_SCOPES.TAG_CATALOG),
    allEntries: false,
  };
}

/**
 * Which pages one CMS invalidation drops. Pure: the caller does the reads it needs first.
 * It also names each known page under a subtree, because the local delete cannot match a prefix.
 * The rules are in "The purge, and why it runs before the warm" in `docs/edge-caching.md`.
 */
export function selectCmsPagePurgeTargets({
  allEntries,
  blogListings,
  entries,
  knownPagePathnames,
  navigationKeys,
  navigationPagePaths,
  scopes,
}: {
  // Every entry row on a root purge, as `selectCmsPagePurgeReads` names it. Else empty.
  allEntries: CmsEntryStatusRef[];
  blogListings: BlogListingPostCount[];
  entries: CmsEntryRef[];
  // Pages the caller read before its write removed or moved them: they may not be under a subtree.
  knownPagePathnames: string[];
  navigationKeys: CmsNavigationKey[];
  // Every page path of the purged navigation trees, as `selectCmsPagePurgeReads` names them.
  navigationPagePaths: string[];
  scopes: CmsInvalidationScope[];
}): CmsPagePurgeTargets {
  const pathnames = new Set<string>(knownPagePathnames);
  const subtreePathnames = new Set<string>();
  const markdownPathnames = new Set<string>();
  const navigations = selectPurgedNavigationKeys({ entries, navigationKeys });

  for (const entry of entries) {
    const pagePath = cmsEntryPagePath(entry);

    if (pagePath) {
      const listingPath = cmsEntryListingPath(pagePath);

      pathnames.add(pagePath);
      subtreePathnames.add(listingPath);
      markdownPathnames.add(listingPath);
    }
  }

  for (const navigationKey of navigations) {
    const { basePath } = getCmsNavigationConfig(navigationKey);

    subtreePathnames.add(basePath);
    markdownPathnames.add(basePath);
  }

  if (scopes.includes(CMS_INVALIDATION_SCOPES.TAG_CATALOG)) {
    subtreePathnames.add(CMS_TAGS_PAGE_PATH);
    markdownPathnames.add(CMS_TAGS_PAGE_PATH);
  }

  const isFullClear = scopes.includes(CMS_INVALIDATION_SCOPES.ALL_CMS);
  const isRootPurge = purgesEveryStoredPage(scopes);

  if (isRootPurge) {
    subtreePathnames.add(ROOT_PATHNAME);

    for (const { pathname } of STATIC_PUBLIC_ROUTES) {
      pathnames.add(pathname);
    }
  }

  // A full clear may follow stale data anywhere, so every `.md` twin goes too.
  if (isFullClear) {
    markdownPathnames.add(ROOT_PATHNAME);
  }

  const subtreePages = [
    ...BLOG_LISTING_ROUTES.map(({ pathname }) => pathname),
    ...blogListings.flatMap(getBlogListPagePaths),
    ...navigationPagePaths,
    ...(navigations.includes(DOCS_SLUG) || isRootPurge ? DOCS_EDGE_HTML_PATHNAMES : []),
    ...selectPublishedEntryPagePaths(allEntries),
  ];

  // Only pages under a purged subtree: a page outside every prefix would cost a zone tag.
  for (const pathname of subtreePages) {
    if (isUnderAnySubtree({ pathname, subtreePathnames })) {
      pathnames.add(pathname);
    }
  }

  return {
    pathnames: Array.from(pathnames),
    subtreePathnames: Array.from(subtreePathnames),
    markdownPathnames: Array.from(markdownPathnames),
  };
}

/**
 * The page step of `runCmsCacheInvalidation`: one stored-HTML purge, then one `.md` purge, so the
 * zone API gets one request per kind. Run it before any warm: the warm reads through the edge and
 * would store the old copy again. Never throws. Returns the zone outcome of the HTML purge.
 */
export async function purgeCmsPages({
  entries,
  knownPagePathnames = [],
  navigationKeys,
  readAllEntryRefs,
  scopes,
}: {
  entries: CmsEntryRef[];
  // Pages the caller resolved before its write removed or moved the rows that name them.
  knownPagePathnames?: string[];
  navigationKeys: CmsNavigationKey[];
  // The caller owns this read, because a full clear also needs the rows for its tags.
  readAllEntryRefs: () => Promise<CmsEntryStatusRef[]>;
  scopes: CmsInvalidationScope[];
}): Promise<EdgeHtmlZonePurgeOutcome> {
  const reads = selectCmsPagePurgeReads({ entries, navigationKeys, scopes });
  const [navigationPagePaths, blogListings, allEntries] = await Promise.all([
    getCmsNavigationPagePaths({ navigationKeys: reads.navigationKeys }),
    reads.blogListings ? getBlogListingPostCounts() : [],
    reads.allEntries ? readAllEntryRefsOrNone(readAllEntryRefs) : [],
  ]);
  const targets = selectCmsPagePurgeTargets({
    allEntries,
    blogListings,
    entries,
    knownPagePathnames,
    navigationKeys,
    navigationPagePaths,
    scopes,
  });

  const { zonePurge } = await purgeEdgeHtmlPages({
    pathnames: targets.pathnames,
    subtreePathnames: targets.subtreePathnames,
  });

  if (targets.markdownPathnames.length > 0) {
    await purgeMarkdownPageCache({ pathnames: targets.markdownPathnames });
  }

  return zonePurge;
}

// The named navigations plus the one that owns each entry's collection, sorted for a stable read.
function selectPurgedNavigationKeys({
  entries,
  navigationKeys,
}: {
  entries: CmsEntryRef[];
  navigationKeys: CmsNavigationKey[];
}): CmsNavigationKey[] {
  const navigations = new Set<CmsNavigationKey>(navigationKeys);

  for (const entry of entries) {
    const navigationKey = getCmsCollectionNavigationKey(entry.collection);

    if (navigationKey) {
      navigations.add(navigationKey);
    }
  }

  return Array.from(navigations).toSorted();
}

// Best effort, like the other page reads: the root prefix and the TTL still reach the pages.
async function readAllEntryRefsOrNone(
  readAllEntryRefs: () => Promise<CmsEntryStatusRef[]>,
): Promise<CmsEntryStatusRef[]> {
  try {
    return await readAllEntryRefs();
  } catch (error) {
    console.error("CMS entry row lookup for the page purge failed", error);
    return [];
  }
}

// A collection without `previewUrl`, such as docs, has no path here: its navigation paths name it.
function selectPublishedEntryPagePaths(allEntries: CmsEntryStatusRef[]): string[] {
  const pagePaths = new Set<string>();

  for (const entry of allEntries) {
    const pagePath = entry.status === CMS_ENTRY_STATUS.PUBLISHED ? cmsEntryPagePath(entry) : null;

    if (pagePath) {
      pagePaths.add(pagePath);
    }
  }

  return Array.from(pagePaths);
}

// The site header and a full clear change every stored page, so they purge the root subtree.
function purgesEveryStoredPage(scopes: CmsInvalidationScope[]): boolean {
  return scopes.includes(CMS_INVALIDATION_SCOPES.ALL_CMS)
    || scopes.includes(CMS_INVALIDATION_SCOPES.SITE_HEADER);
}

function isUnderAnySubtree({
  pathname,
  subtreePathnames,
}: {
  pathname: string;
  subtreePathnames: Set<string>;
}): boolean {
  for (const subtree of subtreePathnames) {
    if (subtree === ROOT_PATHNAME || pathname === subtree || pathname.startsWith(`${subtree}/`)) {
      return true;
    }
  }

  return false;
}
