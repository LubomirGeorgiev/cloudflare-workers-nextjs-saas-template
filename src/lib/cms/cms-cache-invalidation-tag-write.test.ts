import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryCacheHandler, setDataCacheHandler } from "vinext/shims/cache-handler";

// `cms-cache-invalidation.test.ts` stubs `revalidateCacheTag`. This file keeps the real helper and
// real Vinext `revalidateTag`, and stubs only the data-cache handler under them.
const { purgeWorkersCacheAfterWriteMock } = vi.hoisted(() => ({
  purgeWorkersCacheAfterWriteMock: vi.fn(async (__input: { tags: readonly string[] }) => "ok" as const),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/edge/purge-workers-cache-after-write", () => ({
  purgeWorkersCacheAfterWrite: purgeWorkersCacheAfterWriteMock,
}));

const { runCmsCacheInvalidation } = await import("./cms-cache-invalidation");

const TAG = "cms-collection-docs";

describe("CMS cache invalidation with the real tag write", () => {
  afterEach(() => {
    vi.clearAllMocks();
    setDataCacheHandler(new MemoryCacheHandler());
  });

  test("starts the page step only after the data-cache tag write resolves", async () => {
    const write = deferred();
    const handler = stubTagWrites();
    handler.revalidateTag.mockReturnValue(write.promise);
    const purgePages = vi.fn(async () => "ok" as const);

    const run = runCmsCacheInvalidation({ tags: [TAG], purgePages });
    await flushTasks();

    expect(handler.revalidateTag).toHaveBeenCalledWith(TAG, expect.anything());
    expect(purgePages).not.toHaveBeenCalled();
    expect(purgeWorkersCacheAfterWriteMock).not.toHaveBeenCalled();

    write.resolve();
    await run;

    expect(purgePages).toHaveBeenCalledTimes(1);
    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledWith({ tags: [TAG] });
  });

  test("throws a data-cache tag write that fails after the call returns", async () => {
    const write = deferred();
    stubTagWrites().revalidateTag.mockReturnValue(write.promise);
    const writeError = new Error("KV write failed");
    const purgePages = vi.fn(async () => "ok" as const);

    const run = runCmsCacheInvalidation({ tags: [TAG], purgePages });
    await flushTasks();
    write.reject(writeError);

    await expect(run).rejects.toBe(writeError);
    // The later steps still run for the tags that dropped.
    expect(purgePages).toHaveBeenCalledTimes(1);
    expect(purgeWorkersCacheAfterWriteMock).toHaveBeenCalledTimes(1);
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
