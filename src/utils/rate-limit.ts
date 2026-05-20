import "server-only";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import * as ipaddr from "ipaddr.js";

interface RateLimitOptions {
  // Maximum number of requests allowed within the window
  limit: number;
  // Time window in seconds
  windowInSeconds: number;
  // Unique identifier for the rate limit (e.g., 'api:auth', 'api:upload')
  identifier: string;
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
      // Get the first 64 bits for IPv6
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

  // Get the current count from KV
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

  // Increment the counter
  await env.NEXT_INC_CACHE_KV.put(windowKey, (currentCount + 1).toString(), {
    expirationTtl: options.windowInSeconds,
  });

  return {
    success: true,
    remaining: options.limit - (currentCount + 1),
    reset,
    limit: options.limit,
  };
}

// Helper function to get rate limit headers
// export function getRateLimitHeaders(result: RateLimitResult): Headers {
//   const headers = new Headers();
//   headers.set("X-RateLimit-Limit", result.limit.toString());
//   headers.set("X-RateLimit-Remaining", result.remaining.toString());
//   headers.set("X-RateLimit-Reset", result.reset.toString());

//   if (!result.success) {
//     headers.set("Retry-After", (result.reset - Math.floor(Date.now() / 1000)).toString());
//   }

//   return headers;
// }

// Example usage:
/*
const rateLimitResult = await checkRateLimit({
  key: "user-123", // Usually an IP address or user ID
  options: {
    limit: 100,
    windowInSeconds: 60 * 60, // 1 hour
    identifier: "api:auth",
  },
});

if (!rateLimitResult.success) {
  return new Response("Rate limit exceeded", {
    status: 429,
    headers: getRateLimitHeaders(rateLimitResult),
  });
}
*/
