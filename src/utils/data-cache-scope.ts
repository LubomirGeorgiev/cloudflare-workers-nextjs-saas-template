import "server-only";

import { registerLazyDataCacheHandler } from "vinext/shims/cache-handler";
import { runWithExecutionContext } from "vinext/shims/request-context";

/**
 * Runs one Worker handler with the KV data cache that Vinext registers only inside its page
 * handler. Without it, a tag drop from the queue, the cron, or the API reaches an in-memory handler.
 * The execution context lets Vinext keep its unawaited KV writes alive with `waitUntil`.
 */
export function runWithDataCache<T>({
  env,
  ctx,
  run,
}: {
  env: Env;
  ctx: ExecutionContext;
  run: () => Promise<T>;
}): Promise<T> {
  // Lazy, so a page request imports nothing here; Vinext's own registration replaces this one.
  registerLazyDataCacheHandler(async () => {
    (await import("virtual:vinext-cache-adapters")).registerConfiguredCacheAdapters(env);
  });

  return runWithExecutionContext(ctx, run);
}
