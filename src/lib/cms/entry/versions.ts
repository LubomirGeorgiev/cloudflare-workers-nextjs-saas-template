import "server-only";

import { cache } from "react";
import { and, count, eq, sql } from "drizzle-orm";
import type { JSONContent } from "@tiptap/core";
import type { InferOutput } from "valibot";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import {
  cmsEntryTable,
  cmsEntryVersionTable,
  type CmsEntry,
  type CmsEntryVersion,
} from "@/db/schema";
import { invalidateEntryAndCollection } from "@/lib/cms/cms-cache-invalidation";
import { syncCmsEntrySearch } from "@/lib/cms/cms-search";
import { recordCmsEntryVersion } from "@/lib/cms/entry/version-history";
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
    where: { entryId: validated },
    orderBy: { versionNumber: "desc" },
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
    where: {
      id: versionId,
      entryId,
    },
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found for entry "${entryId}"`);
  }

  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: entryId },
    orderBy: { versionNumber: "desc" },
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
    where: {
      id: versionId,
      entryId,
    },
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found for entry "${entryId}"`);
  }

  const currentEntry = await db.query.cmsEntryTable.findFirst({
    where: { id: entryId },
  });

  if (!currentEntry) {
    throw new Error(`Entry "${entryId}" not found`);
  }

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

  // A revert appends a new linear history point instead of rewriting old rows, so it goes through
  // the shared writer and is capped like any other save. History follows the entry write: a failed
  // update must not prune rows for a revert that never happened.
  await recordCmsEntryVersion({
    existingEntry: currentEntry,
    snapshot: {
      title: version.title,
      content: version.content,
      fields: version.fields,
      slug: version.slug,
      seoDescription: version.seoDescription,
      status: version.status,
      featuredImageId: version.featuredImageId,
    },
    createdBy: version.createdBy, // Or the current user if we had that context here
  });

  await syncEntryMediaRelationships({
    entryId,
    content: version.content,
    featuredImageId: version.featuredImageId,
  });

  // A revert rewrites the searchable columns, so the index follows the same order `updateCmsEntry`
  // uses: sync before the cache invalidation, and let a failure abort the write like any other.
  await syncCmsEntrySearch({
    entryId: updatedEntry.id,
    collection: updatedEntry.collection,
    slug: updatedEntry.slug,
    title: updatedEntry.title,
    seoDescription: updatedEntry.seoDescription,
    content: updatedEntry.content as JSONContent,
  });

  // A revert republishes a body, so it goes through the one pipeline every other writer uses; a
  // hand-rolled tag list here would miss the stored HTML page and the search index.
  await invalidateEntryAndCollection({
    collectionSlug: updatedEntry.collection,
    slug: updatedEntry.slug,
    alsoPurgeSlugs: [currentEntry.slug],
    warm: updatedEntry.status === CMS_ENTRY_STATUS.PUBLISHED,
  });

  return updatedEntry;
}
