import "server-only";

import { CACHE_TAG_MAX_LENGTH, WORKERS_CACHE_PURGE_MAX_TAGS } from "@/constants";
import {
  purgeWorkersCacheTagsInRequestContext,
  WORKERS_CACHE_PURGE_OUTCOME,
  type WorkersCachePurgeRouteOutcome,
} from "@/lib/edge/workers-cache-purge";
import { v } from "@/lib/validation";
import { workersCachePurgeBodySchema } from "@/schemas/workers-cache-purge.schema";
import { readBoundedRequestBody } from "@/utils/bounded-request-body";

// Each tag is a JSON string: two quotes and a comma around it, plus the object wrapper.
const MAX_BODY_BYTES = WORKERS_CACHE_PURGE_MAX_TAGS * (CACHE_TAG_MAX_LENGTH + 3) + 64;

const STATUS_BY_OUTCOME: Record<WorkersCachePurgeRouteOutcome, number> = {
  [WORKERS_CACHE_PURGE_OUTCOME.OK]: 200,
  [WORKERS_CACHE_PURGE_OUTCOME.FAILED]: 502,
  [WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE]: 503,
};

/**
 * The route behind `WORKERS_CACHE_PURGE_PATH`: runs `cache.purge` for a caller that has no request
 * context. `worker-entrypoint.ts` calls it only for a request with `WORKERS_CACHE_PURGE_PROPS`.
 */
export async function handleWorkersCachePurgeRequest({
  request,
}: {
  request: Request;
}): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ status: 405, body: { error: "method_not_allowed" }, allow: "POST" });
  }

  const tags = await readTags(request);

  if (!tags) {
    return jsonResponse({ status: 400, body: { error: "invalid_body" } });
  }

  const outcome = await purgeWorkersCacheTagsInRequestContext({ tags });

  return jsonResponse({ status: STATUS_BY_OUTCOME[outcome], body: { outcome } });
}

async function readTags(request: Request): Promise<string[] | null> {
  const { text } = await readBoundedRequestBody({ request, maxBytes: MAX_BODY_BYTES });

  if (!text) {
    return null;
  }

  try {
    const parsed = v.safeParse(workersCachePurgeBodySchema, JSON.parse(text));

    return parsed.success ? parsed.output.tags : null;
  } catch {
    return null;
  }
}

function jsonResponse({
  status,
  body,
  allow,
}: {
  status: number;
  body: Record<string, string>;
  allow?: string;
}): Response {
  const headers = new Headers({ "cache-control": "no-store" });

  if (allow) {
    headers.set("allow", allow);
  }

  return Response.json(body, { status, headers });
}
