"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import { getDB } from "@/db";
import { cmsMediaTable, cmsEntryTable, cmsEntryMediaTable } from "@/db/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import type { JSONContent } from "@tiptap/core";
import type { CollectionsUnion } from "@/../cms.config";
import { invalidateEntryAndCollection } from "@/lib/cms/cms-cache-invalidation";
import { syncCmsEntrySearch } from "@/lib/cms/cms-search";
import {
  cmsMediaBucketKeySchema,
  cmsMediaIdSchema,
  listCmsMediaSchema,
  updateCmsMediaSchema,
} from "@/schemas/cms-media.schema";

export const listCmsMediaAction = actionClient
  .inputSchema(listCmsMediaSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();
    const { page, limit } = input;
    const offset = (page - 1) * limit;

    const [media, [{ count }]] = await Promise.all([
      db
        .select({
          id: cmsMediaTable.id,
          fileName: cmsMediaTable.fileName,
          mimeType: cmsMediaTable.mimeType,
          sizeInBytes: cmsMediaTable.sizeInBytes,
          bucketKey: cmsMediaTable.bucketKey,
          width: cmsMediaTable.width,
          height: cmsMediaTable.height,
          alt: cmsMediaTable.alt,
          uploadedBy: cmsMediaTable.uploadedBy,
          createdAt: cmsMediaTable.createdAt,
          updatedAt: cmsMediaTable.updatedAt,
        })
        .from(cmsMediaTable)
        .orderBy(desc(cmsMediaTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(cmsMediaTable),
    ]);

    const usageRows = media.length === 0
      ? []
      : await db
        .select({
          mediaId: cmsEntryMediaTable.mediaId,
          usageCount: sql<number>`count(distinct ${cmsEntryMediaTable.entryId})`,
        })
        .from(cmsEntryMediaTable)
        .where(inArray(cmsEntryMediaTable.mediaId, media.map((item) => item.id)))
        .groupBy(cmsEntryMediaTable.mediaId);
    const usageByMediaId = new Map(
      usageRows.map((row) => [row.mediaId, Number(row.usageCount)]),
    );
    const mediaWithUsage = media.map((item) => ({
      ...item,
      usageCount: usageByMediaId.get(item.id) ?? 0,
    }));

    return {
      media: mediaWithUsage,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    };
  });

export const getCmsMediaDetailsAction = actionClient
  .inputSchema(cmsMediaIdSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();

    const [media] = await db
      .select()
      .from(cmsMediaTable)
      .where(eq(cmsMediaTable.id, input.mediaId));

    if (!media) {
      throw new ActionError("NOT_FOUND", "Media not found");
    }

    const relatedEntries = await db
      .select({
        id: cmsEntryTable.id,
        title: cmsEntryTable.title,
        slug: cmsEntryTable.slug,
        collection: cmsEntryTable.collection,
        status: cmsEntryTable.status,
        createdAt: cmsEntryTable.createdAt,
      })
      .from(cmsEntryMediaTable)
      .innerJoin(cmsEntryTable, eq(cmsEntryMediaTable.entryId, cmsEntryTable.id))
      .where(eq(cmsEntryMediaTable.mediaId, input.mediaId))
      .orderBy(desc(cmsEntryTable.createdAt));

    return {
      media,
      relatedEntries,
    };
  });

function updateImageNodesInContent(
  content: JSONContent,
  bucketKey: string,
  updates: { alt?: string; title?: string; width?: number; height?: number }
): boolean {
  if (!content) return false;

  let hasChanges = false;

  // If this is an image node with matching src
  if (content.type === "image" && content.attrs?.src) {
    // Match both full API URLs and bucket keys
    const srcPath = content.attrs.src as string;
    const isMatch = srcPath.includes(bucketKey) || srcPath === bucketKey;

    if (isMatch) {
      if (updates.alt !== undefined) {
        content.attrs.alt = updates.alt;
        content.attrs.title = updates.alt; // Title typically matches alt
        hasChanges = true;
      }

      if (updates.width !== undefined) {
        content.attrs.width = updates.width;
        hasChanges = true;
      }

      if (updates.height !== undefined) {
        content.attrs.height = updates.height;
        hasChanges = true;
      }
    }
  }

  if (Array.isArray(content.content)) {
    for (const child of content.content) {
      if (updateImageNodesInContent(child, bucketKey, updates)) {
        hasChanges = true;
      }
    }
  }

  return hasChanges;
}

export const updateCmsMediaAction = actionClient
  .inputSchema(updateCmsMediaSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();
    const { mediaId, ...updates } = input;

    const [media] = await db
      .select()
      .from(cmsMediaTable)
      .where(eq(cmsMediaTable.id, mediaId));

    if (!media) {
      throw new ActionError("NOT_FOUND", "Media not found");
    }

    const [updated] = await db
      .update(cmsMediaTable)
      .set(updates)
      .where(eq(cmsMediaTable.id, mediaId))
      .returning();

    // If alt text or dimensions were updated, also update all related entries
    if (updates.alt !== undefined || updates.width !== undefined || updates.height !== undefined) {
      const relatedEntries = await db
        .select({
          id: cmsEntryTable.id,
          slug: cmsEntryTable.slug,
          collection: cmsEntryTable.collection,
          title: cmsEntryTable.title,
          seoDescription: cmsEntryTable.seoDescription,
          content: cmsEntryTable.content,
        })
        .from(cmsEntryMediaTable)
        .innerJoin(cmsEntryTable, eq(cmsEntryMediaTable.entryId, cmsEntryTable.id))
        .where(eq(cmsEntryMediaTable.mediaId, mediaId));

      const entriesToInvalidate: Array<{ collectionSlug: CollectionsUnion; slug: string }> = [];

      for (const entry of relatedEntries) {
        const content = entry.content as JSONContent;
        const imageUpdates = {
          alt: updates.alt,
          title: updates.alt, // Title typically matches alt
          width: updates.width,
          height: updates.height,
        };

        const hasChanges = updateImageNodesInContent(content, media.bucketKey, imageUpdates);

        // Save the updated content if changes were made
        if (hasChanges) {
          await db
            .update(cmsEntryTable)
            .set({ content })
            .where(eq(cmsEntryTable.id, entry.id));
          await syncCmsEntrySearch({
            entryId: entry.id,
            collection: entry.collection,
            slug: entry.slug,
            title: entry.title,
            seoDescription: entry.seoDescription,
            content,
          });
        }

        entriesToInvalidate.push({
          collectionSlug: entry.collection,
          slug: entry.slug,
        });
      }

      // Invalidate caches for all affected entries and collections
      if (entriesToInvalidate.length > 0) {
        const invalidationPromises: Promise<void>[] = [];

        for (const entry of entriesToInvalidate) {
          invalidationPromises.push(
            invalidateEntryAndCollection({
              collectionSlug: entry.collectionSlug,
              slug: entry.slug,
            })
          );
        }

        await Promise.all(invalidationPromises);
      }
    }

    return { success: true, media: updated };
  });

export const getCmsMediaByBucketKeyAction = actionClient
  .inputSchema(cmsMediaBucketKeySchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();

    const media = await db
      .select({
        id: cmsMediaTable.id,
        fileName: cmsMediaTable.fileName,
        bucketKey: cmsMediaTable.bucketKey,
        alt: cmsMediaTable.alt,
        width: cmsMediaTable.width,
        height: cmsMediaTable.height,
      })
      .from(cmsMediaTable)
      .where(eq(cmsMediaTable.bucketKey, input.bucketKey));

    return media;
  });

export const deleteCmsMediaAction = actionClient
  .inputSchema(cmsMediaIdSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      await requireAdmin();

      const db = getDB();
      const { env } = await getCloudflareContext();

      if (!env.NEXT_INC_CACHE_R2_BUCKET) {
        throw new ActionError("INTERNAL_SERVER_ERROR", "R2 bucket not configured");
      }

      const [media] = await db
        .select()
        .from(cmsMediaTable)
        .where(eq(cmsMediaTable.id, input.mediaId));

      if (!media) {
        throw new ActionError("NOT_FOUND", "Media not found");
      }

      // This now includes both content images and featured images (position -1)
      const [usage] = await db
        .select({ count: sql<number>`count(*)` })
        .from(cmsEntryMediaTable)
        .where(eq(cmsEntryMediaTable.mediaId, input.mediaId));

      if (usage.count > 0) {
        throw new ActionError(
          "CONFLICT",
          `Cannot delete media: it is used in ${usage.count} entry/entries`
        );
      }

      // Delete from R2
      await env.NEXT_INC_CACHE_R2_BUCKET.delete(media.bucketKey);

      // Delete from database
      await db
        .delete(cmsMediaTable)
        .where(eq(cmsMediaTable.id, input.mediaId));

      return { success: true };
    }, RATE_LIMITS.SETTINGS);
  });
