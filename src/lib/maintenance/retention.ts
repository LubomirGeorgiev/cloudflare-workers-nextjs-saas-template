import "server-only";

import { and, count, gt, inArray, isNull, lt } from "drizzle-orm";

import { CMS_ENTRY_VERSION_HISTORY_LIMIT, CMS_IMAGES_BASE_PATH } from "@/constants";
import {
  CMS_VERSION_BACKLOG_PAGE_SIZE,
  CMS_VERSION_PRUNE_BATCH_SIZE,
  R2_DELETE_KEYS_PER_CALL,
  R2_ORPHAN_CURSOR_KV_KEY,
  R2_ORPHAN_CURSOR_TTL_SECONDS,
  R2_ORPHAN_LIST_PAGE_SIZE,
  R2_ORPHAN_LOOKUP_CHUNK_SIZE,
  R2_ORPHAN_LOOKUP_CONCURRENCY,
  R2_ORPHAN_MAX_DELETES_PER_RUN,
  R2_ORPHAN_MAX_PAGES_PER_RUN,
  R2_ORPHAN_MIN_AGE_HOURS,
  RETENTION_DELETE_BATCH_SIZE,
  RETENTION_SWEEP_PAGE_SIZE,
} from "@/constants/retention";
import { getDB } from "@/db";
import {
  apiKeyTable,
  cmsEntryVersionTable,
  cmsMediaTable,
  teamInvitationTable,
} from "@/db/schema";
import { deleteApiKeysByIds } from "@/lib/api-keys/delete-api-keys";
import { isDeadApiKey } from "@/lib/api-keys/liveness";
import { pruneCmsEntryVersions } from "@/lib/cms/entry/version-history";
import { chunk } from "@/utils/chunk";
import { mapInBatches } from "@/utils/map-in-batches";

/**
 * Delete every API key that is revoked or past its own expiry.
 *
 * No grace period: the key is refused at authentication from the instant it dies, and no surface
 * has ever shown a dead row, so the row is unreachable data from that same instant. `isDeadApiKey`
 * is the exact complement of the rule those surfaces filter by, so nothing falls between them.
 *
 * The candidate select is bounded and `deleteApiKeysByIds` re-states the predicate in the DELETE,
 * so a key that came back to life between the two statements would survive. Nothing can currently
 * do that; D1 has no transactions, and the guard costs nothing.
 *
 * The helper also drops each deleted key's KV snapshot. Nothing else clears the snapshot of a key
 * that merely reached its expiry — `isUsableSnapshot` refuses it and lets the TTL collect it — and
 * `purgeUserApiKeyCache` reads hashes back from D1, so a deleted row is a hash it can no longer name.
 */
export async function purgeExpiredApiKeys(now = new Date()): Promise<number> {
  const candidates = await getDB()
    .select({ id: apiKeyTable.id })
    .from(apiKeyTable)
    .where(isDeadApiKey({ now }))
    .limit(RETENTION_SWEEP_PAGE_SIZE);

  return deleteApiKeysByIds({ ids: candidates.map((row) => row.id), onlyDeadAt: now });
}

/**
 * Delete invitations that expired without anybody accepting them.
 *
 * Expiry alone is the whole test, for the same reason a dead key needs no grace period: the token
 * is already refused, the row is already invisible, and the seat-cap count already skips it.
 *
 * An accepted invitation is deliberately never touched. It is not a spent credential but the record
 * of a join, so it stays for as long as the team does.
 */
export async function purgeExpiredTeamInvitations(now = new Date()): Promise<number> {
  const db = getDB();
  const isDeadPending = and(
    isNull(teamInvitationTable.acceptedAt),
    lt(teamInvitationTable.expiresAt, now),
  );

  const candidates = await db
    .select({ id: teamInvitationTable.id })
    .from(teamInvitationTable)
    .where(isDeadPending)
    .limit(RETENTION_SWEEP_PAGE_SIZE);

  if (candidates.length === 0) {
    return 0;
  }

  let deletedCount = 0;

  // A failed chunk aborts the run and is not retried here. The predicate selects it again on the
  // next run, so the only cost is a delay of one interval.
  for (const batch of chunk({ items: candidates, size: RETENTION_DELETE_BATCH_SIZE })) {
    const deleted = await db
      .delete(teamInvitationTable)
      .where(and(inArray(teamInvitationTable.id, batch.map((row) => row.id)), isDeadPending))
      .returning({ id: teamInvitationTable.id });

    deletedCount += deleted.length;
  }

  return deletedCount;
}

/**
 * Cut every entry whose version history is over the cap back down to it.
 *
 * `pruneCmsEntryVersions` runs on the write path only, so the cap is enforced per save. An entry
 * that passed the cap and was then never edited again keeps every row it holds, and a version row
 * carries a full copy of the entry body — so the backlog is real storage nothing else reclaims.
 *
 * The same prune the write path calls, so the two agree on which rows survive by construction.
 */
export async function purgeExcessCmsEntryVersions(): Promise<number> {
  const backlogged = await getDB()
    .select({ entryId: cmsEntryVersionTable.entryId })
    .from(cmsEntryVersionTable)
    .groupBy(cmsEntryVersionTable.entryId)
    .having(gt(count(), CMS_ENTRY_VERSION_HISTORY_LIMIT))
    .limit(CMS_VERSION_BACKLOG_PAGE_SIZE);

  if (backlogged.length === 0) {
    return 0;
  }

  await mapInBatches({
    items: backlogged,
    batchSize: CMS_VERSION_PRUNE_BATCH_SIZE,
    fn: (row) => pruneCmsEntryVersions(row.entryId),
  });

  console.info(`purgeExcessCmsEntryVersions: pruned the history of ${backlogged.length} entries`);

  return backlogged.length;
}

// Fails toward the top of the bucket. An unreadable cursor only costs the run its resume point, and
// re-walking the head deletes nothing it should not.
async function readOrphanCursor(kv: KVNamespace): Promise<string | undefined> {
  try {
    return (await kv.get(R2_ORPHAN_CURSOR_KV_KEY)) ?? undefined;
  } catch (error) {
    console.error("purgeOrphanedR2Objects: could not read the stored cursor", error);
    return undefined;
  }
}

// `undefined` means the walk is complete, so the key goes away and the next run starts at the top.
async function saveOrphanCursor({
  kv,
  cursor,
}: {
  kv: KVNamespace;
  cursor: string | undefined;
}): Promise<void> {
  if (cursor === undefined) {
    await kv.delete(R2_ORPHAN_CURSOR_KV_KEY);
    return;
  }

  await kv.put(R2_ORPHAN_CURSOR_KV_KEY, cursor, {
    expirationTtl: R2_ORPHAN_CURSOR_TTL_SECONDS,
  });
}

// R2 names no error code for a cursor it no longer accepts, so any failure of the first list with a
// stored cursor is read as staleness: drop the cursor and walk from the top in this same run.
async function listOrphanPage({
  bucket,
  kv,
  cursor,
  allowStaleCursorRetry,
}: {
  bucket: R2Bucket;
  kv: KVNamespace;
  cursor: string | undefined;
  allowStaleCursorRetry: boolean;
}): Promise<{ listed: R2Objects; restarted: boolean }> {
  const options = { prefix: `${CMS_IMAGES_BASE_PATH}/`, limit: R2_ORPHAN_LIST_PAGE_SIZE };

  try {
    return { listed: await bucket.list({ ...options, cursor }), restarted: false };
  } catch (error) {
    if (!allowStaleCursorRetry) {
      throw error;
    }

    console.warn("purgeOrphanedR2Objects: stored cursor rejected, restarting the walk", error);
    await saveOrphanCursor({ kv, cursor: undefined });

    return { listed: await bucket.list(options), restarted: true };
  }
}

// Which of `keys` no `cms_media` row names. Tested a chunk at a time, so the sweep never depends on
// the table fitting in memory and has no row ceiling. The chunks are independent reads, so a few
// run together instead of one after the other.
async function findOrphanKeys(keys: string[]): Promise<string[]> {
  const db = getDB();

  const rowsPerChunk = await mapInBatches({
    items: chunk({ items: keys, size: R2_ORPHAN_LOOKUP_CHUNK_SIZE }),
    batchSize: R2_ORPHAN_LOOKUP_CONCURRENCY,
    // Equality on the whole key, never a prefix match: a key the query returns has a row, and
    // only a key it does not return is an orphan.
    fn: (lookupChunk) => db
      .select({ bucketKey: cmsMediaTable.bucketKey })
      .from(cmsMediaTable)
      .where(inArray(cmsMediaTable.bucketKey, lookupChunk)),
  });

  const referencedKeys = new Set(rowsPerChunk.flat().map((row) => row.bucketKey));

  return keys.filter((key) => !referencedKeys.has(key));
}

// Deletes as much of `orphans` as `budget` allows, and reports whether the budget cut the list
// short. One `delete` call per slice, not one per key: R2 takes a whole key list in one subrequest.
// An R2 delete is unrecoverable and nothing else records it, so the keys are named in the log.
async function deleteOrphansWithinBudget({
  bucket,
  orphans,
  budget,
}: {
  bucket: R2Bucket;
  orphans: string[];
  budget: number;
}): Promise<{ deletedCount: number; hitBudget: boolean }> {
  const hitBudget = orphans.length >= budget;
  const keys = hitBudget ? orphans.slice(0, budget) : orphans;

  for (const batch of chunk({ items: keys, size: R2_DELETE_KEYS_PER_CALL })) {
    await bucket.delete(batch);
  }

  if (keys.length > 0) {
    console.info(`purgeOrphanedR2Objects: deleted ${keys.length} orphaned object(s)`, keys);
  }

  return { deletedCount: keys.length, hitBudget };
}

/**
 * Delete R2 objects that no `cms_media` row points at.
 *
 * `upload-image.action.ts` puts the object before it inserts the row, and D1 has no transactions,
 * so a failure between the two leaves a file nothing references — unreachable through the app and
 * billable forever. Nothing else ever finds it, because the row was the only thing that named it.
 *
 * Two bounds make this safe to run unattended. Only the CMS image prefix is listed, so an object
 * this bucket gains for another purpose is never a candidate. And an object younger than
 * `R2_ORPHAN_MIN_AGE_HOURS` is never touched, so an upload still between its two writes survives.
 *
 * The walk is resumable: a run stops at `R2_ORPHAN_MAX_PAGES_PER_RUN` pages or
 * `R2_ORPHAN_MAX_DELETES_PER_RUN` deletes, whichever comes first, and parks its list cursor in KV
 * so the next run continues from there rather than re-walking the head of the bucket.
 *
 * Anything put under the prefix from outside the app — wrangler, the dashboard, a fork's importer —
 * has no row, so this deletes it once it is older than the minimum age. A fork that does that turns
 * the sweep off with `R2_ORPHAN_SWEEP_ENABLED`; the scheduler holds that gate.
 */
export async function purgeOrphanedR2Objects({
  bucket,
  kv,
  now = new Date(),
}: {
  bucket: R2Bucket;
  kv: KVNamespace;
  now?: Date;
}): Promise<number> {
  const oldestSweepable = new Date(now.getTime() - R2_ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000);
  let cursor = await readOrphanCursor(kv);
  let deletedCount = 0;
  let pagesWalked = 0;
  let stoppedBy: "completed walk" | "delete cap" | "page cap" = "page cap";

  for (let page = 0; page < R2_ORPHAN_MAX_PAGES_PER_RUN; page++) {
    const { listed, restarted } = await listOrphanPage({
      bucket,
      kv,
      cursor,
      allowStaleCursorRetry: page === 0 && cursor !== undefined,
    });
    const pageCursor = restarted ? undefined : cursor;

    pagesWalked += 1;

    const orphans = await findOrphanKeys(
      listed.objects
        .filter((object) => object.uploaded < oldestSweepable)
        .map((object) => object.key),
    );

    // The cap has to cut inside the page, not after every orphan on it is already gone.
    const { deletedCount: deletedOnPage, hitBudget } = await deleteOrphansWithinBudget({
      bucket,
      orphans,
      budget: R2_ORPHAN_MAX_DELETES_PER_RUN - deletedCount,
    });

    deletedCount += deletedOnPage;

    if (hitBudget) {
      // Park the start of this page, not its end: the keys deleted above are gone, so re-listing
      // the same page next run is idempotent and gives the orphans it still holds their turn.
      await saveOrphanCursor({ kv, cursor: pageCursor });
      stoppedBy = "delete cap";
      break;
    }

    if (!listed.truncated) {
      await saveOrphanCursor({ kv, cursor: undefined });
      stoppedBy = "completed walk";
      break;
    }

    cursor = listed.cursor;
    await saveOrphanCursor({ kv, cursor });
  }

  console.info(
    `purgeOrphanedR2Objects: run finished at ${stoppedBy}`,
    { deletedCount, pagesWalked },
  );

  return deletedCount;
}
