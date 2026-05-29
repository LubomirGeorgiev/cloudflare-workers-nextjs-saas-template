import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { JSONContent } from "@tiptap/core";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { getDB } from "@/db";
import {
  cmsEntryMediaTable,
  cmsEntryTable,
  cmsEntryTagTable,
  cmsEntryVersionTable,
  type CmsEntry,
} from "@/db/schema";
import {
  invalidateCmsCollectionCache,
  invalidateCmsCollectionCountCache,
  invalidateCmsEntryCache,
  invalidateCmsNavigationCachesForCollection,
  invalidateCmsTagsCache,
  invalidateEntryAndCollection,
  invalidateSitemapCache,
} from "@/lib/cms/cms-cache-invalidation";
import {
  deleteCmsPublishSchedule,
  syncCmsPublishSchedule,
} from "@/lib/cms/cms-scheduled-publishing";
import {
  removeCmsEntrySearch,
  syncCmsEntrySearch,
} from "@/lib/cms/cms-search";
import {
  handlePublishedAt,
  validateEntryFields,
  validateSeoDescription,
} from "@/lib/cms/entry/helpers";
import {
  createCmsEntryParamsSchema,
  deleteCmsEntryParamsSchema,
  updateCmsEntryParamsSchema,
} from "@/lib/cms/entry/schemas";
import type {
  CreateCmsEntryParams,
  DeleteCmsEntryParams,
  UpdateCmsEntryParams,
} from "@/lib/cms/entry/types";
import { generateSeoDescription } from "@/lib/cms/generate-seo-description";
import { syncEntryMediaRelationships } from "@/lib/cms/media-tracking";
import { v } from "@/lib/validation";

export async function createCmsEntry<T extends CollectionsUnion>(
  params: CreateCmsEntryParams<T>
): Promise<CmsEntry> {
  const validated = v.parse(createCmsEntryParamsSchema, params);
  const { collectionSlug, slug, title, content, fields, seoDescription, status, publishedAt, createdBy, tagIds, featuredImageId } = validated;

  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug as T];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const validatedFields = validateEntryFields(fields, collection);

  let finalSeoDescription = seoDescription;
  if (!finalSeoDescription || finalSeoDescription.trim() === "") {
    const generatedDescription = await generateSeoDescription({
      title,
      content,
      collectionSlug: collection.slug as CollectionsUnion,
    });
    if (generatedDescription) {
      finalSeoDescription = generatedDescription;
    }
  }

  validateSeoDescription(finalSeoDescription);

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: and(
      eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
      eq(cmsEntryTable.slug, slug)
    ),
  });

  if (existingEntry) {
    throw new Error(`Entry with slug "${slug}" already exists in collection "${collection.slug}"`);
  }

  const finalPublishedAt = handlePublishedAt(status, publishedAt);

  const [newEntry] = await db.insert(cmsEntryTable).values({
    collection: collection.slug as CollectionsUnion,
    slug,
    title,
    content,
    fields: validatedFields,
    seoDescription: finalSeoDescription,
    status,
    publishedAt: finalPublishedAt,
    createdBy,
    featuredImageId,
  }).returning();

  if (tagIds && tagIds.length > 0) {
    await db.insert(cmsEntryTagTable).values(
      tagIds.map((tagId: string) => ({
        entryId: newEntry.id,
        tagId,
      }))
    );
  }

  await syncEntryMediaRelationships({
    entryId: newEntry.id,
    content,
    featuredImageId,
  });

  await syncCmsEntrySearch({
    entryId: newEntry.id,
    collection: newEntry.collection,
    slug: newEntry.slug,
    title: newEntry.title,
    seoDescription: newEntry.seoDescription,
    content: newEntry.content as JSONContent,
  });

  await Promise.all([
    invalidateCmsEntryCache({
      collectionSlug: collection.slug as CollectionsUnion,
      slug,
    }),
    invalidateCmsCollectionCache({
      collectionSlug: collection.slug as CollectionsUnion,
    }),
    invalidateCmsCollectionCountCache({
      collectionSlug: collection.slug as CollectionsUnion,
    }),
    invalidateCmsNavigationCachesForCollection({
      collectionSlug: collection.slug as CollectionsUnion,
    }),
    invalidateSitemapCache(),
    invalidateCmsTagsCache(),
  ]);

  await syncCmsPublishSchedule(newEntry);

  return newEntry;
}

export async function updateCmsEntry(params: UpdateCmsEntryParams): Promise<CmsEntry | null> {
  const validated = v.parse(updateCmsEntryParamsSchema, params);
  const { id, slug, title, content, fields, seoDescription, status, publishedAt, tagIds, featuredImageId } = validated;

  const db = getDB();

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  const collection = cmsConfig.collections[existingEntry.collection as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${existingEntry.collection}" not found in CMS config`);
  }

  let validatedFields: unknown = undefined;
  if (fields !== undefined) {
    validatedFields = validateEntryFields(fields, collection);
  }

  let finalSeoDescription = seoDescription;

  // Auto-generate SEO only when the caller did not provide one and the entry lacks one.
  const finalTitle = title ?? existingEntry.title;
  const finalContent = content ?? existingEntry.content;
  const contentOrTitleChanged = content !== undefined || title !== undefined;
  const shouldGenerateSeo =
    finalSeoDescription === undefined &&
    contentOrTitleChanged &&
    (!existingEntry.seoDescription || existingEntry.seoDescription.trim() === "");

  if (shouldGenerateSeo) {
    const generatedDescription = await generateSeoDescription({
      title: finalTitle,
      content: finalContent as JSONContent,
      collectionSlug: existingEntry.collection,
    });
    if (generatedDescription) {
      finalSeoDescription = generatedDescription;
    }
  }

  validateSeoDescription(finalSeoDescription);

  if (slug && slug !== existingEntry.slug) {
    const conflictingEntry = await db.query.cmsEntryTable.findFirst({
      where: and(
        eq(cmsEntryTable.collection, existingEntry.collection),
        eq(cmsEntryTable.slug, slug)
      ),
    });

    if (conflictingEntry) {
      throw new Error(`Entry with slug "${slug}" already exists in collection "${existingEntry.collection}"`);
    }
  }

  const finalStatus = status ?? existingEntry.status;
  const finalPublishedAt = publishedAt !== undefined
    ? handlePublishedAt(finalStatus, publishedAt, existingEntry.publishedAt)
    : undefined;

  const updateData = {
    slug,
    title,
    content,
    fields: validatedFields,
    seoDescription: finalSeoDescription,
    status,
    publishedAt: finalPublishedAt,
    featuredImageId,
  };

  const filteredUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([__, value]) => value !== undefined)
  );

  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set(filteredUpdateData)
    .where(eq(cmsEntryTable.id, id))
    .returning();

  if (tagIds) {
    await db.delete(cmsEntryTagTable).where(eq(cmsEntryTagTable.entryId, id));

    if (tagIds.length > 0) {
      await db.insert(cmsEntryTagTable).values(
        tagIds.map((tagId: string) => ({
          entryId: id,
          tagId,
        }))
      );
    }
  }

  if (content !== undefined || featuredImageId !== undefined) {
    await syncEntryMediaRelationships({
      entryId: id,
      content: content ?? existingEntry.content,
      featuredImageId: featuredImageId !== undefined ? featuredImageId : existingEntry.featuredImageId,
    });
  }

  await syncCmsEntrySearch({
    entryId: id,
    collection: updatedEntry.collection,
    slug: updatedEntry.slug,
    title: updatedEntry.title,
    seoDescription: updatedEntry.seoDescription,
    content: updatedEntry.content as JSONContent,
  });

  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: eq(cmsEntryVersionTable.entryId, id),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
  });

  // Version 1 snapshots the pre-update state because entry creation skips duplicate history.
  if (!latestVersion) {
    await db.insert(cmsEntryVersionTable).values({
      entryId: id,
      versionNumber: 1,
      title: existingEntry.title,
      content: existingEntry.content as JSONContent,
      fields: existingEntry.fields,
      slug: existingEntry.slug,
      seoDescription: existingEntry.seoDescription,
      status: existingEntry.status,
      featuredImageId: existingEntry.featuredImageId,
      createdBy: existingEntry.createdBy,
    });
  }

  const nextVersionNumber = (latestVersion?.versionNumber ?? 1) + 1;
  const versionContent = content ?? existingEntry.content;
  const versionFields = validatedFields ?? existingEntry.fields;

  await db.insert(cmsEntryVersionTable).values({
    entryId: id,
    versionNumber: nextVersionNumber,
    title: title ?? existingEntry.title,
    content: versionContent as JSONContent,
    fields: versionFields,
    slug: slug ?? existingEntry.slug,
    seoDescription: finalSeoDescription ?? existingEntry.seoDescription,
    status: status ?? existingEntry.status,
    featuredImageId: featuredImageId !== undefined ? featuredImageId : existingEntry.featuredImageId,
    createdBy: existingEntry.createdBy, // Schema tracks the original author for version rows.
  });

  const oldSlug = existingEntry.slug;
  const newSlug = slug ?? oldSlug;
  const collectionSlug = existingEntry.collection;
  const slugsToInvalidate = new Set([oldSlug, newSlug]);

  await Promise.all([
    ...Array.from(slugsToInvalidate).map(slugToInvalidate =>
      invalidateCmsEntryCache({ collectionSlug, slug: slugToInvalidate })
    ),
    invalidateCmsCollectionCache({ collectionSlug }),
    invalidateCmsCollectionCountCache({ collectionSlug }),
    invalidateCmsNavigationCachesForCollection({ collectionSlug }),
    invalidateSitemapCache(),
    invalidateCmsTagsCache(),
  ]);

  await syncCmsPublishSchedule(updatedEntry);

  return updatedEntry || null;
}

export async function deleteCmsEntry(params: DeleteCmsEntryParams): Promise<void> {
  const validated = v.parse(deleteCmsEntryParamsSchema, params);
  const { id } = validated;

  const db = getDB();

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  const collectionSlug = existingEntry.collection;
  const slug = existingEntry.slug;

  await db.delete(cmsEntryMediaTable).where(eq(cmsEntryMediaTable.entryId, id));
  await db.delete(cmsEntryTable).where(eq(cmsEntryTable.id, id));

  await removeCmsEntrySearch({ entryId: id });
  await deleteCmsPublishSchedule(id);
  await invalidateEntryAndCollection({ collectionSlug, slug });
}
