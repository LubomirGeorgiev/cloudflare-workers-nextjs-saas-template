// The one place this codebase decides how per-isolate lazy caching works. Every module-scope memo
// of async work goes through here rather than hand-rolling its own `let x = null` / `Map` ceremony.
//
// The in-flight promise is what is cached, so concurrent callers on a cold isolate share one
// evaluation instead of each doing the work. A rejection is never cached: the entry is dropped so
// the next caller retries, which is what keeps one transient failure from disabling a code path for
// the life of the isolate.
//
// Only for work whose result is safe to hold across requests — inert data, a parsed document, a
// fetch-transport client. Anything reaching KV, D1, R2, or a request-scoped `fetch` must not be
// memoized here: that promise belongs to the request that created it, and a later request awaiting
// it either hangs when that request ends or throws on the I/O object it yields.

/** Memoizes a single value. `build` runs at most once per isolate, plus once more per failure. */
export function lazyValue<T>(build: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;

  return () => {
    // The `.catch` callback always runs a microtask after this assignment, so it can never null out
    // an entry that has not been stored yet.
    pending ??= build().catch((error: unknown) => {
      pending = null;

      throw error;
    });

    return pending;
  };
}

/** The same contract, one entry per key — for values that vary by locale, tenant, or similar. */
export function lazyValueByKey<K, T>(build: (key: K) => Promise<T>): (key: K) => Promise<T> {
  const pending = new Map<K, Promise<T>>();

  return (key: K) => {
    const existing = pending.get(key);
    if (existing) {
      return existing;
    }

    const promise = build(key).catch((error: unknown) => {
      pending.delete(key);

      throw error;
    });
    pending.set(key, promise);

    return promise;
  };
}
