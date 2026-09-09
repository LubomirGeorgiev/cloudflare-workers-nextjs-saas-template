import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";

import { CMS_ENTRY_VERSION_HISTORY_LIMIT } from "@/constants";
import { getDB } from "@/db";
import { cmsEntryVersionTable, type CmsEntry } from "@/db/schema";

// Its own module, and deliberately a thin one: `publishing.ts` and `versions.ts` both append
// history, and reaching either of them from the other would pull that one's whole graph — the
// Cloudflare context on one side, the cache and search pipeline on the other — into a bundle that
// has no use for it.

/** The columns `cms_entry_version` stores. Callers resolve every value before they snapshot. */
type CmsEntryVersionSnapshot = Pick<
  CmsEntry,
  "title" | "content" | "fields" | "slug" | "seoDescription" | "status" | "featuredImageId"
>;

/** One `cms_entry_version` row, so the column list is written once for both rows a save can add. */
function versionRow({
  entryId,
  versionNumber,
  snapshot,
  createdBy,
}: {
  entryId: string;
  versionNumber: number;
  snapshot: CmsEntryVersionSnapshot;
  createdBy: string;
}) {
  return {
    entryId,
    versionNumber,
    title: snapshot.title,
    content: snapshot.content,
    fields: snapshot.fields,
    slug: snapshot.slug,
    seoDescription: snapshot.seoDescription,
    status: snapshot.status,
    featuredImageId: snapshot.featuredImageId,
    createdBy,
  };
}

/**
 * Drops the oldest history rows once an entry holds more than `CMS_ENTRY_VERSION_HISTORY_LIMIT`.
 *
 * A version row carries a full copy of the entry body, so history is unbounded growth priced per
 * save rather than per entry. Deleting by a version-number floor keeps it to one SELECT and one
 * DELETE, whatever the backlog — no `IN (...)` list that grows with it.
 *
 * Version numbers only ever increase, and the manual delete path is the only thing that renumbers,
 * so the floor cannot strand a newer row below it.
 */
export async function pruneCmsEntryVersions(entryId: string): Promise<void> {
  const db = getDB();

  const survivors = await db
    .select({ versionNumber: cmsEntryVersionTable.versionNumber })
    .from(cmsEntryVersionTable)
    .where(eq(cmsEntryVersionTable.entryId, entryId))
    .orderBy(desc(cmsEntryVersionTable.versionNumber))
    .limit(CMS_ENTRY_VERSION_HISTORY_LIMIT);

  const oldestKept = survivors.at(-1)?.versionNumber;

  if (survivors.length < CMS_ENTRY_VERSION_HISTORY_LIMIT || oldestKept === undefined) {
    return;
  }

  await db
    .delete(cmsEntryVersionTable)
    .where(and(
      eq(cmsEntryVersionTable.entryId, entryId),
      lt(cmsEntryVersionTable.versionNumber, oldestKept),
    ));
}

/**
 * Appends one `cms_entry_version` row for a change already written to `cms_entry`, then prunes.
 *
 * Every writer comes through here — the editor, the internal admin API, the publish timer, and the
 * revert path — so history reads the same whichever one made the change. `createdBy` defaults to the
 * entry's author, which is what the schema tracks for a save; a revert passes the restored author.
 */
export async function recordCmsEntryVersion({
  existingEntry,
  snapshot,
  createdBy,
}: {
  existingEntry: CmsEntry;
  snapshot: CmsEntryVersionSnapshot;
  createdBy?: string;
}): Promise<void> {
  const db = getDB();

  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: existingEntry.id },
    orderBy: { versionNumber: "desc" },
  });

  // Version 1 snapshots the pre-change state because entry creation skips duplicate history. Both
  // rows go in one insert: a first save that wrote only the pre-change row would lose a version.
  const rows = [
    ...(latestVersion
      ? []
      : [versionRow({
        entryId: existingEntry.id,
        versionNumber: 1,
        snapshot: existingEntry,
        createdBy: existingEntry.createdBy,
      })]),
    versionRow({
      entryId: existingEntry.id,
      versionNumber: (latestVersion?.versionNumber ?? 1) + 1,
      snapshot,
      createdBy: createdBy ?? existingEntry.createdBy,
    }),
  ];

  await db.insert(cmsEntryVersionTable).values(rows);

  // Post-commit: the save and its history row are already written, so a prune failure must not
  // surface as a failed save. The next save prunes what this one could not.
  await pruneCmsEntryVersions(existingEntry.id).catch((error: unknown) => {
    console.error("Failed to prune CMS entry version history", { entryId: existingEntry.id, error });
  });
}
