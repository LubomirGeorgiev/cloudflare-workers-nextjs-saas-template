import "server-only";

import { cache } from "react";
import { and, count, desc, eq } from "drizzle-orm";
import type { InferOutput } from "valibot";

import { getDB } from "@/db";
import {
  cmsEntryTable,
  cmsEntryTagTable,
  cmsTagTable,
} from "@/db/schema";
import {
  invalidateAllCmsCollectionCaches,
  invalidateCmsTagsCache,
} from "@/lib/cms/cms-cache-invalidation";
import {
  CMS_STATUS_FILTER_ALL,
  cmsStatusFilterTuple,
  type CmsStatusFilter,
} from "@/types/cms";
import { CACHE_KEYS, withKVCache } from "@/utils/with-kv-cache";
import { requiredString, v } from "@/lib/validation";

const cmsTagStatusOrAllSchema = v.picklist(cmsStatusFilterTuple);

const getCmsTagByIdParamsSchema = requiredString();

const getCmsEntriesByTagIdParamsSchema = v.object({
  tagId: requiredString(),
  status: v.optional(cmsTagStatusOrAllSchema, CMS_STATUS_FILTER_ALL),
});

const createCmsTagParamsSchema = v.object({
  name: requiredString(),
  slug: requiredString(),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
  createdBy: requiredString(),
});

const updateCmsTagParamsSchema = v.object({
  id: requiredString(),
  name: v.optional(requiredString()),
  slug: v.optional(requiredString()),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
});

const deleteCmsTagParamsSchema = requiredString();

export const getCmsTags = cache(async () => {
  return withKVCache(async () => {
    const db = getDB();

    const tags = await db
      .select({
        id: cmsTagTable.id,
        name: cmsTagTable.name,
        slug: cmsTagTable.slug,
        description: cmsTagTable.description,
        color: cmsTagTable.color,
        createdBy: cmsTagTable.createdBy,
        createdAt: cmsTagTable.createdAt,
        updatedAt: cmsTagTable.updatedAt,
        updateCounter: cmsTagTable.updateCounter,
        entryCount: count(cmsEntryTagTable.id),
      })
      .from(cmsTagTable)
      .leftJoin(cmsEntryTagTable, eq(cmsTagTable.id, cmsEntryTagTable.tagId))
      .groupBy(cmsTagTable.id)
      .orderBy(desc(cmsTagTable.createdAt));

    return tags;
  }, {
    key: CACHE_KEYS.CMS_TAGS,
    ttl: "8 hours",
  });
});

export const getCmsTagById = cache(async (id: InferOutput<typeof getCmsTagByIdParamsSchema>) => {
  const validated = v.parse(getCmsTagByIdParamsSchema, id);

  const db = getDB();
  return await db.query.cmsTagTable.findFirst({
    where: eq(cmsTagTable.id, validated),
  });
});

const getCachedCmsEntriesByTagId = cache(async (tagId: string, status: CmsStatusFilter) => {
  const db = getDB();

  const conditions = [eq(cmsEntryTagTable.tagId, tagId)];

  if (status !== CMS_STATUS_FILTER_ALL) {
    conditions.push(eq(cmsEntryTable.status, status));
  }

  const entries = await db
    .select({
      id: cmsEntryTable.id,
      title: cmsEntryTable.title,
      slug: cmsEntryTable.slug,
      collection: cmsEntryTable.collection,
      status: cmsEntryTable.status,
      createdAt: cmsEntryTable.createdAt,
      updatedAt: cmsEntryTable.updatedAt,
    })
    .from(cmsEntryTagTable)
    .innerJoin(cmsEntryTable, eq(cmsEntryTagTable.entryId, cmsEntryTable.id))
    .where(and(...conditions))
    .orderBy(desc(cmsEntryTable.updatedAt));

  return entries.reduce((acc, entry) => {
    if (!acc[entry.collection]) {
      acc[entry.collection] = [];
    }
    acc[entry.collection].push(entry);
    return acc;
  }, {} as Record<string, typeof entries>);
});

export function getCmsEntriesByTagId(params: { tagId: string; status?: CmsStatusFilter }) {
  const validated = v.parse(getCmsEntriesByTagIdParamsSchema, params);

  return getCachedCmsEntriesByTagId(validated.tagId, validated.status);
}

export async function createCmsTag(params: InferOutput<typeof createCmsTagParamsSchema>) {
  const validated = v.parse(createCmsTagParamsSchema, params);
  const { name, slug, description, color, createdBy } = validated;

  const db = getDB();

  const existingTag = await db.query.cmsTagTable.findFirst({
    where: eq(cmsTagTable.slug, slug),
  });

  if (existingTag) {
    throw new Error(`Tag with slug "${slug}" already exists`);
  }

  const [newTag] = await db.insert(cmsTagTable).values({
    name,
    slug,
    description,
    color,
    createdBy,
  }).returning();

  await invalidateCmsTagsCache();

  return newTag;
}

export async function updateCmsTag(params: InferOutput<typeof updateCmsTagParamsSchema>) {
  const validated = v.parse(updateCmsTagParamsSchema, params);
  const { id, name, slug, description, color } = validated;

  const db = getDB();

  const existingTag = await db.query.cmsTagTable.findFirst({
    where: eq(cmsTagTable.id, id),
  });

  if (!existingTag) {
    throw new Error(`Tag with id "${id}" not found`);
  }

  if (slug && slug !== existingTag.slug) {
    const conflictingTag = await db.query.cmsTagTable.findFirst({
      where: eq(cmsTagTable.slug, slug),
    });

    if (conflictingTag) {
      throw new Error(`Tag with slug "${slug}" already exists`);
    }
  }

  const [updatedTag] = await db
    .update(cmsTagTable)
    .set({
      name,
      slug,
      description,
      color,
    })
    .where(eq(cmsTagTable.id, id))
    .returning();

  await invalidateAllCmsCollectionCaches();

  return updatedTag;
}

export async function deleteCmsTag(id: InferOutput<typeof deleteCmsTagParamsSchema>) {
  const validated = v.parse(deleteCmsTagParamsSchema, id);

  const db = getDB();

  await db.delete(cmsTagTable).where(eq(cmsTagTable.id, validated));
  await invalidateAllCmsCollectionCaches();
}
