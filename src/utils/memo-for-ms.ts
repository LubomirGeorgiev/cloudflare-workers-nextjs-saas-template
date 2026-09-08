// A per-isolate memory layer with an expiry, for the hottest `"use cache: remote"` reads.
//
// `lazyValue` in `./lazy-value.ts` holds a value for the life of the isolate, so it may only hold
// inert data. This helper holds a value for a few seconds, which is what makes it safe in front of a
// KV read: the entry can go stale, and the TTL bounds how long it stays that way.
//
// Two rules keep a cross-request memo safe on Workers:
//
// - **A settled entry answers with its value, never with the promise that produced it.** A promise
//   another request's I/O resolves may hang or throw once that request ends, so only the build in
//   flight is shared, and only with the callers that arrive during it.
// - **A rejection is never held.** The entry is dropped, so the next caller retries instead of
//   inheriting one transient failure for the whole TTL.

interface MemoEntry<T> {
  expiresAt: number;
  // Swapped for a resolved-value reader once the build settles; see the rule above.
  read: () => Promise<T>;
}

interface MemoForMs<A extends unknown[], T> {
  read: (...args: A) => Promise<T>;
  /** Drops this isolate's copies. Call it where the underlying data is invalidated. */
  clear: () => void;
}

/**
 * Memoizes `build` per key for `ttlMs`, keeping at most `maxEntries` keys.
 *
 * The default key joins the arguments, so every argument must be a primitive. Pass `keyOf` when one
 * is not, and name in it exactly the values the cached read keys on.
 */
export function memoForMs<A extends unknown[], T>({
  build,
  keyOf = (...args: A) => args.join("|"),
  ttlMs,
  maxEntries,
}: {
  build: (...args: A) => Promise<T>;
  keyOf?: (...args: A) => string;
  ttlMs: number;
  maxEntries: number;
}): MemoForMs<A, T> {
  const entries = new Map<string, MemoEntry<T>>();

  function read(...args: A): Promise<T> {
    const key = keyOf(...args);
    const existing = entries.get(key);

    if (existing && existing.expiresAt > Date.now()) {
      return existing.read();
    }

    // Drop a stale entry before the bound check, so a refresh re-adds it as the newest key.
    entries.delete(key);

    const pending = build(...args);
    const entry: MemoEntry<T> = { expiresAt: Date.now() + ttlMs, read: () => pending };

    void pending.then(
      (value) => {
        entry.read = () => Promise.resolve(value);
      },
      () => {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }
      },
    );

    if (entries.size >= maxEntries) {
      // The Map keeps insertion order, so the first key is the one built longest ago.
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) {
        entries.delete(oldest);
      }
    }

    entries.set(key, entry);

    return pending;
  }

  return {
    read,
    clear: () => entries.clear(),
  };
}
