import { describe, expect, test, vi } from "vitest";

import { lazyValue, lazyValueByKey } from "./lazy-value";

/** Resolves only once `release()` is called, so a race can be held open deterministically. */
function deferred<T>() {
  let release!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });

  return { promise, release, fail };
}

describe("lazyValue", () => {
  test("builds once and answers every later caller from the cache", async () => {
    const build = vi.fn(async () => "built");
    const get = lazyValue(build);

    await expect(get()).resolves.toBe("built");
    await expect(get()).resolves.toBe("built");
    expect(build).toHaveBeenCalledOnce();
  });

  // The reason the promise is cached rather than the value: two cold callers must not both build.
  test("concurrent callers share one in-flight build", async () => {
    const gate = deferred<string>();
    const build = vi.fn(() => gate.promise);
    const get = lazyValue(build);

    const both = Promise.all([get(), get()]);
    gate.release("built");

    await expect(both).resolves.toEqual(["built", "built"]);
    expect(build).toHaveBeenCalledOnce();
  });

  // The reason a rejection is not cached: one transient failure must not disable the code path for
  // the life of the isolate.
  test("a rejection is not cached, and the next caller retries", async () => {
    const build = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("built");
    const get = lazyValue(build);

    await expect(get()).rejects.toThrow("transient");
    await expect(get()).resolves.toBe("built");
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("every caller of a failed in-flight build sees the rejection", async () => {
    const gate = deferred<string>();
    const get = lazyValue(() => gate.promise);

    const first = get();
    const second = get();
    gate.fail(new Error("transient"));

    await expect(first).rejects.toThrow("transient");
    await expect(second).rejects.toThrow("transient");
  });
});

describe("lazyValueByKey", () => {
  test("builds once per key and never mixes entries", async () => {
    const build = vi.fn(async (key: string) => `built:${key}`);
    const get = lazyValueByKey(build);

    await expect(get("en")).resolves.toBe("built:en");
    await expect(get("es")).resolves.toBe("built:es");
    await expect(get("en")).resolves.toBe("built:en");
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("concurrent callers of the same key share one in-flight build", async () => {
    const gate = deferred<string>();
    const build = vi.fn(() => gate.promise);
    const get = lazyValueByKey(build);

    const both = Promise.all([get("en"), get("en")]);
    gate.release("built");

    await expect(both).resolves.toEqual(["built", "built"]);
    expect(build).toHaveBeenCalledOnce();
  });

  test("a rejected key is dropped without evicting the keys that succeeded", async () => {
    const build = vi.fn(async (key: string) => {
      if (key === "es" && build.mock.calls.length === 2) {
        throw new Error("transient");
      }

      return `built:${key}`;
    });
    const get = lazyValueByKey(build);

    await expect(get("en")).resolves.toBe("built:en");
    await expect(get("es")).rejects.toThrow("transient");
    await expect(get("es")).resolves.toBe("built:es");
    await expect(get("en")).resolves.toBe("built:en");

    expect(build).toHaveBeenCalledTimes(3);
  });
});
