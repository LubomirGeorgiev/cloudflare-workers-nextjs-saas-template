import "server-only";

import { cache as workersCache, exports as workerExports } from "cloudflare:workers";

import {
  CACHE_TAG_MAX_LENGTH,
  SITE_DOMAIN,
  WORKERS_CACHE_PURGE_MAX_TAGS,
  WORKERS_CACHE_PURGE_PATH,
  ZONE_PURGE_TAGS_PER_REQUEST,
} from "@/constants";
import { WORKERS_CACHE_PURGE_PROPS } from "@/lib/edge/workers-cache-purge-props";
import type { WorkersCachePurgeBody } from "@/schemas/workers-cache-purge.schema";
import { chunk } from "@/utils/chunk";
import { recordSpanException, withSpan } from "@/utils/trace";

const PURGE_SPAN_NAME = "app.cms.cdn_purge";
const OUTCOME_ATTRIBUTE = "app.cms.outcome";
const TAG_COUNT_ATTRIBUTE = "app.cms.tag_count";

export const WORKERS_CACHE_PURGE_OUTCOME = {
  OK: "ok",
  FAILED: "failed",
  // No request context here, so the route at `WORKERS_CACHE_PURGE_PATH` ran the purge.
  DELEGATED: "delegated",
  SKIPPED_UNAVAILABLE: "skipped_unavailable",
} as const;

export type WorkersCachePurgeOutcome =
  (typeof WORKERS_CACHE_PURGE_OUTCOME)[keyof typeof WORKERS_CACHE_PURGE_OUTCOME];

/** The route purges in its own request context, so only a caller span ever reports `delegated`. */
export type WorkersCachePurgeRouteOutcome = Exclude<
  WorkersCachePurgeOutcome,
  typeof WORKERS_CACHE_PURGE_OUTCOME.DELEGATED
>;

/**
 * Purges the Workers Caching entries that carry any of `tags`, the outer edge layer that
 * `revalidateCacheTag` never reaches. Outside a request (queue, cron) `cache.purge` does not exist,
 * so one loopback request through `exports.default` to `WORKERS_CACHE_PURGE_PATH` runs it instead.
 * Never throws.
 */
export async function purgeWorkersCacheTags({ tags }: { tags: readonly string[] }): Promise<void> {
  await tracePurge({ tags, purge: purgeOrDelegate });
}

/** The route's half: purge here or report `skipped_unavailable`, and never delegate again. */
export function purgeWorkersCacheTagsInRequestContext({
  tags,
}: {
  tags: readonly string[];
}): Promise<WorkersCachePurgeRouteOutcome> {
  return tracePurge({ tags, purge: purgeInRequestContext });
}

async function tracePurge<TOutcome extends WorkersCachePurgeOutcome>({
  tags,
  purge,
}: {
  tags: readonly string[];
  purge: (input: PurgeInput) => Promise<TOutcome>;
}): Promise<TOutcome | WorkersCachePurgeRouteOutcome> {
  const uniqueTags = Array.from(new Set(tags.filter((tag) => tag.length > 0)));
  const purgeableTags = uniqueTags.filter((tag) => tag.length <= CACHE_TAG_MAX_LENGTH);

  // One over-long tag would make Cloudflare or the route refuse its whole chunk.
  if (purgeableTags.length < uniqueTags.length) {
    console.error("Workers Caching purge dropped over-long tags", {
      count: uniqueTags.length - purgeableTags.length,
    });
  }

  if (purgeableTags.length === 0) {
    return WORKERS_CACHE_PURGE_OUTCOME.OK;
  }

  return withSpan({
    name: PURGE_SPAN_NAME,
    run: async (span) => {
      span.setAttribute(TAG_COUNT_ATTRIBUTE, purgeableTags.length);

      let outcome: TOutcome | WorkersCachePurgeRouteOutcome;
      try {
        outcome = await purge({ tags: purgeableTags, span });
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
}

/** The type says always present, but the runtime gives no `cache.purge` outside a request context. */
export function isWorkersCachePurgeAvailable(): boolean {
  return typeof workersCache.purge === "function";
}

async function purgeOrDelegate(input: PurgeInput): Promise<WorkersCachePurgeOutcome> {
  return isWorkersCachePurgeAvailable() ? runCachePurge(input) : delegatePurge(input);
}

async function purgeInRequestContext(input: PurgeInput): Promise<WorkersCachePurgeRouteOutcome> {
  return isWorkersCachePurgeAvailable()
    ? runCachePurge(input)
    : WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE;
}

// Only after `isWorkersCachePurgeAvailable` returned true.
async function runCachePurge({ tags, span }: PurgeInput): Promise<WorkersCachePurgeRouteOutcome> {
  const failed = await purgeEachChunk({
    tags,
    size: ZONE_PURGE_TAGS_PER_REQUEST,
    span,
    purgeChunk: async (tagChunk) => {
      const result = await workersCache.purge({ tags: tagChunk });

      if (!result.success) {
        console.error("Workers Caching purge refused", result.errors);
      }

      return result.success;
    },
  });

  return failed ? WORKERS_CACHE_PURGE_OUTCOME.FAILED : WORKERS_CACHE_PURGE_OUTCOME.OK;
}

async function delegatePurge({ tags, span }: PurgeInput): Promise<WorkersCachePurgeOutcome> {
  // Typed as always present, but a runtime without `ctx.exports` gives no loopback.
  const loopback: unknown = workerExports?.default;

  if (typeof loopback !== "function") {
    console.info("Workers Caching purge skipped: no request context and no loopback");
    return WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE;
  }

  // The main entrypoint, because Workers Caching purges only the cache of the calling entrypoint.
  const worker = workerExports.default({ props: WORKERS_CACHE_PURGE_PROPS });

  const failed = await purgeEachChunk({
    tags,
    size: WORKERS_CACHE_PURGE_MAX_TAGS,
    span,
    purgeChunk: async (tagChunk) => {
      const body: WorkersCachePurgeBody = { tags: tagChunk };
      const response = await worker.fetch(new Request(`https://${SITE_DOMAIN}${WORKERS_CACHE_PURGE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }));
      const routeOutcome = await readRouteOutcome(response);

      // A route outcome means the route span reports the purge result, so this span reports only
      // the hand-off (docs/tracing.md, parent and child spans).
      if (!routeOutcome) {
        console.error("Workers Caching purge request failed", { status: response.status });
      } else if (!response.ok) {
        console.error("Workers Caching purge route did not purge", { outcome: routeOutcome });
      }

      return routeOutcome !== null;
    },
  });

  return failed ? WORKERS_CACHE_PURGE_OUTCOME.FAILED : WORKERS_CACHE_PURGE_OUTCOME.DELEGATED;
}

/** Returns true when any chunk failed. `purgeChunk` returns false for a refused chunk. */
async function purgeEachChunk({
  tags,
  size,
  span,
  purgeChunk,
}: {
  tags: string[];
  size: number;
  span: Span;
  purgeChunk: (tagChunk: string[]) => Promise<boolean>;
}): Promise<boolean> {
  let failed = false;

  // Sequential, because the tag list of a full CMS clear grows with the entry count. A throw must
  // not stop the loop, because each chunk that it skips stays cached until its edge copy expires.
  for (const tagChunk of chunk({ items: tags, size })) {
    try {
      if (!(await purgeChunk(tagChunk))) {
        failed = true;
      }
    } catch (error) {
      failed = true;
      console.error("Workers Caching purge chunk failed", error);
      recordSpanException({ span, error });
    }
  }

  return failed;
}

// `null` when the answer did not come from the route's purge step (props, body, or transport).
async function readRouteOutcome(response: Response): Promise<WorkersCachePurgeRouteOutcome | null> {
  const body: unknown = await response.json().catch(() => null);
  const outcome = typeof body === "object" && body !== null && "outcome" in body
    ? body.outcome
    : null;

  return ROUTE_OUTCOMES.find((known) => known === outcome) ?? null;
}

const ROUTE_OUTCOMES: readonly WorkersCachePurgeRouteOutcome[] = [
  WORKERS_CACHE_PURGE_OUTCOME.OK,
  WORKERS_CACHE_PURGE_OUTCOME.FAILED,
  WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE,
];

interface PurgeInput {
  tags: string[];
  span: Span;
}
