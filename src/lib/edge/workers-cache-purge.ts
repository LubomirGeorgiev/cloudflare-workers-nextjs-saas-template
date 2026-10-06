import "server-only";

import { cache as workersCache } from "cloudflare:workers";

import { CACHE_TAG_MAX_LENGTH, ZONE_PURGE_TAGS_PER_REQUEST } from "@/constants";
import {
  WORKERS_CACHE_PURGE_OUTCOME,
  type WorkersCachePurgeOutcome,
} from "@/constants/cache-purge";
import { chunk } from "@/utils/chunk";
import { recordSpanException, withSpan } from "@/utils/trace";

const PURGE_SPAN_NAME = "app.cms.cdn_purge";
const OUTCOME_ATTRIBUTE = "app.cms.outcome";
const TAG_COUNT_ATTRIBUTE = "app.cms.tag_count";

/**
 * Purges the Workers Caching entries that carry any of `tags`, the outer edge layer that
 * `revalidateCacheTag` never reaches. Every handler has `cache.purge`, the queue consumer included.
 * A purge reaches only its own entrypoint's cache (see `docs/edge-caching.md`). Never throws.
 * Returns `failed` when a tag was not purged, so a caller can tell the user that a copy stays.
 */
export async function purgeWorkersCacheTags({
  tags,
}: {
  tags: readonly string[];
}): Promise<WorkersCachePurgeOutcome> {
  const uniqueTags = Array.from(new Set(tags.filter((tag) => tag.length > 0)));
  const purgeableTags = uniqueTags.filter((tag) => tag.length <= CACHE_TAG_MAX_LENGTH);
  const droppedTags = purgeableTags.length < uniqueTags.length;

  // One over-long tag would make Cloudflare refuse its whole chunk.
  if (droppedTags) {
    console.error("Workers Caching purge dropped over-long tags", {
      count: uniqueTags.length - purgeableTags.length,
    });
  }

  if (purgeableTags.length === 0) {
    return droppedTags ? WORKERS_CACHE_PURGE_OUTCOME.FAILED : WORKERS_CACHE_PURGE_OUTCOME.OK;
  }

  const outcome = await withSpan({
    name: PURGE_SPAN_NAME,
    run: async (span) => {
      span.setAttribute(TAG_COUNT_ATTRIBUTE, purgeableTags.length);

      let outcome: WorkersCachePurgeOutcome;
      try {
        outcome = isWorkersCachePurgeAvailable()
          ? await runCachePurge({ tags: purgeableTags, span })
          : WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE;
      } catch (error) {
        // A failed purge leaves the entries to their TTL; it must never fail the write before it.
        console.error("Workers Caching purge failed", error);
        recordSpanException({ span, error });
        outcome = WORKERS_CACHE_PURGE_OUTCOME.FAILED;
      }

      span.setAttribute(OUTCOME_ATTRIBUTE, outcome);

      return outcome;
    },
  });

  return droppedTags ? WORKERS_CACHE_PURGE_OUTCOME.FAILED : outcome;
}

/** The type says always present, but local workerd gives no `cache.purge`. */
export function isWorkersCachePurgeAvailable(): boolean {
  return typeof workersCache.purge === "function";
}

// Only after `isWorkersCachePurgeAvailable` returned true.
async function runCachePurge({
  tags,
  span,
}: {
  tags: string[];
  span: Span;
}): Promise<WorkersCachePurgeOutcome> {
  let failed = false;

  // Sequential, because the tag list of a full CMS clear grows with the entry count. A throw must
  // not stop the loop, because each chunk that it skips stays cached until its edge copy expires.
  for (const tagChunk of chunk({ items: tags, size: ZONE_PURGE_TAGS_PER_REQUEST })) {
    try {
      const result = await workersCache.purge({ tags: tagChunk });

      if (!result.success) {
        failed = true;
        console.error("Workers Caching purge refused", result.errors);
      }
    } catch (error) {
      failed = true;
      console.error("Workers Caching purge chunk failed", error);
      recordSpanException({ span, error });
    }
  }

  return failed ? WORKERS_CACHE_PURGE_OUTCOME.FAILED : WORKERS_CACHE_PURGE_OUTCOME.OK;
}
