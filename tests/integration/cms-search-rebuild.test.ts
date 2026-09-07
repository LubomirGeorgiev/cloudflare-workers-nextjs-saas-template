/// <reference types="@cloudflare/vitest-plugin/types" />

// `cms_entry_search` is an FTS5 table with no unique index on `entryId`, so nothing but the rebuild
// itself keeps a duplicate row out. Two rebuilds of one collection run here at the same time: the
// admin panel, the internal REST route, the MCP tool, and the public search path all call it.

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";

import type { CollectionsUnion } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import {
  CMS_SEARCH_REBUILD_CHUNK_SIZE,
  getSearchableCollections,
  rebuildCmsSearchIndex,
} from "@/lib/cms/cms-search";

const db = getDB();
const AUTHOR_ID = "cms-search-rebuild-author";
/** Enough rows for more than one chunk, so the per-chunk delete is actually exercised. */
const ENTRY_COUNT = CMS_SEARCH_REBUILD_CHUNK_SIZE + 3;
/** `cms_entry` binds 13 columns per row, and D1 allows 100 bound parameters per statement. */
const SEED_INSERT_CHUNK_SIZE = 5;

// A fork can turn search off everywhere; then there is nothing to rebuild and the suite skips.
const searchableCollection: CollectionsUnion | undefined = getSearchableCollections()[0];

const entryContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Rebuild integration search phrase" }],
    },
  ],
};

async function clearSeededRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM cms_entry_search"),
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM user WHERE id = ?").bind(AUTHOR_ID),
  ]);
}

async function seedEntries(collection: CollectionsUnion): Promise<void> {
  await db.insert(userTable).values({
    id: AUTHOR_ID,
    email: `${AUTHOR_ID}@example.com`,
  });

  const rows = Array.from({ length: ENTRY_COUNT }, (_, index) => ({
    collection,
    content: entryContent,
    createdBy: AUTHOR_ID,
    fields: {},
    seoDescription: `Rebuild SEO description ${index}`,
    slug: `rebuild-race-${index}`,
    status: CMS_ENTRY_STATUS.PUBLISHED,
    title: `Rebuild Race ${index}`,
  }));

  // One insert of every row passes the SQLite bound-parameter limit, so the seed goes in slices.
  for (let start = 0; start < rows.length; start += SEED_INSERT_CHUNK_SIZE) {
    await db.insert(cmsEntryTable).values(rows.slice(start, start + SEED_INSERT_CHUNK_SIZE));
  }
}

async function countSearchRows(
  collection: CollectionsUnion,
): Promise<{ rowCount: number; entryCount: number }> {
  const row = await env.D1_DB
    .prepare(
      "SELECT count(*) AS rowCount, count(DISTINCT entryId) AS entryCount FROM cms_entry_search WHERE collection = ?",
    )
    .bind(collection)
    .first<{ rowCount: number | string; entryCount: number | string }>();

  return { rowCount: Number(row?.rowCount ?? 0), entryCount: Number(row?.entryCount ?? 0) };
}

beforeEach(async () => {
  await clearSeededRows();
});

afterEach(async () => {
  await clearSeededRows();
});

test.skipIf(!searchableCollection)("one rebuild writes exactly one row per entry", async () => {
  const collection = searchableCollection!;
  await seedEntries(collection);

  await rebuildCmsSearchIndex(collection);

  await expect(countSearchRows(collection)).resolves.toEqual({
    rowCount: ENTRY_COUNT,
    entryCount: ENTRY_COUNT,
  });
});

// Local Miniflare may or may not truly interleave the two rebuilds. The invariant holds either way,
// which is the point: the assertion cannot pass by accident of scheduling.
test.skipIf(!searchableCollection)(
  "two overlapping rebuilds leave no duplicate search row",
  async () => {
    const collection = searchableCollection!;
    await seedEntries(collection);

    await Promise.all([rebuildCmsSearchIndex(collection), rebuildCmsSearchIndex(collection)]);

    await expect(countSearchRows(collection)).resolves.toEqual({
      rowCount: ENTRY_COUNT,
      entryCount: ENTRY_COUNT,
    });
  },
);
