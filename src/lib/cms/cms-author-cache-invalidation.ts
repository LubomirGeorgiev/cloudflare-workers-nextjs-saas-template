import "server-only";

import { and, eq } from "drizzle-orm";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable } from "@/db/schema";
import { getBlogAuthorPagePath, getBlogListPagePaths } from "@/lib/blog-routing";
import { hasCmsAuthorFieldChange, type CmsAuthorFields } from "@/lib/cms/cms-author-fields";
import { invalidateCmsEntries, type CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";

/**
 * Purges the public CMS pages that render this user as an author, after a user write commits.
 * It never throws, so a cache fault cannot fail the committed write. Every user writer calls it.
 */
export async function invalidateCmsAuthorAfterUserWrite({
  userId,
  before,
  after,
}: {
  userId: string;
  before: CmsAuthorFields;
  after: CmsAuthorFields;
}): Promise<void> {
  if (!hasCmsAuthorFieldChange({ before, after })) {
    return;
  }

  try {
    const entries = await getCmsEntryRefsRenderingAuthor({ userId });

    // A user with no published entry has no author page and is on no public CMS page.
    if (entries.length === 0) {
      return;
    }

    // The listing subtree of each entry holds `/blog/authors/...`, and the collection tag drops the
    // author list, the author pages, and the author OG cards. A rename moves the author page, and
    // the purge reads only the new one from D1, so the old one is named here.
    await invalidateCmsEntries({
      entries,
      knownPagePathnames: getBlogListPagePaths({
        pathname: getBlogAuthorPagePath({ id: userId, ...before }),
        postCount: entries.length,
      }),
    });
  } catch (error) {
    console.error("invalidateCmsAuthorAfterUserWrite: the author cache purge failed", error);
  }
}

/**
 * The entries whose public pages render this user as their author. Only a published entry is
 * public: a scheduled publish runs its own purge when it goes live.
 */
export async function getCmsEntryRefsRenderingAuthor({
  userId,
}: {
  userId: string;
}): Promise<CmsEntryRef[]> {
  const db = getDB();

  return db
    .selectDistinct({
      collection: cmsEntryTable.collection,
      slug: cmsEntryTable.slug,
    })
    .from(cmsEntryTable)
    .where(and(
      eq(cmsEntryTable.createdBy, userId),
      eq(cmsEntryTable.status, CMS_ENTRY_STATUS.PUBLISHED),
    ));
}
