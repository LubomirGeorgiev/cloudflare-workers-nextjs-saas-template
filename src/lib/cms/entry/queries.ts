import "server-only";

import { cache } from "react";
import { and, count, desc, eq } from "drizzle-orm";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { getDB } from "@/db";
import { cmsEntryTable } from "@/db/schema";
import {
  getCmsCollectionCacheKey,
  getCmsCollectionCountCacheKey,
  getCmsEntryCacheKey,
} from "@/lib/cms/cms-cache-invalidation";
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
import type { CmsStatusFilter } from "@/types/cms";
import { withKVCache } from "@/utils/with-kv-cache";
import { v } from "@/lib/validation";

const getCachedCmsCollection = cache(async (
  collectionSlug: string,
  status: CmsStatusFilter,
  includeRelationsKey: string,
  limit?: number,
  offset?: number,
): Promise<GetCmsCollectionResult[]> => {
  const includeRelations = deserializeCmsIncludeRelations(includeRelationsKey);

  const cacheKey = getCmsCollectionCacheKey({
    collectionSlug: collectionSlug as CollectionsUnion,
    status,
    includeRelations,
    limit,
    offset,
  });

  return withKVCache(
    async () => {
      const db = getDB();

      const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
      if (!collection) {
        throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
      }

      const whereConditions = [
        eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
      ];

      const statusCondition = buildStatusWhereCondition(status);
      if (statusCondition) {
        whereConditions.push(statusCondition);
      }

      const entries = await db.query.cmsEntryTable.findMany({
        where: and(...whereConditions),
        orderBy: [desc(cmsEntryTable.createdAt)],
        limit,
        offset,
        with: buildCmsRelationsQuery(includeRelations),
      });

      return entries.map((entry) => withFeaturedImageUrl(entry as GetCmsCollectionResult));
    },
    {
      key: cacheKey,
      ttl: "8 hours",
    }
  );
});

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

const getCachedCmsCollectionCount = cache(async (
  collectionSlug: string,
  status: CmsStatusFilter,
): Promise<number> => {
  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const cacheKey = getCmsCollectionCountCacheKey({
    collectionSlug: collection.slug as CollectionsUnion,
    status,
  });

  return withKVCache(async () => {
    const db = getDB();
    const whereConditions = [
      eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
    ];

    const statusCondition = buildStatusWhereCondition(status);
    if (statusCondition) {
      whereConditions.push(statusCondition);
    }

    const result = await db
      .select({ count: count() })
      .from(cmsEntryTable)
      .where(and(...whereConditions));

    return result[0]?.count ?? 0;
  }, {
    key: cacheKey,
    ttl: "8 hours",
  });
});

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
    where: eq(cmsEntryTable.id, id),
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

export async function getCmsEntryBySlug<T extends CollectionsUnion>(
  params: GetCmsEntryBySlugParams<T>
): Promise<GetCmsEntryBySlugResult | null> {
  const validated = v.parse(getCmsEntryBySlugParamsSchema, params);
  const { collectionSlug, slug, status, includeRelations } = validated;

  const collection = cmsConfig.collections[collectionSlug as T];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const cacheKey = getCmsEntryCacheKey({
    collectionSlug: collection.slug as CollectionsUnion,
    slug,
    status,
    includeRelations,
  });

  const cachedEntry = await withKVCache(
    async () => {
      const db = getDB();

      const whereConditions = [
        eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
        eq(cmsEntryTable.slug, slug),
      ];

      const statusCondition = buildStatusWhereCondition(status);
      if (statusCondition) {
        whereConditions.push(statusCondition);
      }

      const entry = await db.query.cmsEntryTable.findFirst({
        where: and(...whereConditions),
        with: buildCmsRelationsQuery(includeRelations),
      });

      if (!entry) {
        return null;
      }

      return withFeaturedImageUrl(entry as GetCmsCollectionResult);
    },
    {
      key: cacheKey,
      ttl: "7 days",
    }
  );

  if (!cachedEntry) {
    return null;
  }

  return cachedEntry;
}
