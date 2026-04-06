"use server";

import { z } from "zod";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import { getDB } from "@/db";
import { cmsMediaTable } from "@/db/schema";
import { desc, like, or } from "drizzle-orm";

/**
 * List CMS media files for content creators (non-admin version)
 * Used in the TipTap editor media picker
 */
export const listCmsMediaForPickerAction = actionClient
  .inputSchema(z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(50).default(20),
    search: z.string().optional(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const db = getDB();
    const { page, limit, search } = input;
    const offset = (page - 1) * limit;

    // Build query with optional search filter
    let query = db
      .select({
        id: cmsMediaTable.id,
        fileName: cmsMediaTable.fileName,
        mimeType: cmsMediaTable.mimeType,
        sizeInBytes: cmsMediaTable.sizeInBytes,
        bucketKey: cmsMediaTable.bucketKey,
        width: cmsMediaTable.width,
        height: cmsMediaTable.height,
        alt: cmsMediaTable.alt,
        createdAt: cmsMediaTable.createdAt,
      })
      .from(cmsMediaTable);

    // Add search filter if provided
    if (search && search.trim()) {
      query = query.where(
        or(
          like(cmsMediaTable.fileName, `%${search}%`),
          like(cmsMediaTable.alt, `%${search}%`)
        )
      ) as typeof query;
    }

    const media = await query
      .orderBy(desc(cmsMediaTable.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      media,
      page,
      limit,
    };
  });
