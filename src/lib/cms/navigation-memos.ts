import "server-only";

import { cache } from "react";

import { DATA_CACHE_MEMORY_TTL_MS } from "@/constants/data-cache";
import { memoForMs } from "@/utils/memo-for-ms";

interface NavigationMemo<A extends unknown[], T> {
  read: (...args: A) => Promise<T>;
}

// Every navigation memo, so one CMS invalidation drops them all without importing the readers:
// each reader imports the repository, so a direct import back would close a cycle.
const registeredClears = new Set<() => void>();

/**
 * A navigation read held in this isolate's memory for `DATA_CACHE_MEMORY_TTL_MS` in front of its
 * `"use cache: remote"` body, and cleared as a group by the CMS invalidation path.
 *
 * Set `dedupePerRequest` when one render asks for the read more than once: Vinext runs no
 * in-request dedupe for `"use cache"`, so React `cache` saves the repeated KV get. It keys by
 * argument identity, so only pass it for a read whose arguments are primitives.
 */
export function createNavigationMemo<A extends unknown[], T>({
  build,
  keyOf,
  maxEntries,
  dedupePerRequest = false,
}: {
  build: (...args: A) => Promise<T>;
  keyOf?: (...args: A) => string;
  maxEntries: number;
  dedupePerRequest?: boolean;
}): NavigationMemo<A, T> {
  const memo = memoForMs({
    build,
    keyOf,
    ttlMs: DATA_CACHE_MEMORY_TTL_MS,
    maxEntries,
  });

  registeredClears.add(memo.clear);

  return {
    read: dedupePerRequest ? cache(memo.read) : memo.read,
  };
}

/**
 * Drops every navigation memo. Only this isolate's copies; the others age out within the TTL.
 * Under `dedupePerRequest` the React `cache` wrapper keeps a promise the request already read, so
 * the clear reaches the next request rather than a read already in flight.
 */
export function clearNavigationMemos(): void {
  for (const clear of registeredClears) {
    clear();
  }
}
