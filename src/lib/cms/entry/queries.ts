import "server-only";

import { cache } from "react";
import { and, count, eq } from "drizzle-orm";

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
} from "@/lib/cms/entry/schemas";
import type {
  GetCmsCollectionCountParams,
  GetCmsCollectionParams,
  GetCmsCollectionResult,
  GetCmsEntryByIdParams,
  GetCmsEntryBySlugParams,
  GetCmsEntryBySlugResult,
} from "@/lib/cms/entry/types";
import { v } from "@/lib/validation";
import { CMS_STATUS_FILTER_ALL, type CmsStatusFilter } from "@/types/cms";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";

async function getCachedCmsCollection(
  collectionSlug: string,
  status: CmsStatusFilter,
  includeRelationsKey: string,
  limit?: number,
  offset?: number,
): Promise<GetCmsCollectionResult[]> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsCollection(collectionSlug),
    ],
    ttl: "8 hours",
  });

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
      ...statusCondition,
    },
    orderBy: { createdAt: "desc" },
    limit,
    offset,
    with: buildCmsRelationsQuery(includeRelations),
  });

  return entries.map((entry) => withFeaturedImageUrl(entry as GetCmsCollectionResult));
}

export function getCmsCollection<T extends CollectionsUnion>(
  params: GetCmsCollectionParams<T>
): Promise<GetCmsCollectionResult[]> {
  const validated = v.parse(getCmsCollectionParamsSchema, params);

  return getCachedCmsCollection(
    validated.collectionSlug,
    validated.status,
    serializeCmsIncludeRelations(validated.includeRelations),
    validated.limit,
    validated.offset,
  );
}

async function getCachedCmsCollectionCount(
  collectionSlug: string,
  status: CmsStatusFilter,
): Promise<number> {
  "use cache: remote";
  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  setCacheScope({
    tags: [
      CACHE_TAGS.cmsCollectionCount(collection.slug),
    ],
    ttl: "8 hours",
  });

  const db = getDB();
  const whereConditions = [
    eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
  ];

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

export function getCmsCollectionCount<T extends CollectionsUnion>(
  params: GetCmsCollectionCountParams<T>
): Promise<number> {
  const validated = v.parse(getCmsCollectionCountParamsSchema, params);

  return getCachedCmsCollectionCount(validated.collectionSlug, validated.status);
}

const getCachedCmsEntryById = cache(async (
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

  return getCachedCmsEntryById(
    validated.id,
    serializeCmsIncludeRelations(validated.includeRelations),
  );
}

async function getCachedCmsEntryBySlug(
  collectionSlug: string,
  slug: string,
  status: CmsStatusFilter,
  includeRelationsKey: string,
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
  );

  if (!cachedEntry) {
    return null;
  }

  return cachedEntry;
}
