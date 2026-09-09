import "server-only";

import { and, inArray } from "drizzle-orm";

import { getDB } from "@/db";
import { apiKeyTable } from "@/db/schema";
import { isDeadApiKey } from "@/lib/api-keys/liveness";
import { chunk } from "@/utils/chunk";
import { deleteApiKeyCache } from "@/utils/kv-api-key";
import { mapInBatches } from "@/utils/map-in-batches";

/**
 * The one path that deletes API keys: an owner revoke, a ban, a role demotion, and the retention
 * sweep all run this. It carries no guard of its own, so only call it behind one.
 */

/** D1 caps bound parameters at SQLite's 100 per statement, and one key id costs one. */
const DELETE_ID_CHUNK_SIZE = 50;

/** KV purges in flight at once. Each one costs a subrequest against the Worker's own budget. */
const CACHE_PURGE_BATCH_SIZE = 25;

/**
 * Delete the named keys and drop their KV snapshots, chunk by chunk.
 *
 * Each chunk is stamped `revokedAt`, then deleted, then its snapshots are dropped. Stamp first
 * because a chunk the DELETE cannot take is then already dead, so the retention sweep — which
 * collects only revoked or expired rows — still comes back for it instead of leaving it live.
 *
 * Every chunk is attempted even after one throws, and the first failure is rethrown once the rest
 * are done. Snapshots follow the rows, because the row is what names the snapshot.
 *
 * Returns the number of rows that actually left D1, so a caller reporting a count to staff never
 * claims a chunk that failed.
 */
export async function deleteApiKeysByIds({
  ids,
  onlyDeadAt,
}: {
  ids: readonly string[];
  /**
   * Delete a key only while it is dead at this instant. Re-states inside both statements the rule
   * the retention sweep's own SELECT applied, so a key that came back to life survives.
   */
  onlyDeadAt?: Date | undefined;
}): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const db = getDB();
  const isDead = onlyDeadAt ? isDeadApiKey({ now: onlyDeadAt }) : undefined;
  let deletedCount = 0;
  let failure: unknown;

  for (const batch of chunk({ items: ids, size: DELETE_ID_CHUNK_SIZE })) {
    // A stamped row stays dead under `isDead`, so the DELETE below still matches it.
    const where = and(inArray(apiKeyTable.id, batch), isDead);

    try {
      await db.update(apiKeyTable).set({ revokedAt: new Date() }).where(where);

      const deleted = await db
        .delete(apiKeyTable)
        .where(where)
        .returning({ keyHash: apiKeyTable.keyHash });

      deletedCount += deleted.length;

      await mapInBatches({
        items: deleted,
        batchSize: CACHE_PURGE_BATCH_SIZE,
        fn: ({ keyHash }) => deleteApiKeyCache({ keyHash }),
      });
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure !== undefined) {
    throw new Error("API key chunk deletion failed", { cause: failure });
  }

  return deletedCount;
}
