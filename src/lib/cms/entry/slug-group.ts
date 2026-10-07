import "server-only";

import { and, eq } from "drizzle-orm";

import { getDB } from "@/db";
import { cmsEntryTable, type CmsEntry } from "@/db/schema";
import { syncCmsEntrySearch } from "@/lib/cms/cms-search";

/**
 * The locale rows of one entry share `(collection, slug)`; the slug is the group key. So a rename
 * must move every row together, or the rows on the old slug split off into a separate entry.
 * `updateCmsEntry` and the version restore both use these rules.
 */

/** Refuses a new slug that another group already holds. Call it before the rename. */
export async function assertCmsSlugAvailable({
  collection,
  slug,
}: {
  collection: CmsEntry["collection"];
  slug: string;
}): Promise<void> {
  const db = getDB();

  // The group still holds its old slug here, so any row on the new slug is another group.
  const [conflictingEntry] = await db
    .select({ id: cmsEntryTable.id })
    .from(cmsEntryTable)
    .where(and(eq(cmsEntryTable.collection, collection), eq(cmsEntryTable.slug, slug)))
    .limit(1);

  if (conflictingEntry) {
    throw new Error(`Entry with slug "${slug}" already exists in collection "${collection}"`);
  }
}

/** The statement that moves every row on `fromSlug` to `toSlug`. Send it in the same batch as the row write. */
export function cmsGroupSlugRenameQuery({
  collection,
  fromSlug,
  toSlug,
}: {
  collection: CmsEntry["collection"];
  fromSlug: string;
  toSlug: string;
}) {
  const db = getDB();

  return db
    .update(cmsEntryTable)
    .set({ slug: toSlug })
    .where(and(eq(cmsEntryTable.collection, collection), eq(cmsEntryTable.slug, fromSlug)));
}

/** Re-indexes every locale row of a group, because the search index stores the slug. */
export async function syncCmsGroupSearch({
  collection,
  slug,
}: {
  collection: CmsEntry["collection"];
  slug: string;
}): Promise<void> {
  const db = getDB();
  const rows = await db.query.cmsEntryTable.findMany({ where: { collection, slug } });

  // One row per enabled locale, so the list is bounded.
  await Promise.all(
    rows.map((row) =>
      syncCmsEntrySearch({
        entryId: row.id,
        collection: row.collection,
        slug: row.slug,
        title: row.title,
        seoDescription: row.seoDescription,
        content: row.content,
      })
    )
  );
}
