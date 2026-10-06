import "server-only";

import {
  WORKERS_CACHE_PURGE_OUTCOME,
  type WorkersCachePurgeOutcome,
} from "@/constants/cache-purge";

/**
 * Sends the Workers Caching purge for a write that already landed. Call it after the KV tag
 * invalidation, so an edge refetch reads new data, and before a warm, so the warm misses the edge.
 * Never throws; returns the purge outcome.
 */
export async function purgeWorkersCacheAfterWrite({
  tags,
}: {
  tags: readonly string[];
}): Promise<WorkersCachePurgeOutcome> {
  try {
    // Lazy, so no caller pulls the purge module onto its startup graph.
    const { purgeWorkersCacheTags } = await import("@/lib/edge/workers-cache-purge");

    return await purgeWorkersCacheTags({ tags });
  } catch (error) {
    // The write is committed; a purge fault leaves the edge copy to its TTL.
    console.error("Workers Caching purge could not run", error);
    return WORKERS_CACHE_PURGE_OUTCOME.FAILED;
  }
}
