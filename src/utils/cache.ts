import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import ms from "ms";
import { getRequestExecutionContext, runWithExecutionContext } from "vinext/shims/request-context";

// The tag names stay import-free in `@/constants/cache-tags` so the Worker entrypoint can read
// them without this module's startup cost. Re-exported here, the historical home for them.
export { CACHE_TAGS } from "@/constants/cache-tags";

interface CacheScopeOptions {
  ttl: ms.StringValue; // e.g., "1h", "5m", "1d"
  tags?: readonly string[];
}

export function setCacheScope({ ttl, tags }: CacheScopeOptions): void {
  const seconds = Math.floor(ms(ttl) / 1000);

  if (tags?.length) {
    cacheTag(...tags);
  }

  cacheLife({
    expire: seconds,
    revalidate: seconds,
  });
}

// Awaits the tag write and rejects when it fails, so a caller can order work after the drop.
export async function revalidateCacheTag(tag: string): Promise<void> {
  // "max" keeps Vinext's stale-while-revalidate mode and does not mark the action as revalidated.
  await Promise.all(collectWaitUntil(() => revalidateTag(tag, "max")));
}

// Vinext's `revalidateTag` returns nothing and gives its data-cache write to `waitUntil`. This
// scope catches that promise and still forwards it to the request, which keeps the Worker alive.
// The child scope copies Vinext's request state: only shared sets may change in it.
function collectWaitUntil(run: () => void): Promise<unknown>[] {
  const requestContext = getRequestExecutionContext();
  const promises: Promise<unknown>[] = [];

  // The overload types the result as maybe a promise. A sync `run` returns its own value.
  // oxlint-disable-next-line typescript/no-floating-promises
  runWithExecutionContext(
    {
      ...requestContext,
      waitUntil(promise) {
        promises.push(promise);
        requestContext?.waitUntil(promise);
      },
      passThroughOnException() {
        requestContext?.passThroughOnException?.();
      },
    },
    run,
  );

  return promises;
}
