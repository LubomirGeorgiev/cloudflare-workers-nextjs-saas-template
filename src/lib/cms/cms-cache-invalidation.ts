import "server-only";

import { and, eq } from "drizzle-orm";

import {
  cmsConfig,
  cmsNavigationKeys,
  collectionSlugs,
  type CollectionsUnion,
} from "@/../cms.config";
import { getDB } from "@/db";
import { cmsEntryTable, cmsEntryTagTable, cmsTagTable } from "@/db/schema";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { CACHE_TAGS, revalidateCacheTag } from "@/utils/cache";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { purgeDocsNavigationMarkdownPages } from "@/lib/cms/cms-navigation-page-purge";
import {
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
} from "@/lib/cms/cms-search";

export interface CmsIncludeRelations {
  createdByUser?: boolean;
  media?: boolean;
  tags?: boolean;
}

async function invalidateCacheTags(tags: string[]): Promise<void> {
  await Promise.all(Array.from(new Set(tags)).map((tag) => revalidateCacheTag(tag)));
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
  await invalidateCacheTags([
    CACHE_TAGS.cmsEntry({ collectionSlug, slug }),
  ]);
}

export async function invalidateCmsCollectionCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  await invalidateCacheTags([
    CACHE_TAGS.cmsCollection(collectionSlug),
  ]);
}

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
export async function invalidateCmsCollectionCountCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  await invalidateCacheTags([
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

  await invalidateCacheTags([
    CACHE_TAGS.cmsNavigation(navigationKey),
    CACHE_TAGS.cmsRedirect(navigationKey),
  ]);

  await purgeDocsNavigationMarkdownPages();

  if (isCollectionSearchEnabled(collectionSlug)) {
    await invalidateCmsSearchCache(collectionSlug);
  }
}

export async function invalidateSitemapCache(): Promise<void> {
  await revalidateCacheTag(CACHE_TAGS.SITEMAP);
}

export async function invalidateCmsTagsCache(): Promise<void> {
  await revalidateCacheTag(CACHE_TAGS.CMS_TAGS);
}

export interface CmsEntryRef {
  collection: CollectionsUnion;
  slug: string;
}

// The (collection, slug) of every entry that references this tag group. Junction rows anchor on the
// canonical (DEFAULT_LOCALE) tag row, so we join through it by group slug. Callers that need these refs
// *after* the tag rows are gone (delete) must collect them before the mutation runs.
export async function getCmsTagGroupEntryRefs({
  tagSlug,
}: {
  tagSlug: string;
}): Promise<CmsEntryRef[]> {
  const db = getDB();

  return db
    .select({
      collection: cmsEntryTable.collection,
      slug: cmsEntryTable.slug,
    })
    .from(cmsEntryTagTable)
    .innerJoin(
      cmsTagTable,
      and(
        eq(cmsTagTable.id, cmsEntryTagTable.tagId),
        eq(cmsTagTable.slug, tagSlug),
        eq(cmsTagTable.locale, DEFAULT_LOCALE),
      ),
    )
    .innerJoin(cmsEntryTable, eq(cmsEntryTable.id, cmsEntryTagTable.entryId));
}

// Scoped invalidation for a tag write: only the entries that render this tag (and their collection list
// pages) plus the tags catalog and sitemap. A tag edit can't change collection counts or navigation, so
// those tags are deliberately left alone — the previous behavior flushed the entire CMS cache (all entries/collections/ counts/nav) after an unfiltered full-table scan on every tag mutation.
export async function invalidateCmsTagGroupCaches({
  entryRefs,
}: {
  entryRefs: CmsEntryRef[];
}): Promise<void> {
  const tags = new Set<string>([CACHE_TAGS.CMS_TAGS, CACHE_TAGS.SITEMAP]);

  for (const ref of entryRefs) {
    tags.add(CACHE_TAGS.cmsEntry({ collectionSlug: ref.collection, slug: ref.slug }));
    tags.add(CACHE_TAGS.cmsCollection(ref.collection));
  }

  await invalidateCacheTags(Array.from(tags));
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

  await invalidateCacheTags([
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
