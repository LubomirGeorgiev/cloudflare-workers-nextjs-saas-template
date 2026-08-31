import "server-only";

import { eq, sql } from "drizzle-orm";

import type { CollectionsUnion } from "@/../cms.config";
import { getDB } from "@/db";
import { cmsEntryTable } from "@/db/schema";

// A deliberately thin index over `cms_entry` for the internal admin API.
//
// It does not go through `getFreshCmsCollection`, and that is not a shortcut around the service
// layer: that function loads relations and filters by locale, neither of which an all-statuses,
// all-locales staff index wants, and reaching it pulls `translation-staleness` -> `translate-entry`
// -> the tiptap extension tree into the Worker API bundle and into the OpenAPI generator's import
// graph. This is a projection, not a business rule; publishing, which *is* one, stays in
// `entry/publishing.ts`, the one service the editor, the timer, and this API all publish through.

interface AdminCmsEntrySummary {
  id: string;
  collection: string;
  slug: string;
  title: string;
  status: string;
  locale: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
}

interface AdminCmsEntryPage {
  entries: AdminCmsEntrySummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listAdminCmsEntries({
  collectionSlug,
  page,
  pageSize,
}: {
  collectionSlug: CollectionsUnion;
  page: number;
  pageSize: number;
}): Promise<AdminCmsEntryPage> {
  const db = getDB();

  const [[{ count }], entries] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(cmsEntryTable)
      .where(eq(cmsEntryTable.collection, collectionSlug)),
    db.query.cmsEntryTable.findMany({
      columns: {
        id: true,
        collection: true,
        slug: true,
        title: true,
        status: true,
        locale: true,
        publishedAt: true,
        updatedAt: true,
      },
      where: { collection: collectionSlug },
      orderBy: { createdAt: "desc" },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);

  return {
    entries,
    totalCount: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize),
  };
}
