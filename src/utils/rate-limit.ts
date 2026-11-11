import "server-only";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { waitUntil } from "cloudflare:workers";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { normalizeRateLimitIp } from "@/utils/rate-limit-ip";

interface RateLimitOptions {
  // Maximum number of requests allowed within the window
  limit: number;
  // Time window in seconds
  windowInSeconds: number;
  // Unique identifier for the rate limit (e.g., 'api:auth', 'api:upload')
  identifier: string;
  // Soft limit mode: persist successful increments after the response is ready.
  deferWrite?: boolean;
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number; // Timestamp when the rate limit resets
  limit: number;
}

// This limiter is an abuse-resistance signal, not an accounting or authorization boundary. KV
// reads and writes are eventually consistent and the increment is not atomic, so concurrent
// requests (especially across PoPs) can temporarily exceed a configured limit.

// Build the per-window KV key, normalizing IP-shaped keys to their /64 subnet.
function buildWindowKey({
  key,
  identifier,
  windowInSeconds,
  now,
}: {
  key: string;
  identifier: string;
  windowInSeconds: number;
  now: number;
}): string {
  return `${APP_KV_PREFIXES.rateLimit}${identifier}:${normalizeRateLimitIp(key)}:${Math.floor(now / windowInSeconds)}`;
}

export async function checkRateLimit({
  key,
  options,
}: {
  key: string;
  options: RateLimitOptions;
}): Promise<RateLimitResult> {
  const { env } = await getCloudflareContext();
  const now = Math.floor(Date.now() / 1000);

  if (!env?.KV_STORE) {
    throw new Error("Can't connect to KV store");
  }

  const windowKey = buildWindowKey({
    key,
    identifier: options.identifier,
    windowInSeconds: options.windowInSeconds,
    now,
  });

  const currentCount = parseInt((await env.KV_STORE.get(windowKey)) || "0");
  const reset = (Math.floor(now / options.windowInSeconds) + 1) * options.windowInSeconds;

  if (currentCount >= options.limit) {
    return {
      success: false,
      remaining: 0,
      reset,
      limit: options.limit,
    };
  }

  const writeCountPromise = env.KV_STORE.put(windowKey, (currentCount + 1).toString(), {
    expirationTtl: options.windowInSeconds,
  });

  if (options.deferWrite) {
    waitUntil(writeCountPromise);
  } else {
    await writeCountPromise;
  }

  return {
    success: true,
    remaining: options.limit - (currentCount + 1),
    reset,
    limit: options.limit,
  };
}

// Clear the current window's counter so a prior increment no longer counts.
// Used to refund a soft limit (e.g. an account bucket) after a successful attempt.
// Assumes non-deferred writes: the increment must already be durable before we delete it.
export async function resetRateLimit({
  key,
  identifier,
  windowInSeconds,
}: {
  key: string;
  identifier: string;
  windowInSeconds: number;
}): Promise<void> {
  const { env } = await getCloudflareContext();

  if (!env?.KV_STORE) {
    throw new Error("Can't connect to KV store");
  }

  const now = Math.floor(Date.now() / 1000);
  const windowKey = buildWindowKey({ key, identifier, windowInSeconds, now });

  await env.KV_STORE.delete(windowKey);
}
