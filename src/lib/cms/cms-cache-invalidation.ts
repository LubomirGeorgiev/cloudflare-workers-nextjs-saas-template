import "server-only";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CACHE_TAGS, revalidateCacheTag } from "@/utils/cache";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import {
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
} from "@/lib/cms/cms-search";

export interface CmsIncludeRelations {
  createdByUser?: boolean;
  media?: boolean;
  tags?: boolean;
}

function invalidateCacheTags(tags: string[]): void {
  tags.forEach((tag) => revalidateCacheTag(tag));
}

export async function invalidateCmsEntryCache({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): Promise<void> {
  invalidateCacheTags([
    CACHE_TAGS.cmsEntry({ collectionSlug, slug }),
  ]);
}

export async function invalidateCmsCollectionCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  invalidateCacheTags([
    CACHE_TAGS.cmsCollection(collectionSlug),
  ]);
}

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
export async function invalidateCmsCollectionCountCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  invalidateCacheTags([
    CACHE_TAGS.cmsCollectionCount(collectionSlug),
  ]);
}

export async function invalidateCmsNavigationCachesForCollection({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  const navigationKey = getCmsCollectionNavigationKey(collectionSlug);

  if (!navigationKey) {
    return;
  }

  invalidateCacheTags([
    CACHE_TAGS.cmsNavigation(navigationKey),
    CACHE_TAGS.cmsRedirect(navigationKey),
  ]);

  if (isCollectionSearchEnabled(collectionSlug)) {
    await invalidateCmsSearchCache(collectionSlug);
  }
}

export async function invalidateSitemapCache(): Promise<void> {
  revalidateCacheTag(CACHE_TAGS.SITEMAP);
}

export async function invalidateCmsTagsCache(): Promise<void> {
  revalidateCacheTag(CACHE_TAGS.CMS_TAGS);
}

export async function invalidateEntryAndCollection({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): Promise<void> {
  const invalidations = [
    invalidateCmsEntryCache({ collectionSlug, slug }),
    invalidateCmsCollectionCache({ collectionSlug }),
    invalidateCmsCollectionCountCache({ collectionSlug }),
    invalidateCmsNavigationCachesForCollection({ collectionSlug }),
    invalidateSitemapCache(),
    invalidateCmsTagsCache(),
  ];

  if (isCollectionSearchEnabled(collectionSlug)) {
    invalidations.push(invalidateCmsSearchCache(collectionSlug));
  }

  await Promise.all(invalidations);
}

export async function invalidateAllCmsCollectionCaches(): Promise<void> {
  invalidateCacheTags([
    CACHE_TAGS.CMS_ENTRY,
    CACHE_TAGS.CMS_COLLECTION,
    CACHE_TAGS.CMS_COLLECTION_COUNT,
    CACHE_TAGS.CMS_NAVIGATION,
    CACHE_TAGS.CMS_REDIRECT,
    CACHE_TAGS.SITEMAP,
    CACHE_TAGS.CMS_TAGS,
  ]);
}

export async function invalidateAllCmsCaches(): Promise<void> {
  await Promise.all([
    invalidateAllCmsCollectionCaches(),
    invalidateCmsSearchCache(),
  ]);
}

export function getKnownCmsCollectionSlug(collectionSlug: string): CollectionsUnion {
  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];

  if (!collection) {
    throw new Error(`Collection "${collectionSlug}" not found in CMS config`);
  }

  return collection.slug as CollectionsUnion;
}
