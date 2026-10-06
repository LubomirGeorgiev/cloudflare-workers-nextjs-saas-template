"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import { getDB } from "@/db";
import { cmsMediaTable, cmsEntryTable, cmsEntryMediaTable } from "@/db/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";
import type { JSONContent } from "@tiptap/core";
import { type CmsEntryRef, invalidateCmsEntries } from "@/lib/cms/cms-cache-invalidation";
import { purgeWorkersCacheAfterWrite } from "@/lib/edge/purge-workers-cache-after-write";
import { CACHE_TAGS } from "@/constants/cache-tags";
import { EDGE_HTML_ZONE_PURGE_OUTCOME } from "@/constants/edge-html-cache";
import { syncCmsEntrySearch } from "@/lib/cms/cms-search";
import {
  reportCmsCachePurge,
  selectCmsCachePurgeOutcome,
  withCmsCachePurgeReport,
} from "@/lib/cms/cms-cache-purge-report";
import {
  cmsMediaBucketKeySchema,
  cmsMediaIdSchema,
  listCmsMediaSchema,
  updateCmsMediaSchema,
} from "@/schemas/cms-media.schema";

export const listCmsMediaAction = actionClient
  .metadata({ actionName: "listCmsMediaAction" })
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
  .metadata({ actionName: "getCmsMediaDetailsAction" })
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
  updates: { alt?: string | null; title?: string | null; width?: number; height?: number }
): boolean {
  if (!content) {
    return false;
  }

  let hasChanges = false;

  // Match both full API URLs and bucket keys
  const srcPath = content.type === "image" ? content.attrs?.src as string | undefined : undefined;

  if (content.attrs && srcPath?.includes(bucketKey)) {
    hasChanges = applyImageAttributeUpdates({ attrs: content.attrs, updates });
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

function applyImageAttributeUpdates({
  attrs,
  updates,
}: {
  attrs: Record<string, unknown>;
  updates: { alt?: string | null; width?: number; height?: number };
}): boolean {
  if (updates.alt !== undefined) {
    attrs.alt = updates.alt;
    attrs.title = updates.alt; // Title typically matches alt
  }

  if (updates.width !== undefined) {
    attrs.width = updates.width;
  }

  if (updates.height !== undefined) {
    attrs.height = updates.height;
  }

  return updates.alt !== undefined || updates.width !== undefined || updates.height !== undefined;
}

export const updateCmsMediaAction = actionClient
  .metadata({ actionName: "updateCmsMediaAction" })
  .inputSchema(updateCmsMediaSchema)
  .action(({ parsedInput: input }) => withCmsCachePurgeReport(async () => {
    await requireAdmin();

    const db = getDB();
    const { mediaId, ...fields } = input;
    // An empty alt clears it, so the media row and its image nodes match media that never had one.
    const updates = { ...fields, ...(fields.alt !== undefined && { alt: fields.alt || null }) };

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

      const entriesToInvalidate: CmsEntryRef[] = [];

      for (const entry of relatedEntries) {
        const content = entry.content;
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
          collection: entry.collection,
          slug: entry.slug,
        });
      }

      // One call for every affected entry, so the action sends one Workers Caching purge.
      await invalidateCmsEntries({ entries: entriesToInvalidate });
    }

    return { success: true, media: updated };
  }));

export const getCmsMediaByBucketKeyAction = actionClient
  .metadata({ actionName: "getCmsMediaByBucketKeyAction" })
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
  .metadata({ actionName: "deleteCmsMediaAction" })
  .inputSchema(cmsMediaIdSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(() => withCmsCachePurgeReport(async () => {
      await requireAdmin();

      const db = getDB();
      const { env } = await getCloudflareContext();

      if (!env.R2_BUCKET) {
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

      // Row first: if the R2 delete then fails, the orphan sweep in `retention.ts` removes the file.
      await db
        .delete(cmsMediaTable)
        .where(eq(cmsMediaTable.id, input.mediaId));

      await env.R2_BUCKET.delete(media.bucketKey);

      // The image route and `/_next/image` tag each copy with the R2 key. Never throws. No KV tag
      // and no stored page names the file, so it skips `runCmsCacheInvalidation`.
      const workersCachePurge = await purgeWorkersCacheAfterWrite({
        tags: [CACHE_TAGS.cmsMedia(media.bucketKey)],
      });

      // The delete stands either way. `cachePurge` tells the admin that the edge copy can stay.
      reportCmsCachePurge(selectCmsCachePurgeOutcome({
        zonePurge: EDGE_HTML_ZONE_PURGE_OUTCOME.NONE,
        workersCachePurge,
      }));

      return { success: true };
    }), RATE_LIMITS.SETTINGS);
  });
