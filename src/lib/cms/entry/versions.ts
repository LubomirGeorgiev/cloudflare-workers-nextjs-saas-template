import "server-only";

import { cache } from "react";
import { and, count, eq, sql } from "drizzle-orm";
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
import { getPublishStateChange } from "@/lib/cms/cms-invalidation-scopes";
import { syncCmsEntrySearch } from "@/lib/cms/cms-search";
import { syncCmsPublishSchedule } from "@/lib/cms/entry/publishing";
import {
  assertCmsSlugAvailable,
  cmsGroupSlugRenameQuery,
  syncCmsGroupSearch,
} from "@/lib/cms/entry/slug-group";
import { recordCmsEntryVersion } from "@/lib/cms/entry/version-history";
import {
  deleteCmsEntryVersionParamsSchema,
  getCmsEntryVersionsParamsSchema,
  revertCmsEntryToVersionParamsSchema,
} from "@/lib/cms/entry/schemas";
import { syncEntryMediaRelationships } from "@/lib/cms/media-tracking";
import { v } from "@/lib/validation";
import type { CmsEntryStatus } from "@/types/cms";

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

  await getEntryVersionOrThrow({ entryId, versionId });

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
): Promise<RevertedCmsEntry> {
  const validated = v.parse(revertCmsEntryToVersionParamsSchema, params);
  const { entryId, versionId } = validated;

  const db = getDB();

  const version = await getEntryVersionOrThrow({ entryId, versionId });

  const currentEntry = await db.query.cmsEntryTable.findFirst({
    where: { id: entryId },
  });

  if (!currentEntry) {
    throw new Error(`Entry "${entryId}" not found`);
  }

  const isSlugChanging = version.slug !== currentEntry.slug;

  if (isSlugChanging) {
    await assertCmsSlugAvailable({ collection: currentEntry.collection, slug: version.slug });
  }

  const publishState = resolveRevertedPublishState({
    status: version.status,
    versionPublishedAt: version.publishedAt,
    currentPublishedAt: currentEntry.publishedAt,
    now: new Date(),
  });
  const entryUpdate = db
    .update(cmsEntryTable)
    .set({
      title: version.title,
      content: version.content,
      fields: version.fields,
      slug: version.slug,
      seoDescription: version.seoDescription,
      status: publishState.status,
      publishedAt: publishState.publishedAt,
      featuredImageId: version.featuredImageId,
    })
    .where(eq(cmsEntryTable.id, entryId))
    .returning();

  // D1 has no transactions: one batch, so the restored row and its locale siblings move together.
  const [[updatedEntry]] = isSlugChanging
    ? await db.batch([
      entryUpdate,
      cmsGroupSlugRenameQuery({
        collection: currentEntry.collection,
        fromSlug: currentEntry.slug,
        toSlug: version.slug,
      }),
    ])
    : [await entryUpdate];

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
      status: publishState.status,
      publishedAt: updatedEntry.publishedAt,
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
  await syncRevertedEntrySearch({ entry: updatedEntry, isSlugChanging });

  // A revert republishes a body, so it goes through the one pipeline every other writer uses; a
  // hand-rolled tag list here would miss the stored HTML page and the search index.
  await invalidateEntryAndCollection({
    collectionSlug: updatedEntry.collection,
    slug: updatedEntry.slug,
    alsoPurgeSlugs: [currentEntry.slug],
    warm: updatedEntry.status === CMS_ENTRY_STATUS.PUBLISHED,
    publishStateChange: getPublishStateChange({
      statusBefore: currentEntry.status,
      statusAfter: updatedEntry.status,
    }),
  });

  // A restored `scheduled` status needs its publish job, and any other status must drop one.
  await syncCmsPublishSchedule(updatedEntry);

  return { ...updatedEntry, scheduleCleared: publishState.scheduleCleared };
}

/**
 * The status and date a restore writes. The publish job runs at `publishedAt`, so a scheduled
 * restore takes the version's own date; a past one goes live through the scheduler's late path.
 *
 * A version saved before history kept dates has none. Any other date could publish at once, so a
 * scheduled restore becomes a draft, and `scheduleCleared` tells the admin to schedule it again.
 * A published row never takes a future date: the page is live now.
 */
export function resolveRevertedPublishState({
  status,
  versionPublishedAt,
  currentPublishedAt,
  now,
}: {
  status: CmsEntryStatus;
  versionPublishedAt: Date | null;
  currentPublishedAt: Date | null;
  now: Date;
}): RevertedPublishState {
  if (status === CMS_ENTRY_STATUS.SCHEDULED) {
    return versionPublishedAt
      ? { status, publishedAt: versionPublishedAt, scheduleCleared: false }
      : { status: CMS_ENTRY_STATUS.DRAFT, publishedAt: currentPublishedAt, scheduleCleared: true };
  }

  const restoredPublishedAt = versionPublishedAt ?? currentPublishedAt;

  if (status === CMS_ENTRY_STATUS.PUBLISHED) {
    const publishedAt = restoredPublishedAt && restoredPublishedAt <= now ? restoredPublishedAt : now;

    return { status, publishedAt, scheduleCleared: false };
  }

  return { status, publishedAt: restoredPublishedAt, scheduleCleared: false };
}

async function getEntryVersionOrThrow({
  entryId,
  versionId,
}: {
  entryId: string;
  versionId: string;
}): Promise<CmsEntryVersion> {
  const version = await getDB().query.cmsEntryVersionTable.findFirst({
    where: {
      id: versionId,
      entryId,
    },
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found for entry "${entryId}"`);
  }

  return version;
}

// A slug change moved every locale row, and the index stores the slug, so all rows re-index.
async function syncRevertedEntrySearch({
  entry,
  isSlugChanging,
}: {
  entry: CmsEntry;
  isSlugChanging: boolean;
}): Promise<void> {
  if (isSlugChanging) {
    await syncCmsGroupSearch({ collection: entry.collection, slug: entry.slug });
    return;
  }

  await syncCmsEntrySearch({
    entryId: entry.id,
    collection: entry.collection,
    slug: entry.slug,
    title: entry.title,
    seoDescription: entry.seoDescription,
    content: entry.content,
  });
}

interface RevertedPublishState {
  status: CmsEntryStatus;
  publishedAt: Date | null;
  // The version was scheduled but had no date, so the restore saved a draft instead.
  scheduleCleared: boolean;
}

interface RevertedCmsEntry extends CmsEntry {
  scheduleCleared: boolean;
}
