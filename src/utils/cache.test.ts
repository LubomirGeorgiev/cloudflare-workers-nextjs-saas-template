import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryCacheHandler, setDataCacheHandler } from "vinext/shims/cache-handler";
import { runWithExecutionContext } from "vinext/shims/request-context";

const { cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

// `revalidateTag` stays real: these tests prove the helper waits for Vinext's own write.
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  cacheLife: cacheLifeMock,
  cacheTag: cacheTagMock,
}));

const { CACHE_TAGS, revalidateCacheTag, setCacheScope } = await import("./cache");

describe("cache utilities", () => {
  afterEach(() => {
    vi.clearAllMocks();
    setDataCacheHandler(new MemoryCacheHandler());
  });

  test("applies cache tags and life inside a cache scope", () => {
    setCacheScope({
      tags: ["stats-total-users", "cms-collection-docs"],
      ttl: "1 hour",
    });

    expect(cacheTagMock).toHaveBeenCalledWith("stats-total-users", "cms-collection-docs");
    expect(cacheLifeMock).toHaveBeenCalledWith({
      expire: 3600,
      revalidate: 3600,
    });
  });

  test("allows cache scopes without invalidation tags", () => {
    setCacheScope({
      ttl: "1 hour",
    });

    expect(cacheTagMock).not.toHaveBeenCalled();
    expect(cacheLifeMock).toHaveBeenCalledWith({
      expire: 3600,
      revalidate: 3600,
    });
  });

  test("revalidates a cache tag with stale-while-revalidate semantics", async () => {
    const handler = stubTagWrites();

    await revalidateCacheTag("cms-collection-docs");

    expect(handler.revalidateTag).toHaveBeenCalledWith("cms-collection-docs", {
      expire: expect.any(Number),
    });
  });

  test("waits for the data-cache tag write", async () => {
    const write = deferred();
    stubTagWrites().revalidateTag.mockReturnValue(write.promise);
    let settled = false;

    const drop = revalidateCacheTag("cms-collection-docs").then(() => {
      settled = true;
    });
    await flushTasks();
    expect(settled).toBe(false);

    write.resolve();
    await drop;
    expect(settled).toBe(true);
  });

  test("rejects when the data-cache tag write fails later", async () => {
    const write = deferred();
    stubTagWrites().revalidateTag.mockReturnValue(write.promise);
    const writeError = new Error("KV write failed");

    const drop = revalidateCacheTag("cms-collection-docs");
    await flushTasks();
    write.reject(writeError);

    await expect(drop).rejects.toBe(writeError);
  });

  test("still gives the tag write to the request execution context", async () => {
    stubTagWrites();
    const waitUntil = vi.fn();

    await runWithExecutionContext({ waitUntil }, () => revalidateCacheTag("cms-collection-docs"));

    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  test("uses Cloudflare KV data-adapter safe tag strings", () => {
    const tags = [
      CACHE_TAGS.cmsCollection("docs"),
      CACHE_TAGS.cmsEntry({ collectionSlug: "docs", slug: "getting-started" }),
    ];

    expect(tags.every((tag) => tag.length > 0 && !tag.includes(":"))).toBe(true);
  });
});

function stubTagWrites() {
  const handler = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    revalidateTag: vi.fn(async (): Promise<void> => undefined),
  };

  setDataCacheHandler(handler);
  return handler;
}

function deferred() {
  let resolve = () => {};
  let reject = (__error: unknown) => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function flushTasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
