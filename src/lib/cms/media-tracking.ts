import "server-only";
import { getDB } from "@/db";
import { cmsEntryMediaTable, cmsMediaTable } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { CMS_IMAGES_API_ROUTE } from "@/constants";

/**
 * Extract media IDs from TipTap content
 * Parses the content JSON and finds all image nodes with our media URLs
 */
export function extractMediaIdsFromContent(content: unknown): string[] {
  if (!content || typeof content !== "object") {
    return [];
  }

  const mediaIds = new Set<string>();

  function traverse(node: any) {
    if (!node || typeof node !== "object") return;

    // Check if this is an image node with our media URL
    if (node.type === "image" && node.attrs?.src) {
      const src = node.attrs.src as string;

      // Check if it's one of our media URLs (e.g., /api/cms-images/cms-images/...)
      if (src.startsWith(CMS_IMAGES_API_ROUTE)) {
        // Extract the R2 key from the URL
        const r2Key = src.replace(`${CMS_IMAGES_API_ROUTE}/`, "");
        mediaIds.add(r2Key);
      }
    }

    // Recursively traverse content array
    if (Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }

  traverse(content);

  return Array.from(mediaIds);
}

/**
 * Get media IDs from R2 keys by looking them up in the database
 */
export async function getMediaIdsByBucketKeys(bucketKeys: string[]): Promise<string[]> {
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
 */
export async function syncEntryMediaRelationships({
  entryId,
  content,
}: {
  entryId: string;
  content: unknown;
}): Promise<void> {
  const db = getDB();

  // Extract bucket keys from content
  const bucketKeys = extractMediaIdsFromContent(content);

  // Get actual media IDs from the database
  const mediaIds = await getMediaIdsByBucketKeys(bucketKeys);

  // Delete existing relationships for this entry
  await db
    .delete(cmsEntryMediaTable)
    .where(eq(cmsEntryMediaTable.entryId, entryId));

  // Create new relationships
  if (mediaIds.length > 0) {
    await db.insert(cmsEntryMediaTable).values(
      mediaIds.map((mediaId, index) => ({
        entryId,
        mediaId,
        position: index,
      }))
    );
  }
}
