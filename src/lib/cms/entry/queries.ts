import "server-only";

import { cache } from "react";
import { and, count, eq, inArray } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/sqlite-core";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { getDB } from "@/db";
import { cmsEntryTable } from "@/db/schema";
import {
  buildCmsRelationsQuery,
  buildStatusWhereCondition,
  deserializeCmsIncludeRelations,
  serializeCmsIncludeRelations,
  withFeaturedImageUrl,
} from "@/lib/cms/entry/helpers";
import {
  getCmsCollectionCountParamsSchema,
  getCmsCollectionParamsSchema,
  getCmsEntryByIdParamsSchema,
  getCmsEntryBySlugParamsSchema,
  getEntryLocalesForSlugsParamsSchema,
  getEntryLocalesParamsSchema,
} from "@/lib/cms/entry/schemas";
import type {
  CmsCollectionListItem,
  CmsEntryLocaleSibling,
  GetCmsCollectionCountParams,
  GetCmsCollectionParams,
  GetCmsCollectionResult,
  GetCmsEntryByIdParams,
  GetCmsEntryBySlugParams,
  GetCmsEntryBySlugResult,
  GetEntryLocalesForSlugsParams,
  GetEntryLocalesParams,
} from "@/lib/cms/entry/types";
import {
  computeEntryTranslatableHashes,
  computeStaleFields,
} from "@/lib/cms/translation-staleness";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { v } from "@/lib/validation";
import type { JSONContent } from "@tiptap/core";
import {
  CMS_STATUS_FILTER_ALL,
  isCmsEntryStatus,
  type CmsStatusFilter,
  type SourceContentHashes,
} from "@/types/cms";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";

function resolveCollectionOrThrow(collectionSlug: string) {
  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  return collection;
}

// Shared read for an entry's "locale group" — the rows that share a collection + slug and differ only by
// locale (i.e. one entry's translation siblings). Callers pick the columns and whether to dedupe; this
// centralizes the collection guard and the collection+slug WHERE clause so the three locale-group readers can't drift apart.
async function selectEntryGroupRows<TColumns extends SelectedFields>({
  collectionSlug,
  slugs,
  columns,
  distinct = false,
}: {
  collectionSlug: string;
  slugs: string[];
  columns: TColumns;
  distinct?: boolean;
}) {
  const collection = resolveCollectionOrThrow(collectionSlug);
  const db = getDB();
  // Single slug uses `=` rather than `IN (…)` so the common one-entry lookup hits
  // a plain equality condition; `inArray` only when a batch of slugs is passed.
  const slugCondition = slugs.length === 1
    ? eq(cmsEntryTable.slug, slugs[0]!)
    : inArray(cmsEntryTable.slug, slugs);
  const query = distinct
    ? db.selectDistinct(columns)
    : db.select(columns);

  return query
    .from(cmsEntryTable)
    .where(and(
      eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
      slugCondition,
    ));
}

async function queryCmsCollection({
  collectionSlug,
  status,
  includeRelationsKey,
  locale,
  allLocales,
  limit,
  offset,
}: {
  collectionSlug: string;
  status: CmsStatusFilter;
  includeRelationsKey: string;
  locale: Locale;
  allLocales: boolean;
  limit?: number;
  offset?: number;
}): Promise<CmsCollectionListItem[]> {
  const includeRelations = deserializeCmsIncludeRelations(includeRelationsKey);
  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const statusCondition = buildStatusWhereCondition(status);

  const entries = await db.query.cmsEntryTable.findMany({
    where: {
      collection: collection.slug as CollectionsUnion,
      // Admin listing opts into every locale's rows via `allLocales`; every
      // other (public) caller stays locale-filtered by omitting it, which
      // defaults to false here.
      ...(allLocales ? {} : { locale }),
      ...statusCondition,
    },
    // No list/collection caller renders the entry body, so exclude the large `content` and `fields` JSON
    // columns from the projection. Multiplied by N locale rows per entry, streaming these was the dominant cost
    // on the nav tree + admin table + blog listings. Single-entry reads keep the full row.
    columns: {
      content: false,
      fields: false,
    },
    orderBy: { createdAt: "desc" },
    limit,
    offset,
    with: buildCmsRelationsQuery(includeRelations),
  });

  return entries.map((entry) => withFeaturedImageUrl(entry as CmsCollectionListItem));
}

async function getCachedCmsCollection(
  collectionSlug: string,
  status: CmsStatusFilter,
  includeRelationsKey: string,
  locale: Locale,
  allLocales: boolean,
  limit?: number,
  offset?: number,
): Promise<CmsCollectionListItem[]> {
  "use cache: remote";
  setCacheScope({
    tags: [CACHE_TAGS.cmsCollection(collectionSlug)],
    ttl: "8 hours",
  });

  return queryCmsCollection({
    collectionSlug,
    status,
    includeRelationsKey,
    locale,
    allLocales,
    limit,
    offset,
  });
}

export function getCmsCollection<T extends CollectionsUnion>(
  params: GetCmsCollectionParams<T>
): Promise<CmsCollectionListItem[]> {
  const validated = v.parse(getCmsCollectionParamsSchema, params);

  return getCachedCmsCollection(
    validated.collectionSlug,
    validated.status,
    serializeCmsIncludeRelations(validated.includeRelations),
    validated.locale,
    validated.allLocales,
    validated.limit,
    validated.offset,
  );
}

export function getFreshCmsCollection<T extends CollectionsUnion>(
  params: GetCmsCollectionParams<T>
): Promise<CmsCollectionListItem[]> {
  const validated = v.parse(getCmsCollectionParamsSchema, params);

  return queryCmsCollection({
    collectionSlug: validated.collectionSlug,
    status: validated.status,
    includeRelationsKey: serializeCmsIncludeRelations(validated.includeRelations),
    locale: validated.locale,
    allLocales: validated.allLocales,
    limit: validated.limit,
    offset: validated.offset,
  });
}

async function queryCmsCollectionCount({
  collectionSlug,
  status,
  locale,
  allLocales,
}: {
  collectionSlug: string;
  status: CmsStatusFilter;
  locale: Locale;
  allLocales: boolean;
}): Promise<number> {
  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const db = getDB();
  const whereConditions = [
    eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
  ];

  // Admin listing opts into every locale's rows via `allLocales`; every other
  // (public) caller stays locale-filtered.
  if (!allLocales) {
    whereConditions.push(eq(cmsEntryTable.locale, locale));
  }

  const statusCondition = status === CMS_STATUS_FILTER_ALL
    ? undefined
    : eq(cmsEntryTable.status, status);
  if (statusCondition) {
    whereConditions.push(statusCondition);
  }

  const result = await db
    .select({ count: count() })
    .from(cmsEntryTable)
    .where(and(...whereConditions));

  return result[0]?.count ?? 0;
}

async function getCachedCmsCollectionCount(
  collectionSlug: string,
  status: CmsStatusFilter,
  locale: Locale,
  allLocales: boolean,
): Promise<number> {
  "use cache: remote";
  setCacheScope({
    tags: [CACHE_TAGS.cmsCollectionCount(collectionSlug)],
    ttl: "8 hours",
  });

  return queryCmsCollectionCount({ collectionSlug, status, locale, allLocales });
}

export function getCmsCollectionCount<T extends CollectionsUnion>(
  params: GetCmsCollectionCountParams<T>
): Promise<number> {
  const validated = v.parse(getCmsCollectionCountParamsSchema, params);

  return getCachedCmsCollectionCount(
    validated.collectionSlug,
    validated.status,
    validated.locale,
    validated.allLocales,
  );
}

export function getFreshCmsCollectionCount<T extends CollectionsUnion>(
  params: GetCmsCollectionCountParams<T>
): Promise<number> {
  const validated = v.parse(getCmsCollectionCountParamsSchema, params);

  return queryCmsCollectionCount({
    collectionSlug: validated.collectionSlug,
    status: validated.status,
    locale: validated.locale,
    allLocales: validated.allLocales,
  });
}

// Request-scoped dedup only (React cache), not the remote persistent cache its
// siblings use: callers are admin edit + mutations that must read fresh DB state.
const getFreshCmsEntryById = cache(async (
  id: string,
  includeRelationsKey: string,
): Promise<GetCmsCollectionResult | null> => {
  const includeRelations = deserializeCmsIncludeRelations(includeRelationsKey);

  const db = getDB();

  const entry = await db.query.cmsEntryTable.findFirst({
    where: { id: id },
    with: buildCmsRelationsQuery(includeRelations),
  });

  if (!entry) {
    return null;
  }

  return withFeaturedImageUrl(entry as GetCmsCollectionResult);
});

export function getCmsEntryById(params: GetCmsEntryByIdParams): Promise<GetCmsCollectionResult | null> {
  const validated = v.parse(getCmsEntryByIdParamsSchema, params);

  return getFreshCmsEntryById(
    validated.id,
    serializeCmsIncludeRelations(validated.includeRelations),
  );
}

async function getCachedCmsEntryBySlug(
  collectionSlug: string,
  slug: string,
  status: CmsStatusFilter,
  includeRelationsKey: string,
  locale: Locale,
): Promise<GetCmsEntryBySlugResult | null> {
  "use cache: remote";
  const includeRelations = deserializeCmsIncludeRelations(includeRelationsKey);
  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  setCacheScope({
    tags: [
      CACHE_TAGS.cmsEntry({
        collectionSlug: collection.slug,
        slug,
      }),
    ],
    ttl: "7 days",
  });

  const db = getDB();

  const statusCondition = buildStatusWhereCondition(status);

  const entry = await db.query.cmsEntryTable.findFirst({
    where: {
      collection: collection.slug as CollectionsUnion,
      slug,
      locale,
      ...statusCondition,
    },
    with: buildCmsRelationsQuery(includeRelations),
  });

  if (!entry) {
    return null;
  }

  return withFeaturedImageUrl(entry as GetCmsCollectionResult);
}

export async function getCmsEntryBySlug<T extends CollectionsUnion>(
  params: GetCmsEntryBySlugParams<T>
): Promise<GetCmsEntryBySlugResult | null> {
  const validated = v.parse(getCmsEntryBySlugParamsSchema, params);

  const cachedEntry = await getCachedCmsEntryBySlug(
    validated.collectionSlug,
    validated.slug,
    validated.status,
    serializeCmsIncludeRelations(validated.includeRelations),
    validated.locale,
  );

  if (!cachedEntry) {
    return null;
  }

  return cachedEntry;
}

async function getCachedEntryLocales(
  collectionSlug: string,
  slug: string,
): Promise<string[]> {
  "use cache: remote";
  const collection = resolveCollectionOrThrow(collectionSlug);

  setCacheScope({
    tags: [
      CACHE_TAGS.cmsEntry({
        collectionSlug: collection.slug,
        slug,
      }),
    ],
    ttl: "7 days",
  });

  const rows = await selectEntryGroupRows({
    collectionSlug,
    slugs: [slug],
    columns: { locale: cmsEntryTable.locale },
    distinct: true,
  });

  return rows.map((row) => row.locale);
}

// Used by hreflang generation to render only alternate-language links that exist.
export function getEntryLocales(params: GetEntryLocalesParams): Promise<string[]> {
  const validated = v.parse(getEntryLocalesParamsSchema, params);

  return getCachedEntryLocales(validated.collectionSlug, validated.slug);
}

// Not cached: the editor must see a just-created locale sibling immediately.
export async function getEntryLocaleSiblings(
  params: GetEntryLocalesParams
): Promise<CmsEntryLocaleSibling[]> {
  const validated = v.parse(getEntryLocalesParamsSchema, params);

  const rows = await selectEntryGroupRows({
    collectionSlug: validated.collectionSlug,
    slugs: [validated.slug],
    columns: {
      id: cmsEntryTable.id,
      locale: cmsEntryTable.locale,
      status: cmsEntryTable.status,
      title: cmsEntryTable.title,
      seoDescription: cmsEntryTable.seoDescription,
      content: cmsEntryTable.content,
      sourceContentHashes: cmsEntryTable.sourceContentHashes,
    },
  });

  // The default-locale row is the canonical source; a translation is stale when its captured source-hash
  // snapshot no longer matches this row's live hashes. Hash it once for the whole group. No default row (a
  // translation without its base) → no staleness is reported.
  const sourceRow = rows.find((row) => row.locale === DEFAULT_LOCALE);
  const sourceHashes = sourceRow
    ? computeEntryTranslatableHashes({
        title: sourceRow.title,
        seoDescription: sourceRow.seoDescription,
        content: sourceRow.content as JSONContent,
      })
    : null;

  // Drop rows whose locale/status aren't in the known sets: a de-served or legacy
  // value must not be offered by the switcher as a valid sibling to link to.
  return rows.flatMap((row) => {
    if (!isLocale(row.locale) || !isCmsEntryStatus(row.status)) {
      return [];
    }
    const staleFields =
      sourceHashes && row.locale !== DEFAULT_LOCALE
        ? computeStaleFields({
            snapshot: row.sourceContentHashes as SourceContentHashes | null,
            current: sourceHashes,
          })
        : [];
    return [
      {
        id: row.id,
        locale: row.locale,
        status: row.status,
        isStale: staleFields.length > 0,
        staleFields,
      },
    ];
  });
}

// Powers the admin table's per-row "missing translation" indicator without an
// extra query per row.
export async function getEntryLocalesForSlugs(
  params: GetEntryLocalesForSlugsParams
): Promise<Map<string, Set<Locale>>> {
  const validated = v.parse(getEntryLocalesForSlugsParamsSchema, params);

  const coverage = new Map<string, Set<Locale>>();
  if (validated.slugs.length === 0) {
    return coverage;
  }

  const rows = await selectEntryGroupRows({
    collectionSlug: validated.collectionSlug,
    slugs: validated.slugs,
    columns: {
      slug: cmsEntryTable.slug,
      locale: cmsEntryTable.locale,
    },
    distinct: true,
  });

  for (const row of rows) {
    if (!isLocale(row.locale)) {
      continue;
    }
    const existing = coverage.get(row.slug) ?? new Set<Locale>();
    existing.add(row.locale);
    coverage.set(row.slug, existing);
  }

  return coverage;
}
