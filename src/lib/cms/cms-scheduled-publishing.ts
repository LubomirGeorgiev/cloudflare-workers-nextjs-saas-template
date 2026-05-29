import "server-only";

import type { JSONContent } from "@tiptap/core";
import { and, eq, lte } from "drizzle-orm";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, type CmsEntry } from "@/db/schema";
import {
  invalidateEntryAndCollection,
  getKnownCmsCollectionSlug,
} from "@/lib/cms/cms-cache-invalidation";
import { syncCmsEntrySearch } from "@/lib/cms/cms-search";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";
import { deleteScheduledJobs, scheduleJob } from "@/lib/scheduler/scheduler";
import { getCloudflareContext } from "@/utils/cloudflare-context";

function getCmsPublishJobDedupeKey(entryId: string): string {
  return `cms-entry:${entryId}`;
}

export async function deleteCmsPublishSchedule(entryId: string): Promise<void> {
  await deleteScheduledJobs({
    type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
    dedupeKey: getCmsPublishJobDedupeKey(entryId),
  });
}

export async function syncCmsPublishSchedule(
  entry: Pick<CmsEntry, "id" | "status" | "publishedAt">
): Promise<void> {
  const { env } = await getCloudflareContext();
  const queue = env.SCHEDULER_QUEUE;

  if (entry.status !== CMS_ENTRY_STATUS.SCHEDULED || !entry.publishedAt) {
    await deleteCmsPublishSchedule(entry.id);
    return;
  }

  await scheduleJob({
    queue,
    type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
    dedupeKey: getCmsPublishJobDedupeKey(entry.id),
    payload: { entryId: entry.id },
    runAt: entry.publishedAt,
  });
}

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

  await syncCmsEntrySearch({
    entryId: updatedEntry.id,
    collection: updatedEntry.collection,
    slug: updatedEntry.slug,
    title: updatedEntry.title,
    seoDescription: updatedEntry.seoDescription,
    content: updatedEntry.content as JSONContent,
  });

  await invalidateEntryAndCollection({
    collectionSlug: getKnownCmsCollectionSlug(updatedEntry.collection),
    slug: updatedEntry.slug,
  });

  return updatedEntry;
}
