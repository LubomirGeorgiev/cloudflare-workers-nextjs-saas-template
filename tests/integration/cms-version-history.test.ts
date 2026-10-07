/// <reference types="@cloudflare/vitest-plugin/types" />

// A version row holds a full copy of the entry body, so history is the one table that grows per
// save rather than per entry. The cap is what keeps a heavily edited entry from outweighing
// everything else in D1, and it has to drop the OLDEST rows — dropping the newest would throw away
// the change the editor just made.

import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { CMS_ENTRY_VERSION_HISTORY_LIMIT } from "@/constants";
import { getDB } from "@/db";
import { cmsEntryTable, scheduledJobTable, userTable, type CmsEntry } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { createCmsEntry, updateCmsEntry } from "@/lib/cms/entry";
import { pruneCmsEntryVersions, recordCmsEntryVersion } from "@/lib/cms/entry/version-history";
import { revertCmsEntryToVersion } from "@/lib/cms/entry/versions";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

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
    publishedAt: entry.publishedAt,
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

const SIBLING_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// The oldest history row: the snapshot `recordCmsEntryVersion` took of the entry before the change.
async function firstVersionOf(entryId: string) {
  const version = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId },
    orderBy: { versionNumber: "asc" },
  });

  if (!version) {
    throw new Error("Expected the seeded entry to hold version history");
  }

  return version;
}

// The slug is the key that links the locale rows of one entry, so a restore must move all of them.
test.skipIf(!SIBLING_LOCALE)("a restore to an older slug moves every locale row of the entry", async () => {
  if (!SIBLING_LOCALE) {
    return;
  }

  const entry = await seedEntry();
  const renamedSlug = uid("renamed");
  const [sibling] = await db.insert(cmsEntryTable).values({
    collection: entry.collection,
    title: "Sibling",
    content,
    slug: entry.slug,
    locale: SIBLING_LOCALE,
    status: entry.status,
    createdBy: entry.createdBy,
  }).returning();

  await recordCmsEntryVersion({
    existingEntry: entry,
    snapshot: { ...snapshotFor(entry, entry.title), slug: renamedSlug },
  });
  await db.update(cmsEntryTable)
    .set({ slug: renamedSlug })
    .where(and(eq(cmsEntryTable.collection, entry.collection), eq(cmsEntryTable.slug, entry.slug)));

  const target = await firstVersionOf(entry.id);
  await revertCmsEntryToVersion({ entryId: entry.id, versionId: target.id });

  const rows = await db.query.cmsEntryTable.findMany({
    where: { id: { in: [entry.id, sibling.id] } },
    columns: { slug: true },
  });
  expect(rows.map((row) => row.slug)).toEqual([entry.slug, entry.slug]);
});

test("a restore to a slug that another entry holds is refused and writes nothing", async () => {
  const entry = await seedEntry();
  const other = await seedEntry();

  await recordCmsEntryVersion({
    existingEntry: entry,
    snapshot: { ...snapshotFor(entry, "Renamed"), slug: uid("renamed") },
  });
  await db.update(cmsEntryTable).set({ slug: uid("moved") }).where(eq(cmsEntryTable.id, entry.id));
  // The old slug now belongs to another entry.
  await db.update(cmsEntryTable).set({ slug: entry.slug }).where(eq(cmsEntryTable.id, other.id));

  const target = await firstVersionOf(entry.id);
  const before = await db.query.cmsEntryTable.findFirst({ where: { id: entry.id } });

  await expect(revertCmsEntryToVersion({ entryId: entry.id, versionId: target.id })).rejects.toThrow();

  const after = await db.query.cmsEntryTable.findFirst({ where: { id: entry.id } });
  expect(after?.slug).toBe(before?.slug);
});

// A `scheduled` row with no job never goes live, because only the job publishes it.
test("a restore to a scheduled version leaves a publish job for the entry", async () => {
  const entry = await seedEntry();
  // Past the queue delay ceiling, so the job lands in D1 where the test can read it.
  const publishedAt = new Date(Date.now() + 30 * DAY_IN_MS);

  await db.update(cmsEntryTable).set({ publishedAt }).where(eq(cmsEntryTable.id, entry.id));
  await recordCmsEntryVersion({
    existingEntry: entry,
    snapshot: { ...snapshotFor(entry, "Scheduled"), status: CMS_ENTRY_STATUS.SCHEDULED, publishedAt },
  });

  const target = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: entry.id },
    orderBy: { versionNumber: "desc" },
  });

  if (!target) {
    throw new Error("Expected the seeded entry to hold version history");
  }

  const restored = await revertCmsEntryToVersion({ entryId: entry.id, versionId: target.id });
  expect(restored.status).toBe(CMS_ENTRY_STATUS.SCHEDULED);
  expect(restored.scheduleCleared).toBe(false);

  const jobs = await db.select({ payload: scheduledJobTable.payload })
    .from(scheduledJobTable)
    .where(eq(scheduledJobTable.type, SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY));
  expect(jobs.map((job) => job.payload)).toContainEqual({ entryId: entry.id });
});

// Before the fix, the restore kept the current past date, so the job ran at once and published.
test("a restore to a scheduled version keeps the version's future publish date", async () => {
  const entry = await seedEntry();
  // D1 stores whole seconds, and the date is past the queue delay ceiling, so the job lands in D1.
  const scheduledFor = new Date(Math.floor((Date.now() + 30 * DAY_IN_MS) / 1000) * 1000);
  const pastPublishedAt = new Date(Math.floor((Date.now() - DAY_IN_MS) / 1000) * 1000);

  await updateCmsEntry({ id: entry.id, status: CMS_ENTRY_STATUS.SCHEDULED, publishedAt: scheduledFor });
  await updateCmsEntry({ id: entry.id, status: CMS_ENTRY_STATUS.PUBLISHED, publishedAt: pastPublishedAt });

  const target = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: entry.id, status: CMS_ENTRY_STATUS.SCHEDULED },
  });

  if (!target) {
    throw new Error("Expected the scheduled save to leave a version row");
  }

  expect(target.publishedAt).toEqual(scheduledFor);

  const restored = await revertCmsEntryToVersion({ entryId: entry.id, versionId: target.id });
  expect(restored.status).toBe(CMS_ENTRY_STATUS.SCHEDULED);
  expect(restored.publishedAt).toEqual(scheduledFor);

  const stored = await db.query.cmsEntryTable.findFirst({ where: { id: entry.id } });
  expect(stored?.status).toBe(CMS_ENTRY_STATUS.SCHEDULED);
  expect(stored?.publishedAt).toEqual(scheduledFor);

  const jobs = await db.select({ payload: scheduledJobTable.payload, runAt: scheduledJobTable.runAt })
    .from(scheduledJobTable)
    .where(eq(scheduledJobTable.type, SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY));
  expect(jobs).toContainEqual({ payload: { entryId: entry.id }, runAt: scheduledFor });
});

// Version rows saved before history kept dates have none. A guessed date could publish at once.
test("a restore to a scheduled version with no date saves a draft and queues no publish job", async () => {
  const entry = await seedEntry();
  const pastPublishedAt = new Date(Math.floor((Date.now() - DAY_IN_MS) / 1000) * 1000);

  await db.update(cmsEntryTable).set({ publishedAt: pastPublishedAt }).where(eq(cmsEntryTable.id, entry.id));
  await recordCmsEntryVersion({
    existingEntry: entry,
    snapshot: { ...snapshotFor(entry, "Scheduled, no date"), status: CMS_ENTRY_STATUS.SCHEDULED, publishedAt: null },
  });

  const target = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: entry.id },
    orderBy: { versionNumber: "desc" },
  });

  if (!target) {
    throw new Error("Expected the seeded entry to hold version history");
  }

  expect(target.publishedAt).toBeNull();

  const restored = await revertCmsEntryToVersion({ entryId: entry.id, versionId: target.id });
  expect(restored.status).toBe(CMS_ENTRY_STATUS.DRAFT);
  expect(restored.scheduleCleared).toBe(true);

  const jobs = await db.select({ payload: scheduledJobTable.payload })
    .from(scheduledJobTable)
    .where(eq(scheduledJobTable.type, SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY));
  expect(jobs.map((job) => job.payload)).not.toContainEqual({ entryId: entry.id });
});
