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
import { CMS_TAGS_PAGE_PATH } from "@/lib/blog-routing";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import {
  purgeCmsEntryEdgeHtmlPages,
  purgeCmsEntryMarkdownPages,
} from "@/lib/cms/cms-entry-page-purge";
import { purgeDocsNavigationMarkdownPages } from "@/lib/cms/cms-navigation-page-purge";
import { getCmsSearchCacheTags, isCollectionSearchEnabled } from "@/lib/cms/cms-search";
import { clearNavigationMemos } from "@/lib/cms/navigation-memos";
import { warmCmsEntryPages } from "@/lib/cms/warm-cms-pages";
import { purgeWorkersCacheAfterWrite } from "@/lib/edge/purge-workers-cache-after-write";
import { mapInBatches } from "@/utils/map-in-batches";
import { withSpan } from "@/utils/trace";

// Each tag is one KV write, and a full CMS clear names every entry.
const CACHE_TAG_INVALIDATION_BATCH_SIZE = 25;

const INVALIDATE_SPAN_NAME = "app.cms.invalidate";
const COLLECTION_ATTRIBUTE = "app.cms.collection";
const SLUG_COUNT_ATTRIBUTE = "app.cms.slug_count";
const WARM_ATTRIBUTE = "app.cms.warm";
// The collection attribute value when one call spans more than one collection.
const MIXED_COLLECTIONS = "mixed";

export interface CmsIncludeRelations {
  createdByUser?: boolean;
  media?: boolean;
  tags?: boolean;
}

// Returns the failures, so one failed tag does not stop the later batches.
async function invalidateCacheTags(tags: string[]): Promise<unknown[]> {
  const results = await mapInBatches({
    items: tags,
    batchSize: CACHE_TAG_INVALIDATION_BATCH_SIZE,
    fn: async (tag) => {
      try {
        await revalidateCacheTag(tag);
        return [];
      } catch (error) {
        return [error];
      }
    },
  });

  return results.flat();
}

async function getAllCmsEntryRefs(): Promise<CmsEntryRef[]> {
  const db = getDB();

  return db
    .select({
      collection: cmsEntryTable.collection,
      slug: cmsEntryTable.slug,
    })
    .from(cmsEntryTable);
}

/**
 * The one order of every CMS cache invalidation: drop the KV tags, run the page step, then purge
 * Workers Caching by the same tags. Each step goes before the cache that refills from it: an edge
 * miss reads a `.md` twin or KV, and a `.md` miss reads the stored page and KV.
 */
export async function runCmsCacheInvalidation({
  tags,
  purgePages,
}: {
  tags: readonly string[];
  // Deletes stored HTML before `.md` twins, because a `.md` miss converts the stored page.
  purgePages?: () => Promise<unknown>;
}): Promise<void> {
  const uniqueTags = Array.from(new Set(tags));

  const tagFailures = await invalidateCacheTags(uniqueTags);
  // The memos hold reads of those tags, so they go before a page step can trigger a re-render.
  clearNavigationMemos();

  if (purgePages) {
    await purgePages();
  }

  // Awaited, so a warm after this call misses the edge.
  await purgeWorkersCacheAfterWrite({ tags: uniqueTags });

  // The later steps still run for the tags that dropped. Throw now, so the caller sees the failure.
  if (tagFailures.length > 0) {
    throw tagFailures.length === 1
      ? tagFailures[0]
      : new AggregateError(tagFailures, `${tagFailures.length} CMS cache tag drops failed`);
  }
}

/** What a navigation or search change of a collection drops, for an entry write and a navigation save. */
export function getCollectionNavigationAndSearchCacheTags(collectionSlug: CollectionsUnion): string[] {
  const navigationKey = getCmsCollectionNavigationKey(collectionSlug);

  return [
    ...(navigationKey
      ? [CACHE_TAGS.cmsNavigation(navigationKey), CACHE_TAGS.cmsRedirect(navigationKey)]
      : []),
    ...(isCollectionSearchEnabled(collectionSlug) ? getCmsSearchCacheTags(collectionSlug) : []),
  ];
}

// Every tag an entry write drops: the entry slugs, the list, count, navigation, and search of each
// collection, the sitemap, and the tags catalog.
function getEntryWriteCacheTags({
  entries,
  collections,
}: {
  entries: CmsEntryRef[];
  collections: CollectionsUnion[];
}): string[] {
  return [
    ...entries.map(({ collection, slug }) => CACHE_TAGS.cmsEntry({ collectionSlug: collection, slug })),
    ...collections.flatMap((collectionSlug) => [
      CACHE_TAGS.cmsCollection(collectionSlug),
      CACHE_TAGS.cmsCollectionCount(collectionSlug),
      ...getCollectionNavigationAndSearchCacheTags(collectionSlug),
    ]),
    CACHE_TAGS.SITEMAP,
    CACHE_TAGS.CMS_TAGS,
  ];
}

// A full CMS clear: every collection, navigation, and searchable collection, plus every entry.
function getAllCmsCacheTags({ entries }: { entries: CmsEntryRef[] }): string[] {
  return [
    ...collectionSlugs.flatMap((collectionSlug) => [
      CACHE_TAGS.cmsCollection(collectionSlug),
      CACHE_TAGS.cmsCollectionCount(collectionSlug),
    ]),
    ...cmsNavigationKeys.flatMap((navigationKey) => [
      CACHE_TAGS.cmsNavigation(navigationKey),
      CACHE_TAGS.cmsRedirect(navigationKey),
    ]),
    ...entries.map(({ collection, slug }) => CACHE_TAGS.cmsEntry({ collectionSlug: collection, slug })),
    ...getCmsSearchCacheTags(),
    CACHE_TAGS.SITEMAP,
    CACHE_TAGS.CMS_TAGS,
  ];
}

// Stored HTML first, because a `.md` miss converts the stored page.
async function purgeCmsEntryPages({ entries }: { entries: CmsEntryRef[] }): Promise<void> {
  await purgeCmsEntryEdgeHtmlPages({ entries });
  await purgeCmsEntryMarkdownPages({ entries });
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

  await runCmsCacheInvalidation({
    tags: Array.from(tags),
    purgePages: () =>
      purgeCmsEntryMarkdownPages({ entries: entryRefs, alsoPathnames: [CMS_TAGS_PAGE_PATH] }),
  });
}

// The one mutation pipeline for CMS entries: `runCmsCacheInvalidation`, then the warm. Every writer
// comes through here or through `invalidateEntryAndCollection`.
export async function invalidateCmsEntries({
  entries,
  warmEntries = [],
}: {
  entries: CmsEntryRef[];
  // Only a publish sets this: a delete or a draft save would warm a 404.
  warmEntries?: CmsEntryRef[];
}): Promise<void> {
  const uniqueEntries = uniqueEntryRefs(entries);

  if (uniqueEntries.length === 0) {
    return;
  }

  const collections = Array.from(new Set(uniqueEntries.map(({ collection }) => collection)));

  await withSpan({
    name: INVALIDATE_SPAN_NAME,
    run: async (span) => {
      span.setAttributes({
        [COLLECTION_ATTRIBUTE]: collections.length === 1 ? collections[0] : MIXED_COLLECTIONS,
        [SLUG_COUNT_ATTRIBUTE]: uniqueEntries.length,
        [WARM_ATTRIBUTE]: warmEntries.length > 0,
      });

      const ownsNavigation = collections.some((collectionSlug) =>
        Boolean(getCmsCollectionNavigationKey(collectionSlug)));

      // One call for every entry, so a multi-entry write stays inside the purge rate limit. The
      // pages go inside it, never after it: the warm reads through the edge and would re-store them.
      await runCmsCacheInvalidation({
        tags: getEntryWriteCacheTags({ entries: uniqueEntries, collections }),
        purgePages: () => Promise.all([
          purgeCmsEntryPages({ entries: uniqueEntries }),
          ...(ownsNavigation ? [purgeDocsNavigationMarkdownPages()] : []),
        ]),
      });

      // Fire and forget, so the write does not wait for the re-render.
      if (warmEntries.length > 0) {
        warmCmsEntryPages({ entries: uniqueEntryRefs(warmEntries) });
      }
    },
  });
}

// One entry, plus the earlier slugs of a rename: every slug is invalidated, only `slug` is warmed.
export async function invalidateEntryAndCollection({
  collectionSlug,
  slug,
  alsoPurgeSlugs = [],
  warm = false,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
  // A rename leaves the previous slug's page and entry tag behind, so name it here; only `slug`
  // still resolves, so only it is warmed.
  alsoPurgeSlugs?: string[];
  warm?: boolean;
}): Promise<void> {
  const entry = { collection: collectionSlug, slug };

  await invalidateCmsEntries({
    entries: [entry, ...alsoPurgeSlugs.map((entrySlug) => ({ ...entry, slug: entrySlug }))],
    warmEntries: warm ? [entry] : [],
  });
}

export async function invalidateAllCmsCaches(): Promise<void> {
  const entries = await getAllCmsEntryRefs();

  await runCmsCacheInvalidation({
    tags: getAllCmsCacheTags({ entries }),
    purgePages: () => Promise.all([
      purgeCmsEntryMarkdownPages({ entries, alsoPathnames: [CMS_TAGS_PAGE_PATH] }),
      purgeDocsNavigationMarkdownPages(),
    ]),
  });
}

export function getKnownCmsCollectionSlug(collectionSlug: string): CollectionsUnion {
  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];

  if (!collection) {
    throw new Error(`Collection "${collectionSlug}" not found in CMS config`);
  }

  return collection.slug as CollectionsUnion;
}

function uniqueEntryRefs(entries: CmsEntryRef[]): CmsEntryRef[] {
  const seen = new Set<string>();

  return entries.filter(({ collection, slug }) => {
    // A collection slug is one URL segment (`/markdown/<collection>/...`), so it holds no `/`.
    const key = `${collection}/${slug}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
