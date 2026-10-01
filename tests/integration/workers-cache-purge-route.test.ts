/// <reference types="@cloudflare/vitest-plugin/types" />

// The internal route a queue or cron publish calls over the `ctx.exports` loopback to purge Workers
// Caching, through the real Worker entrypoint and the runtime `cache` proxy.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";

import { WORKERS_CACHE_PURGE_MAX_TAGS, WORKERS_CACHE_PURGE_PATH } from "@/constants";
import { CACHE_TAGS } from "@/constants/cache-tags";
import { WORKERS_CACHE_PURGE_OUTCOME } from "@/lib/edge/workers-cache-purge";
import { WORKERS_CACHE_PURGE_PROPS } from "@/lib/edge/workers-cache-purge-props";

const { appNotFound, innerFetchMock } = vi.hoisted(() => {
  const notFound = (): Response => new Response("Not Found", { status: 404 });

  return { appNotFound: notFound, innerFetchMock: vi.fn(async () => notFound()) };
});

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

const { default: worker } = await import("../../worker-entrypoint");

// The test config sets no `main`, so `ctx.exports` is not this Worker; the props go on directly.
function loopbackContext(): ExecutionContext {
  const ctx = createExecutionContext();
  Object.defineProperty(ctx, "props", { value: WORKERS_CACHE_PURGE_PROPS });

  return ctx;
}

function postPurge({ body, ctx }: { body: unknown; ctx: ExecutionContext }): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${WORKERS_CACHE_PURGE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );
}

describe("the Workers Caching purge route", () => {
  // An internet request cannot set props, so it must get the app's answer and no purge.
  test("a public request without the props gets the app's not-found answer", async () => {
    const response = await postPurge({
      body: { tags: [CACHE_TAGS.SITEMAP] },
      ctx: createExecutionContext(),
    });

    expect(innerFetchMock).toHaveBeenCalled();
    expect(response.status).toBe(appNotFound().status);
    expect(await response.text()).not.toContain(WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE);
  });

  test("an oversized tag list is refused", async () => {
    const tags = Array.from({ length: WORKERS_CACHE_PURGE_MAX_TAGS + 1 }, (_, index) =>
      CACHE_TAGS.cmsEntry({ collectionSlug: "blog", slug: `entry-${index}` }));

    const response = await postPurge({ body: { tags }, ctx: loopbackContext() });

    expect(response.status).toBe(400);
  });

  // workerd gives no `cache.purge` to a local Worker, so a loopback request reaches the purge and
  // reports it unavailable. In production the same request purges and answers 200.
  test("a loopback request with the props reaches the purge before the app", async () => {
    innerFetchMock.mockClear();

    const response = await postPurge({ body: { tags: [CACHE_TAGS.SITEMAP] }, ctx: loopbackContext() });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ outcome: WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE });
    expect(innerFetchMock).not.toHaveBeenCalled();
  });
});
