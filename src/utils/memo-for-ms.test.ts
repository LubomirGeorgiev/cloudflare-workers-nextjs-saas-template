import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { memoForMs } from "./memo-for-ms";

const TTL_MS = 60_000;

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memoForMs", () => {
  test("builds once per key and answers later callers from memory", async () => {
    const build = vi.fn(async (locale: string) => `built:${locale}`);
    const memo = memoForMs({ build, ttlMs: TTL_MS, maxEntries: 4 });

    await expect(memo.read("en")).resolves.toBe("built:en");
    await expect(memo.read("en")).resolves.toBe("built:en");
    await expect(memo.read("es")).resolves.toBe("built:es");

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("rebuilds once the TTL has passed", async () => {
    const build = vi.fn(async () => "built");
    const memo = memoForMs({ build, ttlMs: TTL_MS, maxEntries: 4 });

    await memo.read();
    vi.advanceTimersByTime(TTL_MS - 1);
    await memo.read();
    expect(build).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1);
    await memo.read();
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("concurrent callers share one in-flight build", async () => {
    const gate = deferred<string>();
    const build = vi.fn(() => gate.promise);
    const memo = memoForMs({ build, ttlMs: TTL_MS, maxEntries: 4 });

    const both = Promise.all([memo.read(), memo.read()]);
    gate.release("built");

    await expect(both).resolves.toEqual(["built", "built"]);
    expect(build).toHaveBeenCalledOnce();
  });

  // The Workers rule: a later request must await a value of its own, never the promise another
  // request's I/O resolved, because that promise can hang or throw once that request ends.
  test("a settled entry answers with a new promise, not the build's own", async () => {
    const gate = deferred<string>();
    const memo = memoForMs({ build: () => gate.promise, ttlMs: TTL_MS, maxEntries: 4 });

    const first = memo.read();
    expect(first).toBe(gate.promise);

    gate.release("built");
    await first;

    expect(memo.read()).not.toBe(gate.promise);
    await expect(memo.read()).resolves.toBe("built");
  });

  test("a rejection is not held, and the next caller retries", async () => {
    const build = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("built");
    const memo = memoForMs({ build, ttlMs: TTL_MS, maxEntries: 4 });

    await expect(memo.read()).rejects.toThrow("transient");
    await expect(memo.read()).resolves.toBe("built");
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("keeps at most `maxEntries` keys, dropping the one built longest ago", async () => {
    const build = vi.fn(async (key: string) => `built:${key}`);
    const memo = memoForMs({ build, ttlMs: TTL_MS, maxEntries: 2 });

    await memo.read("a");
    await memo.read("b");
    await memo.read("c");
    expect(build).toHaveBeenCalledTimes(3);

    await memo.read("c");
    expect(build).toHaveBeenCalledTimes(3);

    // "a" was evicted to make room for "c"; "b" is still held.
    await memo.read("b");
    expect(build).toHaveBeenCalledTimes(3);
    await memo.read("a");
    expect(build).toHaveBeenCalledTimes(4);
  });

  test("`keyOf` names the values the entry varies by", async () => {
    const build = vi.fn(async ({ locale, slug }: { locale: string; slug: string }) => `${locale}:${slug}`);
    const memo = memoForMs({
      build,
      keyOf: ({ locale, slug }) => `${locale}|${slug}`,
      ttlMs: TTL_MS,
      maxEntries: 4,
    });

    await memo.read({ locale: "en", slug: "guide" });
    await memo.read({ locale: "en", slug: "guide" });
    await memo.read({ locale: "es", slug: "guide" });

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("`clear` drops every copy this isolate holds", async () => {
    const build = vi.fn(async () => "built");
    const memo = memoForMs({ build, ttlMs: TTL_MS, maxEntries: 4 });

    await memo.read();
    memo.clear();
    await memo.read();

    expect(build).toHaveBeenCalledTimes(2);
  });
});
