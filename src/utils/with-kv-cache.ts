import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import ms from "ms";
import superjson from "superjson";
import isProd from "./is-prod";

interface CacheOptions {
  key: string;
  ttl: string; // e.g., "1h", "5m", "1d"
}

export async function withKVCache<T>(
  fn: () => Promise<T>,
  { key, ttl }: CacheOptions
): Promise<T> {
  // In development mode, always bypass the cache
  if (!isProd) {
    return fn();
  }

  const { env } = await getCloudflareContext({ async: true });
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  // Try to get the cached value
  const cached = await kv.get(key, "text");
  if (cached !== null) {
    return superjson.parse<T>(cached);
  }

  const result = await fn();

  await kv.put(key, superjson.stringify(result), {
    expirationTtl: Math.floor(ms(ttl) / 1000),
  });

  return result;
}

const STATS_PREFIX = "stats";

export const CACHE_KEYS = {
  TOTAL_USERS: `${STATS_PREFIX}:total-users`,
  GITHUB_STARS: `${STATS_PREFIX}:github-stars`,
} as const;
