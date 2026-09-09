import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";

/**
 * Data retention for rows that outlive their own usefulness.
 *
 * A dead credential is deleted on the next sweep, with no grace period. It is not kept as history,
 * because it was never readable as history: every listing — owner, admin user page, admin team page
 * — filters revoked and expired rows out, and `lastUsedAt` is a throttled usage hint that
 * `kv-api-key.ts` explicitly disclaims as an audit trail. Keeping the row preserved nothing anyone
 * could look at.
 */

/** How often the retention sweep is allowed to run. Its work is never urgent. */
export const RETENTION_SWEEP_INTERVAL_MINUTES = 60 * 6;

/**
 * Rows deleted per table per run. The sweep is idempotent and runs every 6 hours, so a backlog
 * drains over several ticks instead of spending one cron invocation on a single unbounded DELETE.
 */
export const RETENTION_SWEEP_PAGE_SIZE = 100;

/** Chunk size for the `IN (...)` lists the deletes are built from. */
export const RETENTION_DELETE_BATCH_SIZE = 25;

/**
 * Entries whose version history the sweep may cut per run. The write path caps history on save, so
 * this only drains entries that passed the cap and were then never edited again — a small backlog.
 */
export const CMS_VERSION_BACKLOG_PAGE_SIZE = 50;

/** Prunes in flight at once. Each entry costs one SELECT and one DELETE against the D1 budget. */
export const CMS_VERSION_PRUNE_BATCH_SIZE = 5;

/**
 * Whether the cron may delete R2 objects the app never recorded. A fork that writes objects under
 * the CMS prefix from outside the app — `wrangler r2 object put`, a backup restore, an importer —
 * must set this to false before its first cron, because an R2 delete is final.
 */
export const R2_ORPHAN_SWEEP_ENABLED = true;

/**
 * How old an R2 object must be before the orphan sweep will consider it.
 *
 * `upload-image.action.ts` writes the object first and its `cms_media` row second, so an upload in
 * flight is briefly indistinguishable from an orphan. This window has to outlast any request that
 * could still be between those two writes.
 */
export const R2_ORPHAN_MIN_AGE_HOURS = 24;

/** Objects listed per R2 page, and the most pages one run will walk. */
export const R2_ORPHAN_LIST_PAGE_SIZE = 1000;
export const R2_ORPHAN_MAX_PAGES_PER_RUN = 5;

/**
 * Keys per `bucketKey IN (...)` lookup. Each listed page is tested against `cms_media` a chunk at a
 * time, so the sweep never depends on the table fitting in memory and has no row ceiling.
 *
 * Same bound-parameter ceiling `DELETE_ID_CHUNK_SIZE` in `delete-api-keys.ts` chunks against: D1
 * caps bound parameters at 100 per query and one key costs one. 50 keeps the same headroom as that
 * file, in case a caller ever adds a predicate.
 */
export const R2_ORPHAN_LOOKUP_CHUNK_SIZE = 50;

/**
 * Lookup chunks in flight at once. The chunks are independent reads, so they run together, but a
 * whole page at once would spend the run's D1 concurrency budget on one step of the sweep.
 */
export const R2_ORPHAN_LOOKUP_CONCURRENCY = 5;

/** Keys one `bucket.delete(keys)` accepts. R2's own limit, so a longer list has to be sliced. */
export const R2_DELETE_KEYS_PER_CALL = 1000;

/**
 * Objects one run may delete. Not a subrequest bound — a whole page of orphans now costs one delete
 * call — but a blast-radius bound: the sweep runs unattended and an R2 delete is unrecoverable, so a
 * bad reference rule destroys 500 objects per run instead of the bucket.
 */
export const R2_ORPHAN_MAX_DELETES_PER_RUN = 500;

/**
 * Where the R2 list cursor waits between runs, so a bucket larger than one run's page budget still
 * has its tail inspected instead of the head being re-walked forever.
 */
export const R2_ORPHAN_CURSOR_KV_KEY = `${APP_KV_PREFIXES.maintenanceCursor}r2-orphan`;

/**
 * How long a parked cursor lives. One fixed key name closes the key space, but the TTL still has to
 * outlast several sweep intervals: a cursor that expired between two runs would silently send the
 * next walk back to the top, which is the exact failure the cursor exists to prevent.
 */
const R2_ORPHAN_CURSOR_TTL_INTERVALS = 4;
export const R2_ORPHAN_CURSOR_TTL_SECONDS =
  RETENTION_SWEEP_INTERVAL_MINUTES * 60 * R2_ORPHAN_CURSOR_TTL_INTERVALS;
