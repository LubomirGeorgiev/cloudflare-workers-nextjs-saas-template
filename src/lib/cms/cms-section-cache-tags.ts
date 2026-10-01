import { CACHE_TAGS } from "@/constants/cache-tags";
import { splitLocalePrefix } from "@/i18n/locale-prefix";
import { BLOG_BASE_PATH, BLOG_COLLECTION_SLUG, CMS_TAGS_PAGE_PATH } from "@/lib/blog-routing";
import { DOCS_BASE_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";

// The tags each CMS section's cached loader passes to `setCacheScope`. Its OG card and its `.md`
// twin stamp the same list, so one purge reaches all three. No heavy imports: the `.md` page
// branch of the Worker reads `markdownPageCacheTags`.

/** Docs page resolution reads the docs navigation tree and its redirects. */
export const DOCS_NAVIGATION_CACHE_TAGS: readonly string[] = [
  CACHE_TAGS.cmsNavigation(DOCS_SLUG),
  CACHE_TAGS.cmsRedirect(DOCS_SLUG),
];

/** The blog listings and the author pages read the blog collection. */
export const BLOG_COLLECTION_CACHE_TAGS: readonly string[] = [
  CACHE_TAGS.cmsCollection(BLOG_COLLECTION_SLUG),
];

/** A blog tag page also resolves its slug through the tags catalog. */
export const BLOG_TAG_PAGE_CACHE_TAGS: readonly string[] = [
  CACHE_TAGS.cmsCollection(BLOG_COLLECTION_SLUG),
  CACHE_TAGS.CMS_TAGS,
];

/** The tags catalog alone, for a read that lists tags and no entries. */
export const CMS_TAGS_CACHE_TAGS: readonly string[] = [CACHE_TAGS.CMS_TAGS];

export function blogEntryCacheTags(slug: string): string[] {
  return [CACHE_TAGS.cmsEntry({ collectionSlug: BLOG_COLLECTION_SLUG, slug })];
}

/**
 * The purge tags of a served page's `.md` twin, from its pathname alone, because no page render
 * sets a `Cache-Tag`. A page with no CMS data gets none: only a deploy changes it.
 */
export function markdownPageCacheTags(pathname: string): readonly string[] {
  const pagePath = splitLocalePrefix(pathname).pathname;

  // Every docs app page bakes the CMS sidebar.
  if (isAtOrBelow({ pathname: pagePath, basePath: DOCS_BASE_PATH })) {
    return DOCS_NAVIGATION_CACHE_TAGS;
  }

  if (isAtOrBelow({ pathname: pagePath, basePath: CMS_TAGS_PAGE_PATH })) {
    return BLOG_TAG_PAGE_CACHE_TAGS;
  }

  // Listing, pagination, and author pages all list blog entries.
  if (isAtOrBelow({ pathname: pagePath, basePath: BLOG_BASE_PATH })) {
    return BLOG_COLLECTION_CACHE_TAGS;
  }

  return [];
}

function isAtOrBelow({ pathname, basePath }: { pathname: string; basePath: string }): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}
