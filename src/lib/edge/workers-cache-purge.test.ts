import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  enteredSpans,
  fakeSpan,
  spanAttributes,
  workersCache,
} = vi.hoisted(() => {
  const attributes = new Map<string, unknown>();
  // Mutable, because local workerd answers `undefined` for `purge`.
  const cache: { purge?: (options: CachePurgeOptions) => Promise<CachePurgeResult> } = {};
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
    spanAttributes: attributes,
    workersCache: cache,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  cache: workersCache,
  tracing: {
    enterSpan: (name: string, callback: (span: unknown) => unknown) => {
      enteredSpans.push(name);

      return callback(fakeSpan);
    },
  },
}));

const { CACHE_TAG_MAX_LENGTH, ZONE_PURGE_TAGS_PER_REQUEST } = await import("@/constants");
const { CACHE_TAGS } = await import("@/constants/cache-tags");
const { purgeWorkersCacheTags, WORKERS_CACHE_PURGE_OUTCOME } = await import("@/lib/edge/workers-cache-purge");
const { purgeWorkersCacheAfterWrite } = await import("@/lib/edge/purge-workers-cache-after-write");

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
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete workersCache.purge;
  enteredSpans.length = 0;
  spanAttributes.clear();
});

describe("purgeWorkersCacheTags", () => {
  test("it dedupes the tags and sends at most one chunk per purge call", async () => {
    const purge = purgeAccepting();
    const tags = entryTags(ZONE_PURGE_TAGS_PER_REQUEST + 1);

    await purgeWorkersCacheTags({ tags: [...tags, tags[0] ?? "", ""] });

    expect(purge).toHaveBeenCalledTimes(2);
    expect(purge).toHaveBeenNthCalledWith(1, { tags: tags.slice(0, ZONE_PURGE_TAGS_PER_REQUEST) });
    expect(purge).toHaveBeenNthCalledWith(2, { tags: tags.slice(ZONE_PURGE_TAGS_PER_REQUEST) });
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

  // A full CMS clear can span many chunks; one throw must not leave the later ones cached.
  test("a chunk that throws is logged and recorded, and the next chunk is still purged", async () => {
    const purge = purgeAccepting();
    purge.mockRejectedValueOnce(new Error("purge exploded"));
    const tags = entryTags(ZONE_PURGE_TAGS_PER_REQUEST + 1);

    await expect(purgeWorkersCacheTags({ tags })).resolves.toBeUndefined();

    expect(purge).toHaveBeenCalledTimes(2);
    expect(purge).toHaveBeenNthCalledWith(2, { tags: tags.slice(ZONE_PURGE_TAGS_PER_REQUEST) });
    expect(console.error).toHaveBeenCalled();
    expect(fakeSpan.recordException).toHaveBeenCalledTimes(1);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(WORKERS_CACHE_PURGE_OUTCOME.FAILED);
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

describe("purgeWorkersCacheTags without cache.purge", () => {
  test("it reports unavailable and never throws", async () => {
    await expect(purgeWorkersCacheTags({ tags: [CACHE_TAGS.SITEMAP] })).resolves.toBeUndefined();

    expect(enteredSpans).toEqual([SPAN_NAME]);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(
      WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE,
    );
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
