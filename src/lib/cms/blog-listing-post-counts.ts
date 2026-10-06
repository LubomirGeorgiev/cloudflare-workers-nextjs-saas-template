import "server-only";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import {
  BLOG_BASE_PATH,
  BLOG_COLLECTION_SLUG,
  getBlogAuthorPagePath,
  getBlogTagPagePath,
} from "@/lib/blog-routing";

/** One blog list path and how many published posts it can list. */
export interface BlogListingPostCount {
  pathname: string;
  postCount: number;
}

/**
 * The blog list and every tag and author page that lists a published post, with its post count.
 * The count adds up every locale, so it is an upper bound for each locale's page count. The purge
 * uses it to name the numbered pages. Straight from D1, so a cache read cannot hide a page. Never
 * throws.
 *
 * `@/db` is imported lazily for the reason in `src/lib/cms/cms-navigation-entry-paths.ts`.
 */
export async function getBlogListingPostCounts(): Promise<BlogListingPostCount[]> {
  try {
    const [
      { getDB },
      { cmsEntryTable, cmsEntryTagTable, cmsTagTable, userTable },
      { and, count, eq },
    ] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
    const db = getDB();
    const isPublishedBlogPost = and(
      eq(cmsEntryTable.collection, BLOG_COLLECTION_SLUG),
      eq(cmsEntryTable.status, CMS_ENTRY_STATUS.PUBLISHED),
    );

    const [[blog], tagRows, authorRows] = await Promise.all([
      db.select({ postCount: count() }).from(cmsEntryTable).where(isPublishedBlogPost),
      db
        .select({ slug: cmsTagTable.slug, postCount: count() })
        .from(cmsEntryTagTable)
        .innerJoin(cmsTagTable, eq(cmsTagTable.id, cmsEntryTagTable.tagId))
        .innerJoin(cmsEntryTable, eq(cmsEntryTable.id, cmsEntryTagTable.entryId))
        .where(isPublishedBlogPost)
        .groupBy(cmsTagTable.slug),
      db
        .select({
          id: userTable.id,
          firstName: userTable.firstName,
          lastName: userTable.lastName,
          postCount: count(),
        })
        .from(cmsEntryTable)
        .innerJoin(userTable, eq(userTable.id, cmsEntryTable.createdBy))
        .where(isPublishedBlogPost)
        .groupBy(userTable.id),
    ]);

    return [
      { pathname: BLOG_BASE_PATH, postCount: blog?.postCount ?? 0 },
      ...tagRows.map(({ slug, postCount }) => ({ pathname: getBlogTagPagePath(slug), postCount })),
      ...authorRows.map(({ postCount, ...author }) => ({
        pathname: getBlogAuthorPagePath(author),
        postCount,
      })),
    ];
  } catch (error) {
    // Best effort, like every other purge read: the subtree roots and the TTL still apply.
    console.error("Blog listing post count lookup failed", error);
    return [];
  }
}
