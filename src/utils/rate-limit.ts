import "server-only";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { waitUntil } from "cloudflare:workers";
import * as ipaddr from "ipaddr.js";

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

// Normalize an IP address for rate limiting
// For IPv6, we use the /64 subnet to prevent rate limit bypassing
function normalizeIP(ip: string): string {
  try {
    const addr = ipaddr.parse(ip);

    if (addr.kind() === 'ipv6') {
      const ipv6 = addr as ipaddr.IPv6;
      const bytes = ipv6.toByteArray();
      // Zero out the last 8 bytes (64 bits)
      for (let i = 8; i < 16; i++) {
        bytes[i] = 0;
      }
      return `${ipaddr.fromByteArray(bytes).toString()}/64`;
    } else {
      // For IPv4, return the address as-is without normalization
      return addr.toString();
    }
  } catch {
    // If parsing fails, return the original IP
    return ip;
  }
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

  if (!env?.NEXT_INC_CACHE_KV) {
    throw new Error("Can't connect to KV store");
  }

  // Normalize the key if it looks like an IP address
  const normalizedKey = ipaddr.isValid(key) ? normalizeIP(key) : key;

  const windowKey = `rate-limit:${options.identifier}:${normalizedKey}:${Math.floor(
    now / options.windowInSeconds
  )}`;

  const currentCount = parseInt((await env.NEXT_INC_CACHE_KV.get(windowKey)) || "0");
  const reset = (Math.floor(now / options.windowInSeconds) + 1) * options.windowInSeconds;

  if (currentCount >= options.limit) {
    return {
      success: false,
      remaining: 0,
      reset,
      limit: options.limit,
    };
  }

  const writeCountPromise = env.NEXT_INC_CACHE_KV.put(windowKey, (currentCount + 1).toString(), {
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
