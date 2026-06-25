import "server-only";

import {
  cmsConfig,
  cmsNavigationKeys,
  collectionSlugs,
  type CollectionsUnion,
} from "@/../cms.config";
import { getDB } from "@/db";
import { cmsEntryTable } from "@/db/schema";
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
  Array.from(new Set(tags)).forEach((tag) => revalidateCacheTag(tag));
}

async function getAllCmsEntryCacheTags(): Promise<string[]> {
  const db = getDB();
  const entries = await db
    .select({
      collection: cmsEntryTable.collection,
      slug: cmsEntryTable.slug,
    })
    .from(cmsEntryTable);

  return entries.map((entry) =>
    CACHE_TAGS.cmsEntry({
      collectionSlug: entry.collection,
      slug: entry.slug,
    })
  );
}

function getAllCmsCollectionCacheTags(): string[] {
  return collectionSlugs.flatMap((collectionSlug) => [
    CACHE_TAGS.cmsCollection(collectionSlug),
    CACHE_TAGS.cmsCollectionCount(collectionSlug),
  ]);
}

function getAllCmsNavigationCacheTags(): string[] {
  return cmsNavigationKeys.flatMap((navigationKey) => [
    CACHE_TAGS.cmsNavigation(navigationKey),
    CACHE_TAGS.cmsRedirect(navigationKey),
  ]);
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
  const entryTags = await getAllCmsEntryCacheTags();

  invalidateCacheTags([
    ...getAllCmsCollectionCacheTags(),
    ...getAllCmsNavigationCacheTags(),
    ...entryTags,
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
