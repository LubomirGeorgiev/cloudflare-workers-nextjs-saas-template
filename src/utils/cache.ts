import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import ms from "ms";

interface CacheScopeOptions {
  ttl: ms.StringValue; // e.g., "1h", "5m", "1d"
  tags: string[];
}

export function setCacheScope({ ttl, tags }: CacheScopeOptions): void {
  const seconds = Math.floor(ms(ttl) / 1000);

  cacheTag(...tags);
  cacheLife({
    expire: seconds,
    revalidate: seconds,
  });
}

export function revalidateCacheTag(tag: string): void {
  try {
    revalidateTag(tag, "max");
  } catch (error) {
    if (error instanceof Error && error.message.includes("static generation store missing")) {
      return;
    }

    throw error;
  }
}

const STATS_PREFIX = "stats";
const CMS_PREFIX = "cms";

function tagPart(value: string): string {
  return encodeURIComponent(value);
}

export const CACHE_TAGS = {
  SITEMAP: "sitemap",
  TOTAL_USERS: `${STATS_PREFIX}-total-users`,
  CMS_ENTRY: `${CMS_PREFIX}-entry`,
  CMS_COLLECTION: `${CMS_PREFIX}-collection`,
  CMS_COLLECTION_COUNT: `${CMS_PREFIX}-collection-count`,
  CMS_NAVIGATION: `${CMS_PREFIX}-navigation`,
  CMS_REDIRECT: `${CMS_PREFIX}-redirect`,
  CMS_SEARCH: `${CMS_PREFIX}-search`,
  CMS_TAGS: `${CMS_PREFIX}-tags`,
  githubStars({ owner, repo }: { owner: string; repo: string }) {
    return `${STATS_PREFIX}-github-stars-${tagPart(owner)}-${tagPart(repo)}`;
  },
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
