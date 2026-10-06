/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createKvKeySpace } from "@vinext/cloudflare/cache/kv-key";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { VINEXT_CACHE_PREFIX } from "@/constants/kv-prefixes";
import {
  CMS_INVALIDATION_SCOPES,
  SITE_HEADER_CACHE_TAGS,
} from "@/lib/cms/cms-invalidation-scopes";
import {
  createScheduledQueueMessage,
  SCHEDULED_JOB_TYPES,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";

// Vinext keeps its handler registry on `globalThis`, so a reset must clear these keys and reload
// the modules that hold a once-per-isolate flag. `loadFreshWorker` refuses a reset that did not work.
const VINEXT_HANDLER_KEYS = [
  "vinext.cacheHandler",
  "vinext.configuredCacheHandler",
  "vinext.explicitCacheHandler",
  "vinext.lazyCacheHandler",
].map((name) => Symbol.for(name));
const API_PATH_TAG = "data-cache-registration-api";
const tagKeys = createKvKeySpace(VINEXT_CACHE_PREFIX);

// The page handler is the one place Vinext registers the adapter itself, so it must not run here.
vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: vi.fn(async () => new Response("unexpected page render", { status: 500 })) },
}));

async function loadFreshWorker() {
  for (const key of VINEXT_HANDLER_KEYS) {
    Reflect.deleteProperty(globalThis, key);
  }
  vi.resetModules();

  const [{ default: worker }, { getDataCacheHandler, MemoryCacheHandler }] = await Promise.all([
    import("../../worker-entrypoint"),
    import("vinext/shims/cache-handler"),
  ]);

  // Otherwise a renamed registry key would let both tests pass without the fix.
  if (!(getDataCacheHandler() instanceof MemoryCacheHandler)) {
    throw new Error("The Vinext data cache registry did not reset; re-check its global keys.");
  }

  return { getDataCacheHandler, MemoryCacheHandler, worker };
}

function readTagMarker(tag: string): Promise<string | null> {
  return env.KV_STORE.get(tagKeys.tagKey(tag));
}

// The consumer reads only the body, the attempt count, and the two settle calls.
function queueBatch(body: ScheduledQueueMessage) {
  const message = {
    id: "message-1",
    attempts: 1,
    body,
    timestamp: new Date(),
    ack: vi.fn(),
    retry: vi.fn(),
  };

  return {
    message,
    batch: {
      queue: "scheduler",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<ScheduledQueueMessage>,
  };
}

describe("the KV data cache outside a page request", () => {
  let fresh: Awaited<ReturnType<typeof loadFreshWorker>>;

  beforeEach(async () => {
    fresh = await loadFreshWorker();
  });

  test("a queued CMS repurge writes its tag drops to KV", async () => {
    const { batch, message } = queueBatch(createScheduledQueueMessage({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { scopes: [CMS_INVALIDATION_SCOPES.SITE_HEADER] },
      runAt: new Date(Date.now() - 1000),
    }));
    const ctx = createExecutionContext();

    await fresh.worker.queue(batch, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(message.ack).toHaveBeenCalledOnce();
    for (const tag of SITE_HEADER_CACHE_TAGS) {
      expect(await readTagMarker(tag)).not.toBeNull();
    }
  });

  // An API or MCP request never reaches Vinext's page handler either; any fetch must register.
  test("a fetch that is not a page leaves the KV adapter registered", async () => {
    const ctx = createExecutionContext();

    const response = await fresh.worker.fetch(
      new Request("https://example.com/_worker/health"),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    await fresh.getDataCacheHandler().revalidateTag(API_PATH_TAG);

    expect(response.status).toBe(200);
    expect(fresh.getDataCacheHandler()).not.toBeInstanceOf(fresh.MemoryCacheHandler);
    expect(await readTagMarker(API_PATH_TAG)).not.toBeNull();
  });
});
