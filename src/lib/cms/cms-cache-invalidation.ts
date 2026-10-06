import "server-only";

import { and, eq } from "drizzle-orm";

import {
  cmsConfig,
  cmsNavigationKeys,
  collectionSlugs,
  type CmsNavigationKey,
  type CollectionsUnion,
} from "@/../cms.config";
import { CMS_CACHE_PURGE_OK, type CmsCachePurgeOutcome } from "@/constants/cache-purge";
import { DATA_CACHE_MEMORY_TTL_MS } from "@/constants/data-cache";
import {
  EDGE_HTML_ZONE_PURGE_OUTCOME,
  type EdgeHtmlZonePurgeOutcome,
} from "@/constants/edge-html-cache";
import { getDB } from "@/db";
import { cmsEntryTable, cmsEntryTagTable, cmsTagTable } from "@/db/schema";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { CACHE_TAGS, revalidateCacheTag } from "@/utils/cache";
import { getFreshPublishedBlogPostCount } from "@/lib/blog-visibility";
import { type CmsEntryStatusRef, purgeCmsPages } from "@/lib/cms/cms-entry-page-purge";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import {
  CMS_INVALIDATION_SCOPES,
  isEmptyHeaderItemChange,
  mayHeaderLinkFlip,
  selectEntryWriteItemChange,
  SITE_HEADER_CACHE_TAGS,
  SITE_HEADER_NAVIGATION_KEY,
  type CmsInvalidationScope,
  type HeaderItemChange,
  type PublishStateChange,
} from "@/lib/cms/cms-invalidation-scopes";
import {
  getCmsCollectionNavigationKey,
  getCmsNavigationConfig,
} from "@/lib/cms/cms-navigation-config";
import { reportCmsCachePurge, selectCmsCachePurgeOutcome } from "@/lib/cms/cms-cache-purge-report";
import { getCmsSearchCacheTags, isCollectionSearchEnabled } from "@/lib/cms/cms-search";
import { getFreshCmsNavigationLivePageCount } from "@/lib/cms/cms-navigation-tree-query";
import { clearNavigationMemos } from "@/lib/cms/navigation-memos";
import { warmCmsEntryPages } from "@/lib/cms/warm-cms-pages";
import { purgeWorkersCacheAfterWrite } from "@/lib/edge/purge-workers-cache-after-write";
import { enqueueCmsRepurge } from "@/lib/scheduler/enqueue";
import { mapInBatches } from "@/utils/map-in-batches";
import { withSpan } from "@/utils/trace";

// Each tag is one KV write, and a full CMS clear names every entry.
const CACHE_TAG_INVALIDATION_BATCH_SIZE = 25;

// How long a KV write can take to reach every data center.
const KV_PROPAGATION_SECONDS = 60;
// An isolate can read an old tag answer just before propagation ends, then keep it in memory for
// `DATA_CACHE_MEMORY_TTL_MS`. Until both windows pass, a render (the warm too) can store old data.
const CMS_REPURGE_DELAY_SECONDS = KV_PROPAGATION_SECONDS + DATA_CACHE_MEMORY_TTL_MS / 1000;

const INVALIDATE_SPAN_NAME = "app.cms.invalidate";
const COLLECTION_ATTRIBUTE = "app.cms.collection";
const SLUG_COUNT_ATTRIBUTE = "app.cms.slug_count";
const WARM_ATTRIBUTE = "app.cms.warm";
const PASS_ATTRIBUTE = "app.cms.pass";
const REPURGE_OUTCOME_ATTRIBUTE = "app.cms.repurge.outcome";
const SCOPES_ATTRIBUTE = "app.cms.scopes";
const NAVIGATION_ATTRIBUTE = "app.cms.navigation";
const EDGE_HTML_ZONE_PURGE_ATTRIBUTE = "app.cms.edge_html.zone_purge";
// The collection attribute value when one call spans more than one collection, or none.
const MIXED_COLLECTIONS = "mixed";
const NO_COLLECTION = "none";
// The scopes and navigation attribute value when the call names none.
const NO_SCOPE = "none";

// The first pass runs with the write; the delayed pass is the queued repeat of its purge.
const INVALIDATION_PASS = {
  DELAYED: "delayed",
  INITIAL: "initial",
} as const;

// Set on the first pass only: whether its delayed repeat reached the queue.
const REPURGE_OUTCOME = {
  FAILED: "failed",
  SCHEDULED: "scheduled",
} as const;

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

// Every row in every status: a full clear drops each entry tag, and the page purge keeps the published.
export async function getAllCmsEntryRefs(): Promise<CmsEntryStatusRef[]> {
  const db = getDB();

  return db
    .select({
      collection: cmsEntryTable.collection,
      slug: cmsEntryTable.slug,
      status: cmsEntryTable.status,
    })
    .from(cmsEntryTable);
}

/**
 * The one order of every CMS cache invalidation: drop the KV tags, run the page step, then purge
 * Workers Caching by the same tags. Each step goes before the cache that refills from it: an edge
 * miss reads a `.md` twin or KV, and a `.md` miss renders the page through the app, which reads KV.
 * Returns the purge outcome, and reports it to the scope of `withCmsCachePurgeReport`.
 */
export async function runCmsCacheInvalidation({
  tags,
  purgePages,
}: {
  tags: readonly string[];
  // Deletes stored HTML and `.md` twins, and returns the zone outcome. Both refill from KV, so
  // they go after the tag drop.
  purgePages?: () => Promise<EdgeHtmlZonePurgeOutcome>;
}): Promise<CmsCachePurgeOutcome> {
  const uniqueTags = Array.from(new Set(tags));

  const tagFailures = await invalidateCacheTags(uniqueTags);
  // The memos hold reads of those tags, so they go before a page step can trigger a re-render.
  clearNavigationMemos();

  const zonePurge = purgePages ? await purgePages() : EDGE_HTML_ZONE_PURGE_OUTCOME.NONE;
  // Awaited, so a warm after this call misses the edge.
  const workersCachePurge = await purgeWorkersCacheAfterWrite({ tags: uniqueTags });
  const outcome = selectCmsCachePurgeOutcome({ zonePurge, workersCachePurge });

  reportCmsCachePurge(outcome);

  // The later steps still run for the tags that dropped. Throw now, so the caller sees the failure.
  if (tagFailures.length > 0) {
    throw tagFailures.length === 1
      ? tagFailures[0]
      : new AggregateError(tagFailures, `${tagFailures.length} CMS cache tag drops failed`);
  }

  return outcome;
}

// What a navigation or search change of a collection drops.
function getCollectionNavigationAndSearchCacheTags(collectionSlug: CollectionsUnion): string[] {
  const navigationKey = getCmsCollectionNavigationKey(collectionSlug);

  return [
    ...(navigationKey ? getNavigationCacheTags(navigationKey) : []),
    ...(isCollectionSearchEnabled(collectionSlug) ? getCmsSearchCacheTags(collectionSlug) : []),
  ];
}

function getNavigationCacheTags(navigationKey: CmsNavigationKey): string[] {
  return [CACHE_TAGS.cmsNavigation(navigationKey), CACHE_TAGS.cmsRedirect(navigationKey)];
}

// Every tag one invalidation drops. An entry drops its own tag and the list, count, navigation, and
// search of its collection; a navigation drops its tree, redirects, and search; a full clear drops
// those of every collection and navigation. The sitemap always goes.
function getCmsInvalidationCacheTags({
  entries,
  navigationKeys,
  scopes,
}: CmsInvalidationTarget): string[] {
  const isFullClear = scopes.includes(CMS_INVALIDATION_SCOPES.ALL_CMS);
  const collections = isFullClear
    ? collectionSlugs
    : Array.from(new Set(entries.map(({ collection }) => collection)));
  const navigations = isFullClear ? cmsNavigationKeys : navigationKeys;
  const dropsTagCatalog = isFullClear
    || entries.length > 0
    || scopes.includes(CMS_INVALIDATION_SCOPES.TAG_CATALOG);

  return [
    ...entries.map(({ collection, slug }) => CACHE_TAGS.cmsEntry({ collectionSlug: collection, slug })),
    ...collections.flatMap((collectionSlug) => [
      CACHE_TAGS.cmsCollection(collectionSlug),
      CACHE_TAGS.cmsCollectionCount(collectionSlug),
      ...getCollectionNavigationAndSearchCacheTags(collectionSlug),
    ]),
    ...navigations.flatMap((navigationKey) => [
      ...getNavigationCacheTags(navigationKey),
      ...getCollectionNavigationAndSearchCacheTags(getCmsNavigationConfig(navigationKey).collectionSlug),
    ]),
    ...(scopes.includes(CMS_INVALIDATION_SCOPES.SITE_HEADER) ? SITE_HEADER_CACHE_TAGS : []),
    ...(dropsTagCatalog ? [CACHE_TAGS.CMS_TAGS] : []),
    CACHE_TAGS.SITEMAP,
  ];
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

// A tag write: the tag catalog and its pages, plus every entry that renders the tag. Even a new tag
// with no entry changes `/blog/tags`.
export async function invalidateCmsTagGroupCaches({
  entryRefs,
  knownPagePathnames = [],
}: {
  entryRefs: CmsEntryRef[];
  // The tag pages of a slug the write renamed or deleted: D1 no longer names them.
  knownPagePathnames?: string[];
}): Promise<CmsCachePurgeOutcome> {
  return runCmsInvalidation({
    target: { entries: entryRefs, navigationKeys: [], scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG] },
    warmEntries: [],
    knownPagePathnames,
    pass: INVALIDATION_PASS.INITIAL,
  });
}

// A navigation save. The header shows the docs link while `SITE_HEADER_NAVIGATION_KEY` has a live
// page, so a save of that navigation purges every stored page only when it can flip that answer.
export async function invalidateCmsNavigationCaches({
  navigationKey,
  knownPagePathnames = [],
  pageChange,
}: {
  navigationKey: CmsNavigationKey;
  // The tree paths before the save, so a moved or removed page is named too.
  knownPagePathnames?: string[];
  // From `selectNavigationPageChange`: the page entries that the save added and removed.
  pageChange: HeaderItemChange;
}): Promise<CmsCachePurgeOutcome> {
  const docsLinkMayFlip = navigationKey === SITE_HEADER_NAVIGATION_KEY
    && await mayWriteFlipHeaderLink({ change: pageChange, readLiveItemsAfter: readLiveDocsPageCount });

  return runCmsInvalidation({
    target: {
      entries: [],
      navigationKeys: [navigationKey],
      scopes: docsLinkMayFlip ? [CMS_INVALIDATION_SCOPES.SITE_HEADER] : [],
    },
    warmEntries: [],
    knownPagePathnames,
    pass: INVALIDATION_PASS.INITIAL,
  });
}

// The one mutation pipeline for CMS entries: `runCmsCacheInvalidation`, then the warm, then a
// delayed repeat of the purge. Every writer comes through here or through `invalidateEntryAndCollection`.
export async function invalidateCmsEntries({
  entries,
  warmEntries = [],
  knownPagePathnames = [],
  publishStateChange = null,
}: {
  entries: CmsEntryRef[];
  // Only a publish sets this: a delete or a draft save would warm a 404.
  warmEntries?: CmsEntryRef[];
  // Pages the write moved away from, such as the old author page of a renamed author.
  knownPagePathnames?: string[];
  // Set it only when the write moved an entry into or out of the published state.
  publishStateChange?: PublishStateChange | null;
}): Promise<CmsCachePurgeOutcome> {
  return invalidateWrittenCmsEntries({ entries, warmEntries, knownPagePathnames, publishStateChange });
}

/**
 * An entry delete. The delete cascades the navigation item away, so the caller reads the entry's
 * navigation paths first and passes them here, and the local Cache API delete still names the page.
 * Only the first pass gets them: the delayed pass relies on the navigation subtree prefix.
 */
export async function invalidateDeletedCmsEntry({
  collectionSlug,
  slug,
  pagePathnames,
  publishStateChange,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
  pagePathnames: string[];
  // `UNPUBLISHED` when a deleted row was published, else `null`.
  publishStateChange: PublishStateChange | null;
}): Promise<CmsCachePurgeOutcome> {
  return invalidateWrittenCmsEntries({
    entries: [{ collection: collectionSlug, slug }],
    warmEntries: [],
    knownPagePathnames: pagePathnames,
    publishStateChange,
  });
}

async function invalidateWrittenCmsEntries({
  entries,
  warmEntries,
  knownPagePathnames,
  publishStateChange,
}: {
  entries: CmsEntryRef[];
  warmEntries: CmsEntryRef[];
  knownPagePathnames: string[];
  // From `getPublishStateChange`. Only such a write can flip a header link.
  publishStateChange: PublishStateChange | null;
}): Promise<CmsCachePurgeOutcome> {
  const scopes = publishStateChange
    ? await getPublishStateChangeScopes({ entries, publishStateChange })
    : [];

  return runCmsInvalidation({
    target: { entries, navigationKeys: [], scopes },
    warmEntries,
    knownPagePathnames,
    pass: INVALIDATION_PASS.INITIAL,
  });
}

// Only a write can flip a header link, so only the first pass asks. The delayed pass gets the
// answer from the queue payload, because the state may have moved since.
async function getPublishStateChangeScopes({
  entries,
  publishStateChange,
}: {
  entries: CmsEntryRef[];
  publishStateChange: PublishStateChange;
}): Promise<CmsInvalidationScope[]> {
  const docsCollection = getCmsNavigationConfig(SITE_HEADER_NAVIGATION_KEY).collectionSlug;
  const [blogLinkMayFlip, docsLinkMayFlip] = await Promise.all([
    mayWriteFlipHeaderLink({
      change: selectEntryWriteItemChange({ entries, collection: BLOG_COLLECTION_SLUG, publishStateChange }),
      readLiveItemsAfter: getFreshPublishedBlogPostCount,
    }),
    mayWriteFlipHeaderLink({
      change: selectEntryWriteItemChange({ entries, collection: docsCollection, publishStateChange }),
      readLiveItemsAfter: readLiveDocsPageCount,
    }),
  ]);

  return blogLinkMayFlip || docsLinkMayFlip ? [CMS_INVALIDATION_SCOPES.SITE_HEADER] : [];
}

// Reads the live count only when the write changed an item, and a failed read says yes.
async function mayWriteFlipHeaderLink({
  change,
  readLiveItemsAfter,
}: {
  change: HeaderItemChange;
  readLiveItemsAfter: () => Promise<number>;
}): Promise<boolean> {
  if (isEmptyHeaderItemChange(change)) {
    return false;
  }

  let liveItemsAfter: number | null = null;

  try {
    liveItemsAfter = await readLiveItemsAfter();
  } catch (error) {
    console.error("runCmsInvalidation: the live item count for the site header failed", error);
  }

  return mayHeaderLinkFlip({ change, liveItemsAfter });
}

async function readLiveDocsPageCount(): Promise<number> {
  return getFreshCmsNavigationLivePageCount({ navigationKey: SITE_HEADER_NAVIGATION_KEY });
}

/**
 * The delayed pass, run by the scheduler queue: the same purge for the same target, after
 * `CMS_REPURGE_DELAY_SECONDS`. It drops what a render stored from old KV data in the meantime,
 * the warm included. It does not warm, so the next visitor renders, and it does not enqueue again.
 * The queue consumer reads the returned outcome to decide on a retry.
 */
export async function repurgeCmsCaches(
  target: CmsInvalidationTarget,
): Promise<CmsCachePurgeOutcome> {
  return runCmsInvalidation({ target, warmEntries: [], pass: INVALIDATION_PASS.DELAYED });
}

/** One full CMS clear: every tag, every stored page, and every `.md` twin. */
export async function invalidateAllCmsCaches(): Promise<CmsCachePurgeOutcome> {
  return runCmsInvalidation({
    target: { entries: [], navigationKeys: [], scopes: [CMS_INVALIDATION_SCOPES.ALL_CMS] },
    warmEntries: [],
    pass: INVALIDATION_PASS.INITIAL,
  });
}

async function runCmsInvalidation({
  target,
  warmEntries,
  knownPagePathnames = [],
  pass,
}: {
  target: CmsInvalidationTarget;
  warmEntries: CmsEntryRef[];
  knownPagePathnames?: string[];
  pass: InvalidationPass;
}): Promise<CmsCachePurgeOutcome> {
  const entries = uniqueEntryRefs(target.entries);
  const navigationKeys = Array.from(new Set(target.navigationKeys)).toSorted();
  const scopes = Array.from(new Set(target.scopes)).toSorted();

  if (entries.length === 0 && navigationKeys.length === 0 && scopes.length === 0) {
    return CMS_CACHE_PURGE_OK;
  }

  const collections = Array.from(new Set(entries.map(({ collection }) => collection)));

  return withSpan({
    name: INVALIDATE_SPAN_NAME,
    run: async (span) => {
      span.setAttributes({
        [COLLECTION_ATTRIBUTE]: collections.length === 1
          ? collections[0]
          : collections.length === 0 ? NO_COLLECTION : MIXED_COLLECTIONS,
        [SLUG_COUNT_ATTRIBUTE]: entries.length,
        [WARM_ATTRIBUTE]: warmEntries.length > 0,
        [PASS_ATTRIBUTE]: pass,
        [SCOPES_ATTRIBUTE]: scopes.length > 0 ? scopes.join(",") : NO_SCOPE,
        [NAVIGATION_ATTRIBUTE]: navigationKeys.length > 0 ? navigationKeys.join(",") : NO_SCOPE,
      });

      // One read per pass: a full clear needs the rows for its entry tags, and a root purge for
      // its entry pages. Only the tags need the read to succeed; the page step is best effort.
      let allEntryRefs: Promise<CmsEntryStatusRef[]> | null = null;
      const readAllEntryRefs = () => (allEntryRefs ??= getAllCmsEntryRefs());
      const tagEntries = scopes.includes(CMS_INVALIDATION_SCOPES.ALL_CMS)
        ? uniqueEntryRefs([...entries, ...await readAllEntryRefs()])
        : entries;

      // One call for the whole target, so the zone API gets one request per kind. The pages go
      // inside it, never after it: the warm reads through the edge and would re-store them.
      const outcome = await runCmsCacheInvalidation({
        tags: getCmsInvalidationCacheTags({ entries: tagEntries, navigationKeys, scopes }),
        purgePages: async () => {
          const zonePurge = await purgeCmsPages({
            entries,
            knownPagePathnames,
            navigationKeys,
            readAllEntryRefs,
            scopes,
          });

          span.setAttribute(EDGE_HTML_ZONE_PURGE_ATTRIBUTE, zonePurge);

          return zonePurge;
        },
      });

      // Fire and forget, so the write does not wait for the re-render.
      if (warmEntries.length > 0) {
        warmCmsEntryPages({ entries: uniqueEntryRefs(warmEntries) });
      }

      if (pass === INVALIDATION_PASS.INITIAL) {
        span.setAttribute(
          REPURGE_OUTCOME_ATTRIBUTE,
          await scheduleCmsRepurge({ entries, navigationKeys, scopes }),
        );
      }

      return outcome;
    },
  });
}

// The write is committed, so a queue fault only loses the repeat; the TTLs still bound the copy.
async function scheduleCmsRepurge(target: CmsInvalidationTarget): Promise<RepurgeOutcome> {
  try {
    await enqueueCmsRepurge({ ...target, delaySeconds: CMS_REPURGE_DELAY_SECONDS });
    return REPURGE_OUTCOME.SCHEDULED;
  } catch (error) {
    console.error("runCmsInvalidation: the delayed purge could not be queued", error);
    return REPURGE_OUTCOME.FAILED;
  }
}

// One entry, plus the earlier slugs of a rename: every slug is invalidated, only `slug` is warmed.
export async function invalidateEntryAndCollection({
  collectionSlug,
  slug,
  alsoPurgeSlugs = [],
  warm = false,
  publishStateChange = null,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
  // A rename leaves the previous slug's page and entry tag behind, so name it here; only `slug`
  // still resolves, so only it is warmed.
  alsoPurgeSlugs?: string[];
  warm?: boolean;
  // Set it only when the write moved the entry into or out of the published state.
  publishStateChange?: PublishStateChange | null;
}): Promise<CmsCachePurgeOutcome> {
  const entry = { collection: collectionSlug, slug };

  return invalidateCmsEntries({
    entries: [entry, ...alsoPurgeSlugs.map((entrySlug) => ({ ...entry, slug: entrySlug }))],
    warmEntries: warm ? [entry] : [],
    publishStateChange,
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

/** What one invalidation names: entries, navigations, and fixed scopes. The repurge payload carries it. */
interface CmsInvalidationTarget {
  entries: CmsEntryRef[];
  navigationKeys: CmsNavigationKey[];
  scopes: CmsInvalidationScope[];
}

type InvalidationPass = typeof INVALIDATION_PASS[keyof typeof INVALIDATION_PASS];
type RepurgeOutcome = typeof REPURGE_OUTCOME[keyof typeof REPURGE_OUTCOME];
