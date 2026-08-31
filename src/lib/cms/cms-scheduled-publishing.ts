import "server-only";

import { and, eq, lte } from "drizzle-orm";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, type CmsEntry } from "@/db/schema";
import { finalizePublishedEntry } from "@/lib/cms/entry/publishing";

/**
 * The queue timer's entry point. It owns only the due check; what publishing an entry means lives
 * in `@/lib/cms/entry/publishing`, which the editor and the internal admin API call as well.
 *
 * No version row is written here: the editor already recorded one when it moved the entry to
 * `scheduled`, and this path completes that recorded decision rather than making a new one.
 */
export async function publishScheduledCmsEntryIfDue({
  entryId,
  now = new Date(),
}: {
  entryId: string;
  now?: Date;
}): Promise<CmsEntry | null> {
  const db = getDB();
  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set({ status: CMS_ENTRY_STATUS.PUBLISHED })
    .where(and(
      eq(cmsEntryTable.id, entryId),
      eq(cmsEntryTable.status, CMS_ENTRY_STATUS.SCHEDULED),
      lte(cmsEntryTable.publishedAt, now),
    ))
    .returning();

  if (!updatedEntry) {
    return null;
  }

  await finalizePublishedEntry(updatedEntry);

  return updatedEntry;
}
