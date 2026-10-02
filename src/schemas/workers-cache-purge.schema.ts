import { CACHE_TAG_MAX_LENGTH, WORKERS_CACHE_PURGE_MAX_TAGS } from "@/constants";
import { v } from "@/lib/validation";

// The body `purgeWorkersCacheTags` sends to `WORKERS_CACHE_PURGE_PATH`. Strict, so a typo in a
// field fails loudly instead of purging nothing.
export const workersCachePurgeBodySchema = v.strictObject({
  tags: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(CACHE_TAG_MAX_LENGTH))),
    v.minLength(1),
    v.maxLength(WORKERS_CACHE_PURGE_MAX_TAGS),
  ),
});

export type WorkersCachePurgeBody = v.InferOutput<typeof workersCachePurgeBodySchema>;
