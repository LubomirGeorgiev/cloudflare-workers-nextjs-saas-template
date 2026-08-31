import "server-only";

import type { JSONContent } from "@tiptap/core";
import { eq } from "drizzle-orm";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, cmsEntryVersionTable, type CmsEntry } from "@/db/schema";
import {
  getKnownCmsCollectionSlug,
  invalidateEntryAndCollection,
} from "@/lib/cms/cms-cache-invalidation";
import { purgeCmsEntryMarkdownPages } from "@/lib/cms/cms-entry-page-purge";
import { syncCmsEntrySearch } from "@/lib/cms/cms-search";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";
import { deleteScheduledJobs, scheduleJob } from "@/lib/scheduler/scheduler";
import { getCloudflareContext } from "@/utils/cloudflare-context";

/**
 * Publish state of a CMS entry: its timer, the history row every status change leaves behind, and
 * the effects a row going live must have. Kept out of `mutations.ts` because reaching that module
 * drags the editor extension tree into the Worker API bundle and the OpenAPI generator's graph.
 */

/** The columns `cms_entry_version` stores. Callers resolve every value before they snapshot. */
type CmsEntryVersionSnapshot = Pick<
  CmsEntry,
  "title" | "content" | "fields" | "slug" | "seoDescription" | "status" | "featuredImageId"
>;

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

/**
 * Appends one `cms_entry_version` row for a change already written to `cms_entry`. Every writer
 * comes through here, so history reads the same whether the editor or the admin API made the change.
 */
export async function recordCmsEntryVersion({
  existingEntry,
  snapshot,
}: {
  existingEntry: CmsEntry;
  snapshot: CmsEntryVersionSnapshot;
}): Promise<void> {
  const db = getDB();

  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: existingEntry.id },
    orderBy: { versionNumber: "desc" },
  });

  // Version 1 snapshots the pre-change state because entry creation skips duplicate history.
  if (!latestVersion) {
    await db.insert(cmsEntryVersionTable).values({
      entryId: existingEntry.id,
      versionNumber: 1,
      title: existingEntry.title,
      content: existingEntry.content as JSONContent,
      fields: existingEntry.fields,
      slug: existingEntry.slug,
      seoDescription: existingEntry.seoDescription,
      status: existingEntry.status,
      featuredImageId: existingEntry.featuredImageId,
      createdBy: existingEntry.createdBy,
    });
  }

  await db.insert(cmsEntryVersionTable).values({
    entryId: existingEntry.id,
    versionNumber: (latestVersion?.versionNumber ?? 1) + 1,
    title: snapshot.title,
    content: snapshot.content,
    fields: snapshot.fields,
    slug: snapshot.slug,
    seoDescription: snapshot.seoDescription,
    status: snapshot.status,
    featuredImageId: snapshot.featuredImageId,
    createdBy: existingEntry.createdBy, // Schema tracks the original author for version rows.
  });
}

/**
 * Everything that must follow a row going to `published` from outside an App Router request scope:
 * reindex it, drop the cached collection and entry reads, and purge the `.md` twin.
 *
 * Shared by the timer path and the internal admin API, which has no request scope either —
 * `revalidateCmsEntryPaths` is out of reach for both, and without the KV delete a publish keeps
 * serving the pre-publish Markdown.
 */
export async function finalizePublishedEntry(entry: CmsEntry): Promise<void> {
  await syncCmsEntrySearch({
    entryId: entry.id,
    collection: entry.collection,
    slug: entry.slug,
    title: entry.title,
    seoDescription: entry.seoDescription,
    content: entry.content as JSONContent,
  });

  const collectionSlug = getKnownCmsCollectionSlug(entry.collection);

  await invalidateEntryAndCollection({ collectionSlug, slug: entry.slug });

  await purgeCmsEntryMarkdownPages({
    entries: [{ collection: collectionSlug, slug: entry.slug }],
  });
}

/**
 * Publish an entry immediately, whatever status it currently holds. `publishedAt` is stamped only
 * when the entry has none, so re-publishing an archived entry keeps its original date.
 *
 * Returns null when no such entry exists, so the caller decides the refusal.
 */
export async function publishCmsEntryNow({
  entryId,
  now = new Date(),
}: {
  entryId: string;
  now?: Date;
}): Promise<CmsEntry | null> {
  const db = getDB();
  const existingEntry = await db.query.cmsEntryTable.findFirst({ where: { id: entryId } });

  if (!existingEntry) {
    return null;
  }

  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set({
      status: CMS_ENTRY_STATUS.PUBLISHED,
      ...(existingEntry.publishedAt ? {} : { publishedAt: now }),
    })
    .where(eq(cmsEntryTable.id, entryId))
    .returning();

  if (!updatedEntry) {
    return null;
  }

  // A retry of an already published entry changes nothing, so it leaves no history row either.
  if (existingEntry.status !== CMS_ENTRY_STATUS.PUBLISHED) {
    await recordCmsEntryVersion({
      existingEntry,
      snapshot: {
        title: existingEntry.title,
        content: existingEntry.content,
        fields: existingEntry.fields,
        slug: existingEntry.slug,
        seoDescription: existingEntry.seoDescription,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        featuredImageId: existingEntry.featuredImageId,
      },
    });
  }

  // A scheduled entry that is published by hand must not also fire its timer later.
  await deleteCmsPublishSchedule(entryId);
  await finalizePublishedEntry(updatedEntry);

  return updatedEntry;
}
