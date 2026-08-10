/**
 * Collapses every query-string variant of one OpenGraph card onto a single edge cache entry.
 *
 * Cloudflare keys its cache on the full URL, but the renderer never reads the search string — a
 * metadata route handler gets only `params`. The query Next.js appends is a content hash of the
 * thin route file, not of the shared renderer. So `/opengraph-image?<anything>` is the same PNG at
 * an unbounded number of cache keys, and each miss costs ~1.2 s of satori + resvg CPU. Enumerating
 * the query is therefore a free way to bill us for unlimited renders.
 *
 * The key and the render are split. The canonical key collapses the variants, and the render keeps
 * the caller's URL, so a real page that wears a card's segment still gets the answer for its own
 * URL.
 *
 * This is the Cache API, not the Workers Caching that `wrangler.jsonc` enables. Workers Caching is
 * read-through and sits in front of the Worker; `caches.default` sits behind it, inside the Worker.
 * It is per data center and holds no Worker version in its key, so a deploy does not clear it. The
 * TTL is whatever `OG_IMAGE_CACHE_CONTROL` says; nothing here sets one. Both points are in
 * docs/page-caching.md.
 *
 * Import-free beyond two leaf modules: `worker-entrypoint.ts` reaches this on every request, so it
 * sits on the startup graph (see docs/worker-hot-path-and-bundle-size.md).
 */

import { OG_IMAGE_CONTENT_TYPE } from "@/constants/og-image";

import { isOgImageRequest } from "./og-paths";

// A card is a public image, so only these two ever reach one. Anything else falls through to the
// normal pipeline rather than being answered from a shared cache entry.
const CACHEABLE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * Answers a card from the colo cache, or renders it once and stores it under the canonical key.
 *
 * Returns `null` when the request is not a card, so the caller falls through unchanged.
 */
export async function serveOgImageFromCache({
  request,
  url,
  render,
  ctx,
}: {
  request: Request;
  url: URL;
  /** Renders the caller's own request, as GET. Called only on a miss. */
  render: (original: Request) => Promise<Response>;
  ctx: ExecutionContext;
}): Promise<Response | null> {
  if (
    !CACHEABLE_METHODS.has(request.method) ||
    !isOgImageRequest({ pathname: url.pathname, headers: request.headers })
  ) {
    return null;
  }

  // `dom` is in `tsconfig.lib`, so its `CacheStorage` shadows the Worker one here and it declares no
  // `default` — the colo cache is Cloudflare's own addition. Narrowed once rather than at each use.
  const cache = (caches as unknown as { default: Cache }).default;
  // Header-free by design: the Cache API matches any `Vary` the stack attaches against the *key's*
  // headers. The identical (empty) set on every lookup is what stops one entry from splitting back
  // into one per crawler.
  const cacheKey = new Request(`${url.origin}${url.pathname}`);

  const cached = await cache.match(cacheKey);
  if (cached) {
    return withoutBodyForHead({ request, response: cached });
  }

  // Rebuilt from the request, not from `cacheKey`, to keep the caller's URL and `cf`. HEAD renders
  // as GET so a miss on it warms the same entry a GET would; without that an attacker just switches
  // method and the enumeration is back. Both cacheable methods are body-free, so the rebuild is safe.
  const response = await render(new Request(request, { method: "GET" }));

  // Only a rendered card is stored. `/blog/opengraph-image-launch` may be a real post, and a 404 or
  // a locale redirect must never occupy the slot the card needs.
  if (response.status === 200 && response.headers.get("content-type") === OG_IMAGE_CONTENT_TYPE) {
    // `put` rejects on an uncacheable response (a stray Set-Cookie, a `Vary: *`). Failing to warm
    // the cache is not a reason to fail the crawl.
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
  }

  return withoutBodyForHead({ request, response });
}

function withoutBodyForHead({
  request,
  response,
}: {
  request: Request;
  response: Response;
}): Response {
  if (request.method !== "HEAD") {
    return response;
  }

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
