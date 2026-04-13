"use server";

import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import { getDB } from "@/db";
import { cmsMediaTable, cmsEntryTable, cmsEntryMediaTable } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import type { JSONContent } from "@tiptap/core";
import type { CollectionsUnion } from "@/../cms.config";
import { invalidateCmsEntryCache, invalidateCmsCollectionCache } from "@/lib/cms/cms-repository";

/**
 * List all media files with pagination and entry relationships
 */
export const listCmsMediaAction = actionClient
  .inputSchema(z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(20),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();
    const { page, limit } = input;
    const offset = (page - 1) * limit;

    // Get media with usage count
    const mediaWithUsage = await db
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
        usageCount: sql<number>`count(distinct ${cmsEntryMediaTable.entryId})`.as('usage_count'),
      })
      .from(cmsMediaTable)
      .leftJoin(cmsEntryMediaTable, eq(cmsMediaTable.id, cmsEntryMediaTable.mediaId))
      .groupBy(cmsMediaTable.id)
      .orderBy(desc(cmsMediaTable.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(cmsMediaTable);

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

/**
 * Get media details with all related entries
 */
export const getCmsMediaDetailsAction = actionClient
  .inputSchema(z.object({
    mediaId: z.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();

    // Get media record
    const [media] = await db
      .select()
      .from(cmsMediaTable)
      .where(eq(cmsMediaTable.id, input.mediaId));

    if (!media) {
      throw new ActionError("NOT_FOUND", "Media not found");
    }

    // Get all entries using this media
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

/**
 * Recursively update image nodes in Tiptap JSON content
 */
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
      // Update the alt and title attributes
      if (updates.alt !== undefined) {
        content.attrs.alt = updates.alt;
        content.attrs.title = updates.alt; // Title typically matches alt
        hasChanges = true;
      }

      // Update dimensions if provided
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

  // Recursively process content array
  if (Array.isArray(content.content)) {
    for (const child of content.content) {
      if (updateImageNodesInContent(child, bucketKey, updates)) {
        hasChanges = true;
      }
    }
  }

  return hasChanges;
}

/**
 * Update media metadata (alt text, dimensions, etc.)
 * Also updates the content JSON in all related cms_entry records
 */
export const updateCmsMediaAction = actionClient
  .inputSchema(z.object({
    mediaId: z.string(),
    alt: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();
    const { mediaId, ...updates } = input;

    // Get the media record to find its bucket key
    const [media] = await db
      .select()
      .from(cmsMediaTable)
      .where(eq(cmsMediaTable.id, mediaId));

    if (!media) {
      throw new ActionError("NOT_FOUND", "Media not found");
    }

    // Update the media record
    const [updated] = await db
      .update(cmsMediaTable)
      .set(updates)
      .where(eq(cmsMediaTable.id, mediaId))
      .returning();

    // If alt text or dimensions were updated, also update all related entries
    if (updates.alt !== undefined || updates.width !== undefined || updates.height !== undefined) {
      // Get all entries that use this media
      const relatedEntries = await db
        .select({
          id: cmsEntryTable.id,
          slug: cmsEntryTable.slug,
          collection: cmsEntryTable.collection,
          content: cmsEntryTable.content,
        })
        .from(cmsEntryMediaTable)
        .innerJoin(cmsEntryTable, eq(cmsEntryMediaTable.entryId, cmsEntryTable.id))
        .where(eq(cmsEntryMediaTable.mediaId, mediaId));

      const affectedCollections = new Set<CollectionsUnion>();
      const entriesToInvalidate: Array<{ collectionSlug: CollectionsUnion; slug: string }> = [];

      // Update each entry's content
      for (const entry of relatedEntries) {
        const content = entry.content as JSONContent;
        const imageUpdates = {
          alt: updates.alt,
          title: updates.alt, // Title typically matches alt
          width: updates.width,
          height: updates.height,
        };

        // Update the content JSON
        const hasChanges = updateImageNodesInContent(content, media.bucketKey, imageUpdates);

        // Save the updated content if changes were made
        if (hasChanges) {
          await db
            .update(cmsEntryTable)
            .set({ content })
            .where(eq(cmsEntryTable.id, entry.id));

          // Track entries and collections that need cache invalidation
          affectedCollections.add(entry.collection);
          entriesToInvalidate.push({
            collectionSlug: entry.collection,
            slug: entry.slug,
          });
        }
      }

      // Invalidate caches for all affected entries and collections
      if (entriesToInvalidate.length > 0) {
        const invalidationPromises: Promise<void>[] = [];

        // Invalidate entry-specific caches
        for (const entry of entriesToInvalidate) {
          invalidationPromises.push(
            invalidateCmsEntryCache({
              collectionSlug: entry.collectionSlug,
              slug: entry.slug,
            })
          );
        }

        // Invalidate collection caches
        for (const collection of affectedCollections) {
          invalidationPromises.push(
            invalidateCmsCollectionCache({ collectionSlug: collection })
          );
        }

        await Promise.all(invalidationPromises);
      }
    }

    return { success: true, media: updated };
  });

/**
 * Get media by bucket key (used for featured image selection)
 */
export const getCmsMediaByBucketKeyAction = actionClient
  .inputSchema(z.object({
    bucketKey: z.string(),
  }))
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

/**
 * Delete media file from both R2 and database
 */
export const deleteCmsMediaAction = actionClient
  .inputSchema(z.object({
    mediaId: z.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      await requireAdmin();

      const db = getDB();
      const { env } = getCloudflareContext();

      if (!env.NEXT_INC_CACHE_R2_BUCKET) {
        throw new ActionError("INTERNAL_SERVER_ERROR", "R2 bucket not configured");
      }

      // Get media record
      const [media] = await db
        .select()
        .from(cmsMediaTable)
        .where(eq(cmsMediaTable.id, input.mediaId));

      if (!media) {
        throw new ActionError("NOT_FOUND", "Media not found");
      }

      // Check if media is in use (in cms_entry_media junction table)
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
