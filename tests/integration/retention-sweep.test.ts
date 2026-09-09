/// <reference types="@cloudflare/vitest-plugin/types" />

// Behavior coverage for the retention sweep against a real D1. The sweep collects what the manual
// paths could not delete inline — an expired key, a key revoked by a ban, an invitation nobody
// accepted — so what matters here is the boundary: dead the instant it is dead, and everything
// still in use left alone.

import { beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { and, inArray } from "drizzle-orm";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import {
  API_KEY_PREFIX_LIVE,
  CMS_ENTRY_VERSION_HISTORY_LIMIT,
  CMS_IMAGES_BASE_PATH,
} from "@/constants";
import {
  R2_ORPHAN_CURSOR_KV_KEY,
  R2_ORPHAN_LOOKUP_CHUNK_SIZE,
  R2_ORPHAN_MAX_DELETES_PER_RUN,
  R2_ORPHAN_MAX_PAGES_PER_RUN,
} from "@/constants/retention";
import { SYSTEM_ROLES_ENUM } from "@/constants/team-roles";
import { getDB } from "@/db";
import {
  apiKeyTable,
  cmsEntryTable,
  cmsEntryVersionTable,
  cmsMediaTable,
  teamInvitationTable,
  teamTable,
  userTable,
} from "@/db/schema";
import { isDeadApiKey, isLiveApiKey } from "@/lib/api-keys/liveness";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import {
  purgeExcessCmsEntryVersions,
  purgeExpiredApiKeys,
  purgeExpiredTeamInvitations,
  purgeOrphanedR2Objects,
} from "@/lib/maintenance/retention";

const db = getDB();
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-01T00:00:00.000Z");

// A `cms_media` row binds nine parameters, so the same D1 ceiling the sweep chunks against limits
// how many fixture rows one insert may carry.
const MEDIA_SEED_ROWS_PER_INSERT = 10;

// The same ceiling, against the much wider `cms_entry_version` row.
const VERSION_SEED_ROWS_PER_INSERT = 6;

// Whichever collection the fork configures first: the sweep groups by entry and never reads it.
const [FIXTURE_COLLECTION] = Object.keys(cmsConfig.collections) as CollectionsUnion[];

// The parked cursor lives under one fixed KV key, so every sweep in this file shares it.
beforeEach(async () => {
  await env.KV_STORE.delete(R2_ORPHAN_CURSOR_KV_KEY);
});

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function daysBeforeNow(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_IN_MS);
}

async function seedUser(): Promise<string> {
  const userId = uid("usr");
  await db.insert(userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: NOW,
  });
  return userId;
}

async function seedKey({
  userId,
  expiresAt = null,
  revokedAt = null,
}: {
  userId: string;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<string> {
  const id = uid("akey");
  await db.insert(apiKeyTable).values({
    id,
    userId,
    name: "retention fixture",
    keyHash: uid("hash"),
    keyPrefix: API_KEY_PREFIX_LIVE,
    last4: "abcd",
    scopes: [API_SCOPE_NAMES[0]],
    expiresAt,
    revokedAt,
  });
  return id;
}

async function seedInvitation({
  expiresAt,
  acceptedAt = null,
}: {
  expiresAt: Date;
  acceptedAt?: Date | null;
}): Promise<string> {
  const inviterId = await seedUser();
  const teamId = uid("team");
  await db.insert(teamTable).values({ id: teamId, name: "Retention Team", slug: uid("slug") });

  const id = uid("tinv");
  await db.insert(teamInvitationTable).values({
    id,
    teamId,
    email: `${id}@example.com`,
    roleId: SYSTEM_ROLES_ENUM.MEMBER,
    isSystemRole: 1,
    token: uid("tok"),
    invitedBy: inviterId,
    expiresAt,
    acceptedAt,
    acceptedBy: acceptedAt ? inviterId : null,
  });
  return id;
}

async function survivingKeys(ids: string[]): Promise<string[]> {
  const rows = await db
    .select({ id: apiKeyTable.id })
    .from(apiKeyTable)
    .where(inArray(apiKeyTable.id, ids));
  return rows.map((row) => row.id);
}

test("every dead key is purged at once and every live key survives", async () => {
  const userId = await seedUser();

  const [longExpired, longRevoked, justExpired, justRevoked, live, neverExpires] =
    await Promise.all([
      seedKey({ userId, expiresAt: daysBeforeNow(200) }),
      seedKey({ userId, revokedAt: daysBeforeNow(200) }),
      // One second dead is as dead as a year: no surface has ever shown either row.
      seedKey({ userId, expiresAt: new Date(NOW.getTime() - 1000) }),
      seedKey({ userId, revokedAt: new Date(NOW.getTime() - 1000) }),
      seedKey({ userId, expiresAt: new Date(NOW.getTime() + DAY_IN_MS) }),
      seedKey({ userId }),
    ]);

  await purgeExpiredApiKeys(NOW);

  const remaining = await survivingKeys([
    longExpired, longRevoked, justExpired, justRevoked, live, neverExpires,
  ]);

  expect(remaining).toEqual(expect.arrayContaining([live, neverExpires]));
  expect(remaining).not.toContain(longExpired);
  expect(remaining).not.toContain(longRevoked);
  expect(remaining).not.toContain(justExpired);
  expect(remaining).not.toContain(justRevoked);
});

// The listings show live keys and the sweep deletes dead ones, so the two predicates have to
// partition the table exactly. A key that matched neither would be visible to nobody and collected
// by nothing, and would sit in D1 for good.
test("live and dead are exact complements, boundary included", async () => {
  const userId = await seedUser();

  const [neverExpires, stillLive, expiresAtNow, expired, revoked] = await Promise.all([
    seedKey({ userId }),
    seedKey({ userId, expiresAt: new Date(NOW.getTime() + DAY_IN_MS) }),
    // The one second that decides which side of the boundary belongs to which predicate.
    seedKey({ userId, expiresAt: NOW }),
    seedKey({ userId, expiresAt: daysBeforeNow(1) }),
    seedKey({ userId, revokedAt: daysBeforeNow(1) }),
  ]);
  const seeded = [neverExpires, stillLive, expiresAtNow, expired, revoked];

  const [live, dead] = await Promise.all([
    db.select({ id: apiKeyTable.id }).from(apiKeyTable)
      .where(and(inArray(apiKeyTable.id, seeded), isLiveApiKey({ now: NOW }))),
    db.select({ id: apiKeyTable.id }).from(apiKeyTable)
      .where(and(inArray(apiKeyTable.id, seeded), isDeadApiKey({ now: NOW }))),
  ]);

  expect(live.map((row) => row.id).sort()).toEqual([neverExpires, stillLive].sort());
  expect(dead.map((row) => row.id).sort()).toEqual([expiresAtNow, expired, revoked].sort());
});

// The same boundary, through the sweep itself: a key whose expiry is the sweep's own clock is
// already refused everywhere, so nothing is lost by collecting it now.
test("a key expiring at exactly the sweep's clock is collected", async () => {
  const userId = await seedUser();
  const [onTheBoundary, live] = await Promise.all([
    seedKey({ userId, expiresAt: NOW }),
    seedKey({ userId, expiresAt: new Date(NOW.getTime() + DAY_IN_MS) }),
  ]);

  await purgeExpiredApiKeys(NOW);

  expect(await survivingKeys([onTheBoundary, live])).toEqual([live]);
});

test("the sweep is idempotent: a second run over swept data deletes nothing", async () => {
  const userId = await seedUser();
  await seedKey({ userId, expiresAt: daysBeforeNow(1) });

  await purgeExpiredApiKeys(NOW);

  expect(await purgeExpiredApiKeys(NOW)).toBe(0);
});

test("a pending invitation is purged at its expiry and not one moment before", async () => {
  const [longExpired, justExpired, stillPending] = await Promise.all([
    seedInvitation({ expiresAt: daysBeforeNow(200) }),
    seedInvitation({ expiresAt: new Date(NOW.getTime() - 1000) }),
    seedInvitation({ expiresAt: new Date(NOW.getTime() + DAY_IN_MS) }),
  ]);

  await purgeExpiredTeamInvitations(NOW);

  const remaining = await db
    .select({ id: teamInvitationTable.id })
    .from(teamInvitationTable)
    .where(inArray(teamInvitationTable.id, [longExpired, justExpired, stillPending]));
  const ids = remaining.map((row) => row.id);

  expect(ids).not.toContain(longExpired);
  expect(ids).not.toContain(justExpired);
  expect(ids).toContain(stillPending);
});

test("an accepted invitation is never purged, however long ago it expired", async () => {
  const accepted = await seedInvitation({
    expiresAt: daysBeforeNow(400),
    acceptedAt: daysBeforeNow(400),
  });

  await purgeExpiredTeamInvitations(NOW);

  const remaining = await db
    .select({ id: teamInvitationTable.id })
    .from(teamInvitationTable)
    .where(inArray(teamInvitationTable.id, [accepted]));

  expect(remaining).toHaveLength(1);
});

// A stand-in for the bucket: the sweep only ever lists, reads `uploaded`, and deletes, so the fake
// covers its whole contract and keeps the age and reference rules under test rather than R2's.
//
// `delete` takes the same `string | string[]` R2 takes, and `deleteCalls` records one entry per
// call, so a test can tell a bulk delete from one call per key.
//
// It pages in key order like R2 does, and `pageSize` caps the sweep's own `limit` so a paging test
// needs three fixture objects instead of `R2_ORPHAN_LIST_PAGE_SIZE` of them.
//
// A cursor it never handed out is refused, like R2 refuses one it no longer recognizes.
function fakeBucket({
  objects,
  pageSize,
}: {
  objects: { key: string; uploaded: Date }[];
  pageSize?: number;
}) {
  const remaining = new Map(objects.map((object) => [object.key, object]));
  const issuedCursors = new Set<string>();

  return {
    deleted: [] as string[],
    deleteCalls: [] as string[][],
    listCursors: [] as (string | undefined)[],
    async list({ prefix, limit, cursor }: { prefix: string; limit?: number; cursor?: string }) {
      this.listCursors.push(cursor);

      if (cursor !== undefined && !issuedCursors.has(cursor)) {
        throw new Error("list: The cursor is invalid. (10006)");
      }

      const matching = [...remaining.values()]
        .filter((object) => object.key.startsWith(prefix))
        .filter((object) => cursor === undefined || object.key > cursor)
        .sort((left, right) => (left.key < right.key ? -1 : 1));

      const page = matching.slice(0, Math.min(limit ?? matching.length, pageSize ?? matching.length));

      if (page.length < matching.length) {
        const nextCursor = page[page.length - 1].key;

        issuedCursors.add(nextCursor);

        return { objects: page, truncated: true as const, cursor: nextCursor };
      }

      return { objects: page, truncated: false as const };
    },
    async delete(keys: string | string[]) {
      const batch = Array.isArray(keys) ? keys : [keys];

      for (const key of batch) {
        remaining.delete(key);
      }

      this.deleteCalls.push(batch);
      this.deleted.push(...batch);
    },
  };
}

function sweepOrphans(bucket: ReturnType<typeof fakeBucket>): Promise<number> {
  return purgeOrphanedR2Objects({
    bucket: bucket as unknown as R2Bucket,
    kv: env.KV_STORE,
    now: NOW,
  });
}

// One key per index, zero-padded so R2's key order and the fixture order agree.
function orphanKeys({ runId, count }: { runId: string; count: number }): string[] {
  return Array.from(
    { length: count },
    (_unused, index) => `${CMS_IMAGES_BASE_PATH}/blog/${runId}-${String(index).padStart(5, "0")}.png`,
  );
}

async function seedMedia(bucketKeys: string[]): Promise<void> {
  const uploadedBy = await seedUser();

  for (let start = 0; start < bucketKeys.length; start += MEDIA_SEED_ROWS_PER_INSERT) {
    await db.insert(cmsMediaTable).values(
      bucketKeys.slice(start, start + MEDIA_SEED_ROWS_PER_INSERT).map((bucketKey) => ({
        fileName: "fixture.png",
        mimeType: "image/png",
        sizeInBytes: 1,
        bucketKey,
        uploadedBy,
      })),
    );
  }
}

test("an unreferenced R2 object is deleted once it is old enough", async () => {
  const orphan = `${CMS_IMAGES_BASE_PATH}/blog/orphan-${Date.now()}.png`;
  const referenced = `${CMS_IMAGES_BASE_PATH}/blog/referenced-${Date.now()}.png`;
  await seedMedia([referenced]);

  const bucket = fakeBucket({
    objects: [
      { key: orphan, uploaded: daysBeforeNow(3) },
      { key: referenced, uploaded: daysBeforeNow(3) },
    ],
  });

  const deletedCount = await sweepOrphans(bucket);

  expect(deletedCount).toBe(1);
  expect(bucket.deleted).toEqual([orphan]);
});

// The upload writes the object before its row, so a young unreferenced object is very likely an
// upload still in flight — deleting it would destroy a live image mid-request.
test("a recently uploaded object is left alone even with no row pointing at it", async () => {
  const fresh = `${CMS_IMAGES_BASE_PATH}/blog/fresh-${Date.now()}.png`;
  const bucket = fakeBucket({
    objects: [{ key: fresh, uploaded: new Date(NOW.getTime() - 60 * 1000) }],
  });

  await sweepOrphans(bucket);

  expect(bucket.deleted).toEqual([]);
});

// Everything outside the CMS image prefix belongs to something this sweep knows nothing about.
test("objects outside the CMS image prefix are never listed, so never deleted", async () => {
  const foreign = `some-other-feature/keep-me-${Date.now()}.bin`;
  const bucket = fakeBucket({ objects: [{ key: foreign, uploaded: daysBeforeNow(400) }] });

  await sweepOrphans(bucket);

  expect(bucket.deleted).toEqual([]);
});

// One page costs several `bucketKey IN (...)` lookups, so a referenced key must survive at every
// place a chunk boundary can put it: the first key of a chunk, the last key of a chunk, and the last
// key of the page.
test("referenced keys spread across lookup chunk boundaries all survive one page", async () => {
  const runId = uid("chunked");
  const keys = orphanKeys({ runId, count: 2 * R2_ORPHAN_LOOKUP_CHUNK_SIZE + 3 });
  const referencedIndexes = new Set([
    0,
    R2_ORPHAN_LOOKUP_CHUNK_SIZE - 1,
    R2_ORPHAN_LOOKUP_CHUNK_SIZE,
    2 * R2_ORPHAN_LOOKUP_CHUNK_SIZE - 1,
    keys.length - 1,
  ]);
  const referenced = keys.filter((_unused, index) => referencedIndexes.has(index));
  const unreferenced = keys.filter((_unused, index) => !referencedIndexes.has(index));
  await seedMedia(referenced);

  const bucket = fakeBucket({
    objects: keys.map((key) => ({ key, uploaded: daysBeforeNow(3) })),
  });

  const deletedCount = await sweepOrphans(bucket);

  expect(deletedCount).toBe(unreferenced.length);
  expect([...bucket.deleted].sort()).toEqual([...unreferenced].sort());
  // One page of orphans, one delete call: R2 takes the whole key list at once.
  expect(bucket.deleteCalls).toHaveLength(1);
});

test("the sweep follows the list cursor and deletes an orphan on the second page", async () => {
  const runId = uid("paged");
  const firstPageOrphan = `${CMS_IMAGES_BASE_PATH}/blog/${runId}-a.png`;
  const firstPageReferenced = `${CMS_IMAGES_BASE_PATH}/blog/${runId}-b.png`;
  const secondPageOrphan = `${CMS_IMAGES_BASE_PATH}/blog/${runId}-c.png`;
  await seedMedia([firstPageReferenced]);

  const bucket = fakeBucket({
    objects: [firstPageOrphan, firstPageReferenced, secondPageOrphan].map((key) => ({
      key,
      uploaded: daysBeforeNow(3),
    })),
    pageSize: 2,
  });

  const deletedCount = await sweepOrphans(bucket);

  expect(bucket.listCursors).toEqual([undefined, firstPageReferenced]);
  expect(deletedCount).toBe(2);
  expect([...bucket.deleted].sort()).toEqual([firstPageOrphan, secondPageOrphan].sort());
});

// A run that spends its whole delete budget must hand its place to the next run. Without the parked
// cursor the tail of a large bucket would never be reached at all.
test("a run that reaches the delete cap parks its cursor and the next run finishes the walk", async () => {
  const runId = uid("delete-cap");
  // One page short of the cap, so the cap falls in the middle of the second page and the cursor
  // parked is a real one rather than the top of the bucket.
  const pageSize = R2_ORPHAN_MAX_DELETES_PER_RUN - 1;
  const keys = orphanKeys({ runId, count: R2_ORPHAN_MAX_DELETES_PER_RUN + 2 });

  const bucket = fakeBucket({
    objects: keys.map((key) => ({ key, uploaded: daysBeforeNow(3) })),
    pageSize,
  });

  const firstRunCount = await sweepOrphans(bucket);

  // The cap cuts inside the second page, to the key exactly, and the rest of that page is left.
  expect(firstRunCount).toBe(R2_ORPHAN_MAX_DELETES_PER_RUN);
  expect(await env.KV_STORE.get(R2_ORPHAN_CURSOR_KV_KEY)).toBe(keys[pageSize - 1]);

  const secondRunCount = await sweepOrphans(bucket);

  expect(secondRunCount).toBe(keys.length - firstRunCount);
  expect([...bucket.deleted].sort()).toEqual([...keys].sort());
  expect(await env.KV_STORE.get(R2_ORPHAN_CURSOR_KV_KEY)).toBeNull();
});

// The same contract at the other cap: pages, not deletes.
test("a run that reaches the page cap parks its cursor, and a completed walk clears it", async () => {
  const runId = uid("page-cap");
  const keys = orphanKeys({ runId, count: R2_ORPHAN_MAX_PAGES_PER_RUN + 1 });

  const bucket = fakeBucket({
    objects: keys.map((key) => ({ key, uploaded: daysBeforeNow(3) })),
    pageSize: 1,
  });

  const firstRunCount = await sweepOrphans(bucket);

  expect(firstRunCount).toBe(R2_ORPHAN_MAX_PAGES_PER_RUN);
  expect(await env.KV_STORE.get(R2_ORPHAN_CURSOR_KV_KEY)).toBe(
    keys[R2_ORPHAN_MAX_PAGES_PER_RUN - 1],
  );

  const secondRunCount = await sweepOrphans(bucket);

  expect(secondRunCount).toBe(keys.length - firstRunCount);
  expect(await env.KV_STORE.get(R2_ORPHAN_CURSOR_KV_KEY)).toBeNull();
});

// A parked cursor outlives the listing it came from, so R2 can refuse it. Refusing it must not cost
// the sweep its run — the walk restarts from the top instead.
test("a stale stored cursor is cleared and the same run restarts from the top", async () => {
  const runId = uid("stale-cursor");
  const [orphan] = orphanKeys({ runId, count: 1 });
  await env.KV_STORE.put(R2_ORPHAN_CURSOR_KV_KEY, "cursor-from-a-listing-that-is-gone");

  const bucket = fakeBucket({ objects: [{ key: orphan, uploaded: daysBeforeNow(3) }] });

  const deletedCount = await sweepOrphans(bucket);

  expect(bucket.listCursors).toEqual(["cursor-from-a-listing-that-is-gone", undefined]);
  expect(deletedCount).toBe(1);
  expect(bucket.deleted).toEqual([orphan]);
  expect(await env.KV_STORE.get(R2_ORPHAN_CURSOR_KV_KEY)).toBeNull();
});

// One entry plus `versionCount` history rows written straight to D1, because what this sweep has to
// collect is exactly the backlog no write path would leave behind today.
async function seedEntryWithVersions(versionCount: number): Promise<string> {
  const createdBy = await seedUser();
  const entryId = uid("cms_ent");
  const body = { type: "doc", content: [] };

  await db.insert(cmsEntryTable).values({
    id: entryId,
    collection: FIXTURE_COLLECTION,
    title: "Retention fixture",
    content: body,
    fields: {},
    slug: uid("retention-history"),
    status: CMS_ENTRY_STATUS.DRAFT,
    createdBy,
  });

  const versionNumbers = Array.from({ length: versionCount }, (_unused, index) => index + 1);

  for (let start = 0; start < versionNumbers.length; start += VERSION_SEED_ROWS_PER_INSERT) {
    await db.insert(cmsEntryVersionTable).values(
      versionNumbers
        .slice(start, start + VERSION_SEED_ROWS_PER_INSERT)
        .map((versionNumber) => ({
          entryId,
          versionNumber,
          title: `Revision ${versionNumber}`,
          content: body,
          fields: {},
          slug: uid("retention-history-version"),
          status: CMS_ENTRY_STATUS.DRAFT,
          createdBy,
        })),
    );
  }

  return entryId;
}

async function versionNumbersFor(entryId: string): Promise<number[]> {
  const rows = await db.query.cmsEntryVersionTable.findMany({
    where: { entryId },
    columns: { versionNumber: true },
    orderBy: { versionNumber: "asc" },
  });

  return rows.map((row) => row.versionNumber);
}

// The cap is enforced on save, so an entry that passed it and was never edited again keeps every
// row it holds. Only this sweep reaches that backlog.
test("history over the cap is cut back to it, and an entry under the cap is untouched", async () => {
  const overflowing = CMS_ENTRY_VERSION_HISTORY_LIMIT + 3;
  const [backlogged, underTheCap] = await Promise.all([
    seedEntryWithVersions(overflowing),
    seedEntryWithVersions(CMS_ENTRY_VERSION_HISTORY_LIMIT - 1),
  ]);

  const prunedCount = await purgeExcessCmsEntryVersions();

  expect(prunedCount).toBe(1);

  // The survivors are the newest run of numbers: the oldest went and nothing in the middle did.
  expect(await versionNumbersFor(backlogged)).toEqual(
    Array.from(
      { length: CMS_ENTRY_VERSION_HISTORY_LIMIT },
      (_unused, index) => overflowing - CMS_ENTRY_VERSION_HISTORY_LIMIT + 1 + index,
    ),
  );

  expect(await versionNumbersFor(underTheCap)).toHaveLength(CMS_ENTRY_VERSION_HISTORY_LIMIT - 1);
});

test("the version-history sweep is idempotent: a second run prunes nothing", async () => {
  await seedEntryWithVersions(CMS_ENTRY_VERSION_HISTORY_LIMIT + 2);

  await purgeExcessCmsEntryVersions();

  expect(await purgeExcessCmsEntryVersions()).toBe(0);
});
