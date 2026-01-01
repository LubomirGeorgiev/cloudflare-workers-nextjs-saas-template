import "server-only";
import { getDB } from "@/db";
import { cmsEntryMediaTable, cmsMediaTable } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { CMS_IMAGES_API_ROUTE } from "@/constants";

/**
 * Extract media IDs from TipTap content
 * Parses the content JSON and finds all image nodes with our media URLs
 */
function extractMediaIdsFromContent(content: unknown): string[] {
  if (!content || typeof content !== "object") {
    return [];
  }

  const mediaIds = new Set<string>();

  function traverse(node: unknown) {
    if (!node || typeof node !== "object") return;

    const nodeObj = node as Record<string, unknown>;

    // Check if this is an image node with our media URL
    if (nodeObj.type === "image" && nodeObj.attrs && typeof nodeObj.attrs === "object") {
      const attrs = nodeObj.attrs as Record<string, unknown>;
      const src = attrs.src;

      if (typeof src === "string" && src.startsWith(CMS_IMAGES_API_ROUTE)) {
        // Extract the R2 key from the URL
        const r2Key = src.replace(`${CMS_IMAGES_API_ROUTE}/`, "");
        mediaIds.add(r2Key);
      }
    }

    // Recursively traverse content array
    if (Array.isArray(nodeObj.content)) {
      nodeObj.content.forEach(traverse);
    }
  }

  traverse(content);

  return Array.from(mediaIds);
}

/**
 * Get media IDs from R2 keys by looking them up in the database
 */
async function getMediaIdsByBucketKeys(bucketKeys: string[]): Promise<string[]> {
  if (bucketKeys.length === 0) return [];

  const db = getDB();

  const mediaRecords = await db
    .select({ id: cmsMediaTable.id })
    .from(cmsMediaTable)
    .where(inArray(cmsMediaTable.bucketKey, bucketKeys));

  return mediaRecords.map((m) => m.id);
}

/**
 * Sync media relationships for a CMS entry
 * Removes old relationships and creates new ones based on current content
 * Featured image is inserted first with position -1 to distinguish it from content images
 */
export async function syncEntryMediaRelationships({
  entryId,
  content,
  featuredImageId,
}: {
  entryId: string;
  content: unknown;
  featuredImageId?: string | null;
}): Promise<void> {
  const db = getDB();

  // Extract bucket keys from content
  const bucketKeys = extractMediaIdsFromContent(content);

  // Get actual media IDs from the database
  const contentMediaIds = await getMediaIdsByBucketKeys(bucketKeys);

  // Delete existing relationships for this entry
  await db
    .delete(cmsEntryMediaTable)
    .where(eq(cmsEntryMediaTable.entryId, entryId));

  // Prepare relationships array
  const relationships: Array<{
    entryId: string;
    mediaId: string;
    position: number;
  }> = [];

  // Track which media IDs we've already added to avoid duplicates
  const addedMediaIds = new Set<string>();

  // Insert featured image FIRST with position -1
  if (featuredImageId) {
    relationships.push({
      entryId,
      mediaId: featuredImageId,
      position: -1,
    });
    addedMediaIds.add(featuredImageId);
  }

  // Then add content images with positions starting at 0
  // Skip media IDs that were already added (e.g., if featured image is also in content)
  contentMediaIds.forEach((mediaId, index) => {
    if (!addedMediaIds.has(mediaId)) {
      relationships.push({
        entryId,
        mediaId,
        position: index,
      });
      addedMediaIds.add(mediaId);
    }
  });

  // Create new relationships
  if (relationships.length > 0) {
    await db.insert(cmsEntryMediaTable).values(relationships);
  }
}
