/**
 * The tags the app purges cached content under.
 *
 * Import-free on purpose: the Worker entrypoint stamps the sitemap tag on a hot path, so these
 * names cannot live in `src/utils/cache.ts`, whose `server-only`/`next/cache`/`ms` imports would
 * join every cold isolate's startup graph. `src/utils/cache.ts` re-exports `CACHE_TAGS`.
 */

const CMS_PREFIX = "cms";

function tagPart(value: string): string {
  return encodeURIComponent(value);
}

export const CACHE_TAGS = {
  SITEMAP: "sitemap",
  CMS_TAGS: `${CMS_PREFIX}-tags`,
  cmsEntry({
    collectionSlug,
    slug,
  }: {
    collectionSlug: string;
    slug: string;
  }) {
    return `${CMS_PREFIX}-entry-${tagPart(collectionSlug)}-${tagPart(slug)}`;
  },
  cmsCollection(collectionSlug: string) {
    return `${CMS_PREFIX}-collection-${tagPart(collectionSlug)}`;
  },
  cmsCollectionCount(collectionSlug: string) {
    return `${CMS_PREFIX}-collection-count-${tagPart(collectionSlug)}`;
  },
  cmsNavigation(navigationKey: string) {
    return `${CMS_PREFIX}-navigation-${tagPart(navigationKey)}`;
  },
  cmsRedirect(navigationKey: string) {
    return `${CMS_PREFIX}-redirect-${tagPart(navigationKey)}`;
  },
  cmsSearchCollection(collectionSlug: string) {
    return `${CMS_PREFIX}-search-${tagPart(collectionSlug)}`;
  },
} as const;
