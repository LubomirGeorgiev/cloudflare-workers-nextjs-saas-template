import "server-only";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CACHE_KEYS } from "@/utils/with-kv-cache";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import {
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
} from "@/lib/cms/cms-search";
import type { CmsStatusFilter } from "@/types/cms";

export interface CmsIncludeRelations {
  createdByUser?: boolean;
  media?: boolean;
  tags?: boolean;
}

export function getCmsEntryCacheKey({
  collectionSlug,
  slug,
  status,
  includeRelations,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
  status?: CmsStatusFilter;
  includeRelations?: CmsIncludeRelations;
}): string {
  const base = `${CACHE_KEYS.CMS_ENTRY}:${collectionSlug}:${slug}`;
  return status || includeRelations
    ? `${base}:${status ?? ""}:${JSON.stringify(includeRelations ?? null)}`
    : base;
}

export function getCmsCollectionCacheKey({
  collectionSlug,
  status,
  includeRelations,
  limit,
  offset,
}: {
  collectionSlug?: CollectionsUnion;
  status?: CmsStatusFilter;
  includeRelations?: CmsIncludeRelations;
  limit?: number;
  offset?: number;
}): string {
  if (!collectionSlug) {
    return `${CACHE_KEYS.CMS_COLLECTION}:`;
  }

  const base = `${CACHE_KEYS.CMS_COLLECTION}:${collectionSlug}:`;

  if (status === undefined && includeRelations === undefined && limit === undefined && offset === undefined) {
    return base;
  }

  return `${base}${status}:${JSON.stringify(includeRelations)}:${limit}:${offset}`;
}

export function getCmsCollectionCountCacheKey({
  collectionSlug,
  status,
}: {
  collectionSlug?: CollectionsUnion;
  status?: CmsStatusFilter;
}): string {
  if (!collectionSlug) {
    return `${CACHE_KEYS.CMS_COLLECTION}:count:`;
  }

  if (status === undefined) {
    return `${CACHE_KEYS.CMS_COLLECTION}:count:${collectionSlug}:`;
  }

  return `${CACHE_KEYS.CMS_COLLECTION}:count:${collectionSlug}:${status}`;
}

async function invalidateCacheByPrefix(prefix: string): Promise<void> {
  const { env } = await getCloudflareContext();
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    return;
  }

  let cursor: string | undefined;
  const keysToDelete: string[] = [];

  do {
    const result = await kv.list({ prefix, cursor });
    keysToDelete.push(...result.keys.map((key) => key.name));
    cursor = !result.list_complete && "cursor" in result ? result.cursor : undefined;
  } while (cursor);

  if (keysToDelete.length > 0) {
    await Promise.all(keysToDelete.map((key) => kv.delete(key)));
  }
}

export async function invalidateCmsEntryCache({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): Promise<void> {
  const prefix = getCmsEntryCacheKey({ collectionSlug, slug });
  await invalidateCacheByPrefix(prefix);
}

export async function invalidateCmsCollectionCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  const prefix = getCmsCollectionCacheKey({ collectionSlug });
  await invalidateCacheByPrefix(prefix);
}

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
export async function invalidateCmsCollectionCountCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  const prefix = getCmsCollectionCountCacheKey({ collectionSlug });
  await invalidateCacheByPrefix(prefix);
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

  const invalidations = [
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_NAVIGATION}:${navigationKey}:`),
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_REDIRECT}:${navigationKey}:`),
  ];

  if (isCollectionSearchEnabled(collectionSlug)) {
    invalidations.push(invalidateCmsSearchCache(collectionSlug));
  }

  await Promise.all(invalidations);
}

export async function invalidateSitemapCache(): Promise<void> {
  const { env } = await getCloudflareContext();
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    return;
  }

  await kv.delete(CACHE_KEYS.SITEMAP);
}

export async function invalidateCmsTagsCache(): Promise<void> {
  const { env } = await getCloudflareContext();
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    return;
  }

  await kv.delete(CACHE_KEYS.CMS_TAGS);
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
  await Promise.all([
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_ENTRY}:`),
    invalidateCacheByPrefix(getCmsCollectionCacheKey({})),
    invalidateCacheByPrefix(getCmsCollectionCountCacheKey({})),
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_NAVIGATION}:`),
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_REDIRECT}:`),
    invalidateSitemapCache(),
    invalidateCmsTagsCache(),
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
