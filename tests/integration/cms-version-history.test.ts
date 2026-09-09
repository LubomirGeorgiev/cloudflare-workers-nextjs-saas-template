/// <reference types="@cloudflare/vitest-plugin/types" />

// A version row holds a full copy of the entry body, so history is the one table that grows per
// save rather than per entry. The cap is what keeps a heavily edited entry from outweighing
// everything else in D1, and it has to drop the OLDEST rows — dropping the newest would throw away
// the change the editor just made.

import { expect, test } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { CMS_ENTRY_VERSION_HISTORY_LIMIT } from "@/constants";
import { getDB } from "@/db";
import { userTable, type CmsEntry } from "@/db/schema";
import { createCmsEntry } from "@/lib/cms/entry";
import { pruneCmsEntryVersions, recordCmsEntryVersion } from "@/lib/cms/entry/version-history";
import { revertCmsEntryToVersion } from "@/lib/cms/entry/versions";

const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

const content = { type: "doc", content: [] };

async function seedEntry(): Promise<CmsEntry> {
  const authorId = uid("usr");
  await db.insert(userTable).values({
    id: authorId,
    email: `${authorId}@example.com`,
    emailVerified: new Date(),
  });

  return createCmsEntry({
    collectionSlug: "docs",
    content,
    createdBy: authorId,
    fields: {},
    seoDescription: "history fixture",
    slug: uid("history"),
    status: CMS_ENTRY_STATUS.DRAFT,
    title: "History fixture",
    tagIds: [],
  });
}

function snapshotFor(entry: CmsEntry, title: string) {
  return {
    title,
    content,
    fields: entry.fields,
    slug: entry.slug,
    seoDescription: entry.seoDescription,
    status: entry.status,
    featuredImageId: entry.featuredImageId,
  };
}

async function versionNumbersFor(entryId: string): Promise<number[]> {
  const rows = await db.query.cmsEntryVersionTable.findMany({
    where: { entryId },
    columns: { versionNumber: true },
    orderBy: { versionNumber: "asc" },
  });

  return rows.map((row) => row.versionNumber);
}

// Saves past the cap, so the pruning is driven the way a real editor drives it.
test("history stops growing at the cap and keeps the newest versions", async () => {
  const entry = await seedEntry();
  const saves = CMS_ENTRY_VERSION_HISTORY_LIMIT + 5;

  for (let index = 0; index < saves; index++) {
    await recordCmsEntryVersion({
      existingEntry: entry,
      snapshot: snapshotFor(entry, `Revision ${index}`),
    });
  }

  const versions = await versionNumbersFor(entry.id);

  expect(versions).toHaveLength(CMS_ENTRY_VERSION_HISTORY_LIMIT);

  // The survivors are the newest run of numbers, so the oldest went and nothing in the middle did.
  const newest = Math.max(...versions);
  expect(versions).toEqual(
    Array.from({ length: CMS_ENTRY_VERSION_HISTORY_LIMIT }, (_, i) =>
      newest - CMS_ENTRY_VERSION_HISTORY_LIMIT + 1 + i),
  );
});

// Both rows come from one insert, so a first save can never leave only the pre-change snapshot.
test("the first save on an entry with no history writes versions 1 and 2", async () => {
  const entry = await seedEntry();

  await recordCmsEntryVersion({
    existingEntry: entry,
    snapshot: snapshotFor(entry, "First revision"),
  });

  expect(await versionNumbersFor(entry.id)).toEqual([1, 2]);

  const rows = await db.query.cmsEntryVersionTable.findMany({
    where: { entryId: entry.id },
    orderBy: { versionNumber: "asc" },
  });

  expect(rows.map((row) => row.title)).toEqual([entry.title, "First revision"]);
});

test("an entry under the cap keeps every version it has", async () => {
  const entry = await seedEntry();

  await recordCmsEntryVersion({
    existingEntry: entry,
    snapshot: snapshotFor(entry, "Only revision"),
  });

  const before = await versionNumbersFor(entry.id);
  await pruneCmsEntryVersions(entry.id);

  expect(await versionNumbersFor(entry.id)).toEqual(before);
  expect(before.length).toBeLessThan(CMS_ENTRY_VERSION_HISTORY_LIMIT);
});

test("pruning an entry with no history at all is a no-op", async () => {
  await expect(pruneCmsEntryVersions(uid("cms_ent"))).resolves.toBeUndefined();
});

// A revert is a save like any other: it writes the entry first, then appends and caps history.
test("a revert restores the entry and leaves the restored body as the newest capped version", async () => {
  const entry = await seedEntry();
  const saves = CMS_ENTRY_VERSION_HISTORY_LIMIT + 2;

  for (let index = 0; index < saves; index++) {
    await recordCmsEntryVersion({
      existingEntry: entry,
      snapshot: snapshotFor(entry, `Revision ${index}`),
    });
  }

  // The oldest surviving row, so the revert target is not already the entry's current body.
  const target = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: entry.id },
    orderBy: { versionNumber: "asc" },
  });

  if (!target) {
    throw new Error("Expected the seeded entry to hold version history");
  }

  const reverted = await revertCmsEntryToVersion({ entryId: entry.id, versionId: target.id });

  expect(reverted.title).toBe(target.title);
  expect(reverted.slug).toBe(target.slug);

  const versions = await versionNumbersFor(entry.id);
  expect(versions).toHaveLength(CMS_ENTRY_VERSION_HISTORY_LIMIT);

  const newest = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: entry.id },
    orderBy: { versionNumber: "desc" },
  });

  expect(newest?.versionNumber).toBe(Math.max(...versions));
  expect(newest?.title).toBe(target.title);
});
