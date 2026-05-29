import "server-only";

import { cache } from "react";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { JSONContent } from "@tiptap/core";
import type { InferOutput } from "valibot";

import { getDB } from "@/db";
import {
  cmsEntryTable,
  cmsEntryVersionTable,
  type CmsEntry,
  type CmsEntryVersion,
} from "@/db/schema";
import {
  invalidateCmsCollectionCache,
  invalidateCmsCollectionCountCache,
  invalidateCmsEntryCache,
  invalidateCmsNavigationCachesForCollection,
  invalidateSitemapCache,
} from "@/lib/cms/cms-cache-invalidation";
import {
  deleteCmsEntryVersionParamsSchema,
  getCmsEntryVersionsParamsSchema,
  revertCmsEntryToVersionParamsSchema,
} from "@/lib/cms/entry/schemas";
import { syncEntryMediaRelationships } from "@/lib/cms/media-tracking";
import { v } from "@/lib/validation";

export const getCmsEntryVersions = cache(async (
  entryId: InferOutput<typeof getCmsEntryVersionsParamsSchema>
): Promise<CmsEntryVersion[]> => {
  const validated = v.parse(getCmsEntryVersionsParamsSchema, entryId);

  const db = getDB();
  return await db.query.cmsEntryVersionTable.findMany({
    where: eq(cmsEntryVersionTable.entryId, validated),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
    with: {
      createdByUser: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatar: true,
        },
      },
    },
  });
});

export const getCmsEntryVersionCount = cache(async (
  entryId: InferOutput<typeof getCmsEntryVersionsParamsSchema>
): Promise<number> => {
  const validated = v.parse(getCmsEntryVersionsParamsSchema, entryId);

  const db = getDB();
  const result = await db
    .select({ count: count() })
    .from(cmsEntryVersionTable)
    .where(eq(cmsEntryVersionTable.entryId, validated));

  return result[0]?.count ?? 0;
});

export async function deleteCmsEntryVersion(
  params: InferOutput<typeof deleteCmsEntryVersionParamsSchema>
): Promise<void> {
  const validated = v.parse(deleteCmsEntryVersionParamsSchema, params);
  const { entryId, versionId } = validated;

  const db = getDB();

  const version = await db.query.cmsEntryVersionTable.findFirst({
    where: and(
      eq(cmsEntryVersionTable.id, versionId),
      eq(cmsEntryVersionTable.entryId, entryId)
    ),
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found for entry "${entryId}"`);
  }

  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: eq(cmsEntryVersionTable.entryId, entryId),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
  });

  if (latestVersion && latestVersion.id === versionId) {
    throw new Error("Cannot delete the latest version. Please create a new version first.");
  }

  const versionCount = await db.select({ count: sql<number>`count(*)` })
    .from(cmsEntryVersionTable)
    .where(eq(cmsEntryVersionTable.entryId, entryId));

  if (versionCount[0]?.count <= 1) {
    throw new Error("Cannot delete the only version of an entry.");
  }

  await db.delete(cmsEntryVersionTable)
    .where(and(
      eq(cmsEntryVersionTable.id, versionId),
      eq(cmsEntryVersionTable.entryId, entryId)
    ));

  if (versionCount[0]?.count === 2) {
    // When pruning history down to the latest snapshot, restart numbering from 1.
    await db.update(cmsEntryVersionTable)
      .set({ versionNumber: 1 })
      .where(eq(cmsEntryVersionTable.entryId, entryId));
  }
}

export async function revertCmsEntryToVersion(
  params: InferOutput<typeof revertCmsEntryToVersionParamsSchema>
): Promise<CmsEntry> {
  const validated = v.parse(revertCmsEntryToVersionParamsSchema, params);
  const { entryId, versionId } = validated;

  const db = getDB();

  const version = await db.query.cmsEntryVersionTable.findFirst({
    where: and(
      eq(cmsEntryVersionTable.id, versionId),
      eq(cmsEntryVersionTable.entryId, entryId)
    ),
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found for entry "${entryId}"`);
  }

  const currentEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, entryId),
  });

  if (!currentEntry) {
    throw new Error(`Entry "${entryId}" not found`);
  }

  // Reverts create a new linear history point rather than rewriting old rows.
  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: eq(cmsEntryVersionTable.entryId, entryId),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
  });

  if (!latestVersion) {
    await db.insert(cmsEntryVersionTable).values({
      entryId,
      versionNumber: 1,
      title: currentEntry.title,
      content: currentEntry.content as JSONContent,
      fields: currentEntry.fields,
      slug: currentEntry.slug,
      seoDescription: currentEntry.seoDescription,
      status: currentEntry.status,
      featuredImageId: currentEntry.featuredImageId,
      createdBy: currentEntry.createdBy,
    });
  }

  const nextVersionNumber = (latestVersion?.versionNumber ?? 1) + 1;

  await db.insert(cmsEntryVersionTable).values({
    entryId,
    versionNumber: nextVersionNumber,
    title: version.title,
    content: version.content,
    fields: version.fields,
    slug: version.slug,
    seoDescription: version.seoDescription,
    status: version.status,
    featuredImageId: version.featuredImageId,
    createdBy: version.createdBy, // Or the current user if we had that context here
  });

  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set({
      title: version.title,
      content: version.content,
      fields: version.fields,
      slug: version.slug,
      seoDescription: version.seoDescription,
      status: version.status,
      featuredImageId: version.featuredImageId,
    })
    .where(eq(cmsEntryTable.id, entryId))
    .returning();

  await syncEntryMediaRelationships({
    entryId,
    content: version.content,
    featuredImageId: version.featuredImageId,
  });

  const slugsToInvalidate = new Set([currentEntry.slug, updatedEntry.slug]);
  await Promise.all([
    ...Array.from(slugsToInvalidate).map((slugToInvalidate) =>
      invalidateCmsEntryCache({
        collectionSlug: updatedEntry.collection,
        slug: slugToInvalidate,
      })
    ),
    invalidateCmsCollectionCache({ collectionSlug: updatedEntry.collection }),
    invalidateCmsCollectionCountCache({ collectionSlug: updatedEntry.collection }),
    invalidateCmsNavigationCachesForCollection({ collectionSlug: updatedEntry.collection }),
    invalidateSitemapCache(),
  ]);

  return updatedEntry;
}
