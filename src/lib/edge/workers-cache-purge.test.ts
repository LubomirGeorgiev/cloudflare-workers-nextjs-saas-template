import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  enteredSpans,
  fakeSpan,
  loopbackFetchMock,
  spanAttributes,
  workerExports,
  workersCache,
} = vi.hoisted(() => {
  const attributes = new Map<string, unknown>();
  // Mutable, because outside a request the runtime proxy answers `undefined` for `purge`.
  const cache: { purge?: (options: CachePurgeOptions) => Promise<CachePurgeResult> } = {};
  // Mutable, because a runtime without `ctx.exports` gives no `default` loopback.
  const exports: { default?: (options: { props?: unknown }) => { fetch: unknown } } = {};
  const span = {
    isTraced: true,
    recordException: vi.fn(),
    setAttribute: vi.fn((key: string, value: unknown) => {
      attributes.set(key, value);

      return span;
    }),
    setAttributes: vi.fn(),
  };

  return {
    enteredSpans: [] as string[],
    fakeSpan: span,
    loopbackFetchMock: vi.fn(async (__request: Request) => Response.json({ outcome: "ok" })),
    spanAttributes: attributes,
    workerExports: exports,
    workersCache: cache,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  cache: workersCache,
  exports: workerExports,
  tracing: {
    enterSpan: (name: string, callback: (span: unknown) => unknown) => {
      enteredSpans.push(name);

      return callback(fakeSpan);
    },
  },
}));

const { CACHE_TAG_MAX_LENGTH, SITE_DOMAIN, WORKERS_CACHE_PURGE_MAX_TAGS, WORKERS_CACHE_PURGE_PATH, ZONE_PURGE_TAGS_PER_REQUEST } =
  await import("@/constants");
const { CACHE_TAGS } = await import("@/constants/cache-tags");
const {
  purgeWorkersCacheTags,
  purgeWorkersCacheTagsInRequestContext,
  WORKERS_CACHE_PURGE_OUTCOME,
} = await import("@/lib/edge/workers-cache-purge");
const { purgeWorkersCacheAfterWrite } = await import("@/lib/edge/purge-workers-cache-after-write");
const { isWorkersCachePurgeLoopback } = await import("@/lib/edge/workers-cache-purge-props");

const SPAN_NAME = "app.cms.cdn_purge";
const OUTCOME_ATTRIBUTE = "app.cms.outcome";
const TAG_COUNT_ATTRIBUTE = "app.cms.tag_count";

function entryTags(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    CACHE_TAGS.cmsEntry({ collectionSlug: "blog", slug: `entry-${index}` }));
}

function purgeAccepting(): ReturnType<typeof vi.fn> {
  const purge = vi.fn(async (__options: CachePurgeOptions) => ({ success: true, errors: [] }));
  workersCache.purge = purge;

  return purge;
}

beforeEach(() => {
  workerExports.default = vi.fn(() => ({ fetch: loopbackFetchMock }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete workersCache.purge;
  delete workerExports.default;
  enteredSpans.length = 0;
  spanAttributes.clear();
});

describe("purgeWorkersCacheTags in a request context", () => {
  test("it dedupes the tags and sends at most one chunk per purge call", async () => {
    const purge = purgeAccepting();
    const tags = entryTags(ZONE_PURGE_TAGS_PER_REQUEST + 1);

    await purgeWorkersCacheTags({ tags: [...tags, tags[0] ?? "", ""] });

    expect(purge).toHaveBeenCalledTimes(2);
    expect(purge).toHaveBeenNthCalledWith(1, { tags: tags.slice(0, ZONE_PURGE_TAGS_PER_REQUEST) });
    expect(purge).toHaveBeenNthCalledWith(2, { tags: tags.slice(ZONE_PURGE_TAGS_PER_REQUEST) });
    expect(loopbackFetchMock).not.toHaveBeenCalled();
    expect(enteredSpans).toEqual([SPAN_NAME]);
    expect(spanAttributes.get(TAG_COUNT_ATTRIBUTE)).toBe(tags.length);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.OK);
  });

  test("a refused purge is logged and reported, never thrown", async () => {
    workersCache.purge = vi.fn(async () => ({
      success: false,
      errors: [{ code: 1, message: "rate limited" }],
    }));

    await expect(purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] })).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.FAILED);
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  test("a purge that throws is logged and reported, never thrown", async () => {
    workersCache.purge = vi.fn(async () => {
      throw new Error("purge exploded");
    });

    await expect(purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] })).resolves.toBeUndefined();

    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.FAILED);
    expect(fakeSpan.recordException).toHaveBeenCalledTimes(1);
  });

  // Cloudflare refuses a whole chunk for one bad tag, so the other tags must still go out.
  test("an over-long tag is dropped with a log, and the other tags are purged", async () => {
    const purge = purgeAccepting();

    await purgeWorkersCacheTags({ tags: ["t".repeat(CACHE_TAG_MAX_LENGTH + 1), CACHE_TAGS.SITEMAP] });

    expect(purge).toHaveBeenCalledWith({ tags: [CACHE_TAGS.SITEMAP] });
    expect(console.error).toHaveBeenCalled();
    expect(spanAttributes.get(TAG_COUNT_ATTRIBUTE)).toBe(1);
  });

  test("only over-long tags opens no span and purges nothing", async () => {
    const purge = purgeAccepting();

    await purgeWorkersCacheTags({ tags: ["t".repeat(CACHE_TAG_MAX_LENGTH + 1)] });

    expect(purge).not.toHaveBeenCalled();
    expect(enteredSpans).toEqual([]);
  });

  test("no tags opens no span and purges nothing", async () => {
    const purge = purgeAccepting();

    await purgeWorkersCacheTags({ tags: [] });

    expect(purge).not.toHaveBeenCalled();
    expect(enteredSpans).toEqual([]);
  });

  test("no attribute holds tag text", async () => {
    purgeAccepting();

    await purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] });

    expect(Array.from(spanAttributes.values())).not.toContain(CACHE_TAGS.SITEMAP);
  });
});

describe("purgeWorkersCacheTags without a request context", () => {
  test("it delegates over the loopback to the internal route with the purge props", async () => {
    const tags = [CACHE_TAGS.SITEMAP, CACHE_TAGS.CMS_TAGS];

    await purgeWorkersCacheTags({ tags });

    expect(workerExports.default).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(workerExports.default)?.mock.calls[0] ?? [];
    expect(isWorkersCachePurgeLoopback(options?.props)).toBe(true);
    expect(loopbackFetchMock).toHaveBeenCalledTimes(1);
    const [request] = loopbackFetchMock.mock.calls[0] ?? [];
    expect(request?.url).toBe(`https://${SITE_DOMAIN}${WORKERS_CACHE_PURGE_PATH}`);
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBeNull();
    expect(await request?.json()).toEqual({ tags });
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.DELEGATED);
  });

  test("it splits a tag list above the route's limit into one request per chunk", async () => {

    await purgeWorkersCacheTags({ tags: entryTags(WORKERS_CACHE_PURGE_MAX_TAGS + 1) });

    expect(loopbackFetchMock).toHaveBeenCalledTimes(2);
  });

  test("a delegation the route never answered is logged and reported, never thrown", async () => {
    loopbackFetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] })).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.FAILED);
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  // The route span reports the failed purge; this span reports only the hand-off.
  test("a delegation the route answered with a failed purge reports `delegated`", async () => {
    loopbackFetchMock.mockResolvedValueOnce(
      Response.json({ outcome: WORKERS_CACHE_PURGE_OUTCOME.FAILED }, { status: 502 }),
    );

    await purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] });

    expect(console.error).toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.DELEGATED);
  });

  test("a delegation that throws records the exception and reports `failed`", async () => {
    loopbackFetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] })).resolves.toBeUndefined();

    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.FAILED);
    expect(fakeSpan.recordException).toHaveBeenCalledTimes(1);
  });

  test("without a loopback it skips with a log and sends nothing", async () => {
    delete workerExports.default;

    await purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] });

    expect(loopbackFetchMock).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalled();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(
      WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE,
    );
  });
});

describe("purgeWorkersCacheTagsInRequestContext", () => {
  // The route runs this; a delegation from there would call the route again.
  test("without a purge it reports unavailable and never delegates", async () => {

    const outcome = await purgeWorkersCacheTagsInRequestContext({ tags: [CACHE_TAGS.SITEMAP] });

    expect(outcome).toBe(WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE);
    expect(loopbackFetchMock).not.toHaveBeenCalled();
  });
});

describe("purgeWorkersCacheAfterWrite", () => {
  test("a failed purge never rejects into the write that ran before it", async () => {
    workersCache.purge = vi.fn(async () => {
      throw new Error("purge exploded");
    });

    await expect(
      purgeWorkersCacheAfterWrite({ tags: [CACHE_TAGS.SITEMAP] }),
    ).resolves.toBeUndefined();
    expect(workersCache.purge).toHaveBeenCalledWith({ tags: [CACHE_TAGS.SITEMAP] });
  });
});
