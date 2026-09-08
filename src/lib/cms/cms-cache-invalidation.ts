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
import { purgeCmsEntryEdgeHtmlPages } from "@/lib/cms/cms-entry-page-purge";
import { purgeDocsNavigationMarkdownPages } from "@/lib/cms/cms-navigation-page-purge";
import {
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
} from "@/lib/cms/cms-search";
import { clearNavigationMemos } from "@/lib/cms/navigation-memos";
import { warmCmsEntryPages } from "@/lib/cms/warm-cms-pages";

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

async function invalidateCmsEntryCache({
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

async function invalidateCmsCollectionCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  await invalidateCacheTags([
    CACHE_TAGS.cmsCollection(collectionSlug),
  ]);
}

async function invalidateCmsCollectionCountCache({
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
  clearNavigationMemos();
}

async function invalidateSitemapCache(): Promise<void> {
  await revalidateCacheTag(CACHE_TAGS.SITEMAP);
}

async function invalidateCmsTagsCache(): Promise<void> {
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

/**
 * The one publish/mutation pipeline for a CMS entry: drop every tag the entry feeds, drop the stored
 * HTML of every affected slug, then optionally warm the entry back. Every writer comes through here,
 * so the editor, the timer, the media path, and the admin API invalidate identically.
 */
export async function invalidateEntryAndCollection({
  collectionSlug,
  slug,
  alsoPurgeSlugs = [],
  warm = false,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
  // A rename leaves the previous slug's page and entry tag behind, so name it here: every slug is
  // invalidated and purged, but only `slug` is warmed, because it is the one that still resolves.
  alsoPurgeSlugs?: string[];
  // Only a publish sets this: a delete or a draft save would warm a 404.
  warm?: boolean;
}): Promise<void> {
  const entries = Array.from(new Set([slug, ...alsoPurgeSlugs])).map((entrySlug) => ({
    collection: collectionSlug,
    slug: entrySlug,
  }));

  const invalidations = [
    // Inside this call, never after it: the warm below fetches the page through the edge, so a
    // stored copy that outlives this purge is what the warm would read and re-store.
    purgeCmsEntryEdgeHtmlPages({ entries }),
    ...entries.map((entry) => invalidateCmsEntryCache({ collectionSlug, slug: entry.slug })),
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

  // After the tags are dropped, never before: a warm that started earlier would re-store the old
  // body. Fire and forget, so the publish does not wait for the re-render.
  if (warm) {
    warmCmsEntryPages({ entries: [{ collection: collectionSlug, slug }] });
  }
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
  clearNavigationMemos();
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
